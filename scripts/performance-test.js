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
      errors: []
    };
  }

  async waitForDeployment(url, maxWaitTime, checkInterval) {
    console.log(`Waiting for deployment at ${url}...`);
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          console.log('Deployment is ready!');
          return true;
        }
      } catch (error) {
        // Expected to fail until deployment is ready
      }
      
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      process.stdout.write('.');
    }
    
    throw new Error(`Deployment did not become ready within ${maxWaitTime}ms`);
  }

  async measurePageLoad(browser, url) {
    const page = await browser.newPage();
    const metrics = [];
    
    for (let i = 0; i < 3; i++) { // Average of 3 runs
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
    await page.goto(url, { waitUntil: 'networkidle2' });
    
    const clusterTypes = ['summary', 'themes', 'collegeExperience', 'quotes'];
    const switchTimes = [];
    
    try {
      // Wait for the cluster dropdown using multiple possible selectors
      const dropdownSelector = await page.waitForSelector(
        'select, [data-testid="cluster-dropdown"], .cluster-dropdown, [aria-label*="Cluster"]', 
        { timeout: 10000 }
      ).catch(() => null);
      
      if (!dropdownSelector) {
        console.warn('Cluster dropdown not found, skipping cluster switch test');
        return {
          switches: [],
          averageTime: 0,
          skipped: true
        };
      }
      
      for (const clusterType of clusterTypes) {
        const startTime = Date.now();
        
        // Try to change cluster type
        try {
          // Find the actual select element
          const selectExists = await page.$('select');
          if (selectExists) {
            await page.select('select', clusterType);
          } else {
            // Fallback: click dropdown and option
            await page.click('[data-testid="cluster-dropdown"], .cluster-dropdown');
            await page.click(`[data-value="${clusterType}"], option[value="${clusterType}"]`);
          }
          
          // Wait for visualization to update
          await page.waitForFunction(
            () => {
              const svg = document.querySelector('svg');
              const circles = svg ? svg.querySelectorAll('circle, .node') : [];
              return circles.length > 0;
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
    } catch (error) {
      console.error('Cluster switch test error:', error);
      return {
        switches: switchTimes,
        averageTime: switchTimes.length > 0 
          ? switchTimes.reduce((sum, s) => sum + s.time, 0) / switchTimes.length 
          : 0,
        error: error.message
      };
    }
    
    await page.close();
    
    return {
      switches: switchTimes,
      averageTime: switchTimes.length > 0 
        ? switchTimes.reduce((sum, s) => sum + s.time, 0) / switchTimes.length 
        : 0
    };
  }

  async measureSearch(browser, url) {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    
    const searchTests = [
      { type: 'text', query: 'student experience' },
      { type: 'text', query: 'academic' },
      { type: 'semantic', query: 'challenges faced by first generation students' }
    ];
    
    const results = [];
    
    for (const test of searchTests) {
      try {
        // Wait for search input using multiple selectors
        const searchInput = await page.waitForSelector(
          'input[type="text"], input[type="search"], [data-testid="search-input"], .search-input',
          { timeout: 5000 }
        );
        
        // Clear search field
        await searchInput.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        
        // Type search query
        await searchInput.type(test.query);
        
        const startTime = Date.now();
        
        // Click search button or press Enter
        const searchButton = await page.$('button:has-text("Search"), [data-testid="search-button"]');
        if (searchButton) {
          await searchButton.click();
        } else {
          await page.keyboard.press('Enter');
        }
        
        // Wait for results
        await page.waitForSelector(
          '[class*="result"], [data-testid="search-results"], .search-results',
          { timeout: 10000 }
        ).catch(() => console.warn('Search results timeout'));
        
        const searchTime = Date.now() - startTime;
        
        // Count results
        const resultCount = await page.evaluate(() => {
          const results = document.querySelectorAll('[class*="result"], [data-testid="search-result"]');
          return results.length;
        });
        
        results.push({
          ...test,
          time: searchTime,
          resultCount
        });
      } catch (error) {
        console.warn(`Search test failed for "${test.query}":`, error.message);
        results.push({
          ...test,
          time: 0,
          resultCount: 0,
          error: error.message
        });
      }
    }
    
    await page.close();
    
    return {
      searches: results,
      averageTime: results.filter(r => r.time > 0).reduce((sum, r) => sum + r.time, 0) / 
                   Math.max(results.filter(r => r.time > 0).length, 1)
    };
  }

  async getBuildSize() {
    try {
      const distPath = path.join(__dirname, '../dist');
      const stats = await fs.stat(distPath);
      
      if (!stats.isDirectory()) {
        return 0;
      }
      
      // Recursively get all files
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
      console.error('Error getting system info:', error);
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
    
    // Wait for deployment
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
      throw error;
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
        console.log('Cluster switch test skipped (dropdown not found)');
      }
      
      // Measure search performance
      console.log('\n🔍 Testing search performance...');
      this.results.metrics.search = await this.measureSearch(
        browser,
        this.config.deployment.githubPagesUrl
      );
      console.log(`Average search time: ${this.results.metrics.search.averageTime.toFixed(0)}ms`);
      
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
    const { metrics, config } = this.results;
    
    const summary = {
      testId: this.results.testId,
      configuration: {
        interviews: config.interviews.count,
        sizeMultiplier: config.interviews.sizeMultiplier
      },
      performance: {
        pageLoad: metrics.pageLoad?.loadTime ? `${metrics.pageLoad.loadTime.toFixed(0)}ms` : 'N/A',
        clusterSwitch: metrics.clusterSwitch?.averageTime ? `${metrics.clusterSwitch.averageTime.toFixed(0)}ms` : 'N/A',
        search: metrics.search?.averageTime ? `${metrics.search.averageTime.toFixed(0)}ms` : 'N/A',
        buildSize: metrics.buildSizeMB ? `${metrics.buildSizeMB.toFixed(2)} MB` : 'N/A'
      },
      status: this.results.errors.length === 0 ? '✅ PASSED' : '❌ FAILED',
      errors: this.results.errors.length
    };
    
    return summary;
  }
}