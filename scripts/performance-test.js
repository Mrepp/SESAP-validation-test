import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class PerformanceTestRunner {
  constructor(config) {
    this.config = config;
    this.results = {
      testId: `test_${Date.now()}`,
      startTime: null,
      endTime: null,
      config: config,
      metrics: {},
      errors: [],
      deploymentValid: false
    };
  }

  async verifyDeployment(url) {
    console.log(`Verifying deployment at ${url}...`);
    
    try {
      // Check if the page loads
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Page returned ${response.status}`);
      }
      
      // Check for metadata.json to verify it's our deployment
      const metadataUrl = `${url}/data/metadata.json`;
      const metadataResponse = await fetch(metadataUrl);
      
      if (metadataResponse.ok) {
        const metadata = await metadataResponse.json();
        
        // Check if this is a recent deployment (within last hour)
        const deploymentTime = new Date(metadata.processedAt);
        const now = new Date();
        const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        
        if (deploymentTime < hourAgo) {
          console.warn('⚠️ Warning: Deployment is more than 1 hour old');
          console.log(`   Deployment time: ${deploymentTime.toISOString()}`);
          console.log(`   Current time: ${now.toISOString()}`);
          
          // In CI, this might be an old deployment
          if (process.env.CI) {
            throw new Error('Deployment appears to be stale (>1 hour old)');
          }
        }
        
        // Check deployment ID if available
        const expectedId = process.env.GITHUB_RUN_ID;
        if (expectedId && metadata.deploymentId !== expectedId) {
          console.warn(`⚠️ Warning: Deployment ID mismatch`);
          console.log(`   Expected: ${expectedId}`);
          console.log(`   Found: ${metadata.deploymentId}`);
        }
        
        console.log('✅ Deployment verified');
        console.log(`   Deployment time: ${deploymentTime.toISOString()}`);
        console.log(`   Interviews: ${metadata.totalInterviews}`);
        
        this.results.deploymentValid = true;
        this.results.deploymentMetadata = metadata;
        return true;
      } else {
        throw new Error('Could not fetch deployment metadata');
      }
    } catch (error) {
      console.error('❌ Deployment verification failed:', error.message);
      this.results.deploymentValid = false;
      throw new Error(`Deployment not ready or invalid: ${error.message}`);
    }
  }

  async waitForDeployment(url, maxWaitTime, checkInterval) {
    console.log(`Waiting for deployment at ${url}...`);
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        await this.verifyDeployment(url);
        return true;
      } catch (error) {
        // Keep waiting
        process.stdout.write('.');
      }
      
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
    
    throw new Error(`Deployment did not become ready within ${maxWaitTime}ms`);
  }

  async measurePageLoad(browser, url) {
    const page = await browser.newPage();
    const metrics = [];
    
    for (let i = 0; i < 3; i++) {
      await page.goto('about:blank');
      
      const startTime = Date.now();
      await page.goto(url, { waitUntil: 'networkidle2' });
      const loadTime = Date.now() - startTime;
      
      // Get performance metrics
      const perfMetrics = await page.evaluate(() => {
        const perf = performance.getEntriesByType('navigation')[0];
        return {
          domContentLoaded: perf.domContentLoadedEventEnd - perf.domContentLoadedEventStart,
          loadComplete: perf.loadEventEnd - perf.loadEventStart,
          firstPaint: performance.getEntriesByName('first-paint')[0]?.startTime || 0,
          firstContentfulPaint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0
        };
      });
      
      metrics.push({
        loadTime,
        ...perfMetrics
      });
    }
    
    await page.close();
    
    // Calculate averages
    const avgMetrics = metrics.reduce((acc, m) => {
      Object.keys(m).forEach(key => {
        acc[key] = (acc[key] || 0) + m[key] / metrics.length;
      });
      return acc;
    }, {});
    
    return avgMetrics;
  }

  async measureClusterSwitch(browser, url) {
    const page = await browser.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      // Wait for React app to load
      await page.waitForFunction(
        () => document.querySelector('#root')?.children.length > 0,
        { timeout: 10000 }
      );
      
      // Look for cluster dropdown with various selectors
      const dropdownExists = await page.evaluate(() => {
        const selectors = [
          'select',
          '[role="combobox"]',
          '[data-testid="cluster-dropdown"]',
          '.cluster-select',
          'select[class*="cluster"]'
        ];
        
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) return true;
        }
        return false;
      });
      
      if (!dropdownExists) {
        console.warn('Cluster dropdown not found, skipping cluster switch test');
        return {
          switches: [],
          averageTime: 0,
          skipped: true,
          reason: 'Dropdown not found'
        };
      }
      
      const clusterTypes = ['summary', 'themes', 'collegeExperience', 'quotes'];
      const switchTimes = [];
      
      for (const clusterType of clusterTypes) {
        try {
          const startTime = Date.now();
          
          // Try to change cluster type
          await page.evaluate((type) => {
            const select = document.querySelector('select');
            if (select) {
              select.value = type;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, clusterType);
          
          // Wait for visualization to update
          await page.waitForFunction(
            () => {
              const svg = document.querySelector('svg');
              return svg && svg.querySelectorAll('circle, .node').length > 0;
            },
            { timeout: 5000 }
          );
          
          const switchTime = Date.now() - startTime;
          switchTimes.push({
            from: clusterTypes[clusterTypes.indexOf(clusterType) - 1] || 'initial',
            to: clusterType,
            time: switchTime
          });
        } catch (error) {
          console.warn(`Failed to switch to ${clusterType}:`, error.message);
        }
      }
      
      return {
        switches: switchTimes,
        averageTime: switchTimes.length > 0 
          ? switchTimes.reduce((sum, s) => sum + s.time, 0) / switchTimes.length 
          : 0
      };
    } catch (error) {
      console.error('Cluster switch test error:', error);
      return {
        switches: [],
        averageTime: 0,
        error: error.message
      };
    } finally {
      await page.close();
    }
  }

  async measureSearch(browser, url) {
    const page = await browser.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      // Wait for React app to load
      await page.waitForFunction(
        () => document.querySelector('#root')?.children.length > 0,
        { timeout: 10000 }
      );
      
      const searchTests = [
        { type: 'text', query: 'student experience' },
        { type: 'text', query: 'academic' }
      ];
      
      const results = [];
      
      for (const test of searchTests) {
        try {
          // Find search input
          const searchInput = await page.evaluate(() => {
            const selectors = [
              'input[type="text"]',
              'input[type="search"]',
              'input[placeholder*="search" i]',
              '[data-testid="search-input"]'
            ];
            
            for (const selector of selectors) {
              const element = document.querySelector(selector);
              if (element) return true;
            }
            return false;
          });
          
          if (!searchInput) {
            console.warn('Search input not found');
            continue;
          }
          
          // Clear and type search
          await page.evaluate(() => {
            const input = document.querySelector('input[type="text"], input[type="search"]');
            if (input) {
              input.value = '';
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }
          });
          
          await page.type('input[type="text"], input[type="search"]', test.query);
          
          const startTime = Date.now();
          
          // Click search button or press Enter
          await page.keyboard.press('Enter');
          
          // Wait for results (with timeout)
          await page.waitForTimeout(1000);
          
          const searchTime = Date.now() - startTime;
          
          results.push({
            ...test,
            time: searchTime,
            resultCount: 0
          });
        } catch (error) {
          console.warn(`Search test failed for "${test.query}":`, error.message);
        }
      }
      
      return {
        searches: results,
        averageTime: results.length > 0
          ? results.reduce((sum, r) => sum + r.time, 0) / results.length
          : 0
      };
    } catch (error) {
      console.error('Search test error:', error);
      return {
        searches: [],
        averageTime: 0,
        error: error.message
      };
    } finally {
      await page.close();
    }
  }

  async getBuildSize() {
    try {
      const distPath = path.join(__dirname, '../dist');
      const stats = await fs.stat(distPath);
      
      if (!stats.isDirectory()) {
        return 0;
      }
      
      const getAllFiles = async (dirPath, arrayOfFiles = []) => {
        const files = await fs.readdir(dirPath);
        
        for (const file of files) {
          const filePath = path.join(dirPath, file);
          const stat = await fs.stat(filePath);
          
          if (stat.isDirectory()) {
            await getAllFiles(filePath, arrayOfFiles);
          } else {
            arrayOfFiles.push({ path: filePath, size: stat.size });
          }
        }
        
        return arrayOfFiles;
      };
      
      const allFiles = await getAllFiles(distPath);
      const totalSize = allFiles.reduce((sum, file) => sum + file.size, 0);
      
      return totalSize / (1024 * 1024); // Convert to MB
    } catch (error) {
      console.error('Error calculating build size:', error);
      return 0;
    }
  }

  async getSystemInfo() {
    try {
      const commands = {
        cpu: 'nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4',
        mem: 'free -m 2>/dev/null | awk \'NR==2{print $2}\' || echo 16384',
        arch: 'uname -m',
        os: 'uname -s'
      };
      
      const results = {};
      for (const [key, cmd] of Object.entries(commands)) {
        try {
          const { stdout } = await execAsync(cmd);
          results[key] = stdout.trim();
        } catch {
          results[key] = 'unknown';
        }
      }
      
      return {
        cpu: parseInt(results.cpu) || 4,
        memoryMB: parseInt(results.mem) || 16384,
        architecture: results.arch || process.arch,
        os: results.os || process.platform,
        nodeVersion: process.version,
        platform: process.platform
      };
    } catch (error) {
      return {
        cpu: 4,
        memoryMB: 16384,
        architecture: process.arch,
        os: process.platform,
        nodeVersion: process.version,
        platform: process.platform
      };
    }
  }

  async runTests() {
    this.results.startTime = new Date().toISOString();
    
    console.log('\n📊 Starting Performance Tests...\n');
    
    // Get system info
    this.results.systemInfo = await this.getSystemInfo();
    console.log('System Info:', this.results.systemInfo);
    
    // Wait for and verify deployment
    try {
      await this.waitForDeployment(
        this.config.deployment.githubPagesUrl,
        this.config.performance.maxDeploymentWaitTime,
        this.config.performance.deploymentCheckInterval
      );
    } catch (error) {
      this.results.errors.push({
        phase: 'deployment',
        error: error.message
      });
      
      // Don't continue testing if deployment is not valid
      console.error('❌ Deployment verification failed. Skipping tests.');
      this.results.endTime = new Date().toISOString();
      
      // Save error results
      const resultsPath = path.join(__dirname, '../test-results');
      await fs.mkdir(resultsPath, { recursive: true });
      
      const resultsFile = path.join(resultsPath, `${this.results.testId}_deployment_failed.json`);
      await fs.writeFile(resultsFile, JSON.stringify(this.results, null, 2));
      
      throw error;
    }
    
    // Only run tests if deployment is valid
    if (!this.results.deploymentValid) {
      throw new Error('Deployment is not valid, cannot run tests');
    }
    
    // Launch browser
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    try {
      // Measure page load
      console.log('\n📈 Testing page load performance...');
      this.results.metrics.pageLoad = await this.measurePageLoad(
        browser,
        this.config.deployment.githubPagesUrl
      );
      console.log(`Average load time: ${this.results.metrics.pageLoad.loadTime.toFixed(0)}ms`);
      
      // Measure cluster switching
      console.log('\n🔄 Testing cluster switch performance...');
      this.results.metrics.clusterSwitch = await this.measureClusterSwitch(
        browser,
        this.config.deployment.githubPagesUrl
      );
      if (!this.results.metrics.clusterSwitch.skipped) {
        console.log(`Average switch time: ${this.results.metrics.clusterSwitch.averageTime.toFixed(0)}ms`);
      } else {
        console.log(`Skipped: ${this.results.metrics.clusterSwitch.reason}`);
      }
      
      // Measure search performance
      console.log('\n🔍 Testing search performance...');
      this.results.metrics.search = await this.measureSearch(
        browser,
        this.config.deployment.githubPagesUrl
      );
      if (this.results.metrics.search.averageTime > 0) {
        console.log(`Average search time: ${this.results.metrics.search.averageTime.toFixed(0)}ms`);
      }
      
    } catch (error) {
      this.results.errors.push({
        phase: 'testing',
        error: error.message
      });
      console.error('Test error:', error);
    } finally {
      await browser.close();
    }
    
    // Get build size
    this.results.metrics.buildSizeMB = await this.getBuildSize();
    console.log(`\n📦 Build size: ${this.results.metrics.buildSizeMB.toFixed(2)} MB`);
    
    this.results.endTime = new Date().toISOString();
    
    // Save results
    const resultsPath = path.join(__dirname, '../test-results');
    await fs.mkdir(resultsPath, { recursive: true });
    
    const resultsFile = path.join(resultsPath, `${this.results.testId}.json`);
    await fs.writeFile(resultsFile, JSON.stringify(this.results, null, 2));
    
    console.log(`\n✅ Test results saved to: ${resultsFile}`);
    
    return this.results;
  }

  generateSummary() {
    const { metrics, config, deploymentValid, errors } = this.results;
    
    // Determine actual status based on errors and deployment validity
    let status = '✅ PASSED';
    if (!deploymentValid) {
      status = '❌ FAILED (Invalid Deployment)';
    } else if (errors.length > 0) {
      status = '❌ FAILED';
    } else if (metrics.clusterSwitch?.skipped || metrics.search?.error) {
      status = '⚠️ PARTIAL';
    }
    
    const summary = {
      testId: this.results.testId,
      configuration: {
        interviews: config.interviews.count,
        sizeMultiplier: config.interviews.sizeMultiplier
      },
      performance: {
        pageLoad: metrics.pageLoad?.loadTime ? `${metrics.pageLoad.loadTime.toFixed(0)}ms` : 'N/A',
        clusterSwitch: metrics.clusterSwitch?.averageTime && !metrics.clusterSwitch.skipped
          ? `${metrics.clusterSwitch.averageTime.toFixed(0)}ms` 
          : 'N/A',
        search: metrics.search?.averageTime && metrics.search.averageTime > 0
          ? `${metrics.search.averageTime.toFixed(0)}ms` 
          : 'N/A',
        buildSize: metrics.buildSizeMB ? `${metrics.buildSizeMB.toFixed(2)} MB` : 'N/A'
      },
      status,
      errors: errors.length,
      deploymentValid
    };
    
    return summary;
  }
}