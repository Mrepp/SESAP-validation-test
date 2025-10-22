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
    
    for (const clusterType of clusterTypes) {
      // Wait for dropdown to be available
      await page.waitForSelector('select', { timeout: 5000 });
      
      const startTime = Date.now();
      
      // Change cluster type
      await page.select('select', clusterType);
      
      // Wait for visualization to update (check for SVG changes)
      await page.waitForFunction(
        () => {
          const svg = document.querySelector('svg');
          return svg && svg.querySelectorAll('circle').length > 0;
        },
        { timeout: 5000 }
      );
      
      const switchTime = Date.now() - startTime;
      switchTimes.push({
        from: clusterTypes[clusterTypes.indexOf(clusterType) - 1] || 'initial',
        to: clusterType,
        time: switchTime
      });
    }
    
    await page.close();
    
    return {
      switches: switchTimes,
      averageTime: switchTimes.reduce((sum, s) => sum + s.time, 0) / switchTimes.length
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
      // Wait for search panel
      await page.waitForSelector('input[type="text"]', { timeout: 5000 });
      
      // Select search type if dropdown exists
      const searchTypeSelector = await page.$('select');
      if (searchTypeSelector && test.type === 'semantic') {
        await page.select('select', 'semantic');
        await page.waitForTimeout(500); // Wait for UI update
      }
      
      // Clear search field
      await page.click('input[type="text"]', { clickCount: 3 });
      await page.keyboard.press('Backspace');
      
      // Type search query
      await page.type('input[type="text"]', test.query);
      
      const startTime = Date.now();
      
      // Click search button
      await page.click('button:has-text("Search")');
      
      // Wait for results
      try {
        await page.waitForSelector('[class*="Results"]', { timeout: 10000 });
      } catch (error) {
        console.warn(`Search timeout for: ${test.query}`);
      }
      
      const searchTime = Date.now() - startTime;
      
      // Count results
      const resultCount = await page.evaluate(() => {
        const results = document.querySelectorAll('[class*="result"]');
        return results.length;
      });
      
      results.push({
        ...test,
        time: searchTime,
        resultCount
      });
    }
    
    await page.close();
    
    return {
      searches: results,
      averageTime: results.reduce((sum, r) => sum + r.time, 0) / results.length
    };
  }

  async getBuildSize() {
    try {
      const distPath = path.join(__dirname, '../dist');
      const stats = await fs.stat(distPath);
      
      if (!stats.isDirectory()) {
        return 0;
      }
      
      const files = await fs.readdir(distPath, { recursive: true });
      let totalSize = 0;
      
      for (const file of files) {
        const filePath = path.join(distPath, file);
        const fileStat = await fs.stat(filePath);
        if (fileStat.isFile()) {
          totalSize += fileStat.size;
        }
      }
      
      return totalSize / (1024 * 1024); // Convert to MB
    } catch (error) {
      console.error('Error calculating build size:', error);
      return 0;
    }
  }

  async getSystemInfo() {
    try {
      const { stdout: cpu } = await execAsync('nproc');
      const { stdout: mem } = await execAsync("free -m | awk 'NR==2{print $2}'");
      const { stdout: arch } = await execAsync('uname -m');
      const { stdout: os } = await execAsync('lsb_release -ds || cat /etc/*release | head -n1');
      
      return {
        cpu: parseInt(cpu.trim()),
        memoryMB: parseInt(mem.trim()),
        architecture: arch.trim(),
        os: os.trim(),
        nodeVersion: process.version,
        platform: process.platform
      };
    } catch (error) {
      console.error('Error getting system info:', error);
      return {
        cpu: 'unknown',
        memoryMB: 'unknown',
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
      args: ['--no-sandbox', '--disable-setuid-sandbox']
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
      console.log(`Average switch time: ${this.results.metrics.clusterSwitch.averageTime.toFixed(0)}ms`);
      
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
        pageLoad: `${metrics.pageLoad?.loadTime?.toFixed(0)}ms` || 'N/A',
        clusterSwitch: `${metrics.clusterSwitch?.averageTime?.toFixed(0)}ms` || 'N/A',
        search: `${metrics.search?.averageTime?.toFixed(0)}ms` || 'N/A',
        buildSize: `${metrics.buildSizeMB?.toFixed(2)} MB` || 'N/A'
      },
      status: this.results.errors.length === 0 ? '✅ PASSED' : '❌ FAILED',
      errors: this.results.errors.length
    };
    
    return summary;
  }
}