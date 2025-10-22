import { generateMockDataScaled } from './generate-mock-data-scaled.js';
import { PerformanceTestRunner } from './performance-test.js';
import { getTestConfig } from '../config/test-config.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runCommand(command, description) {
  console.log(`\n🔧 ${description}`);
  console.log(`   Command: ${command}`);
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, CI: 'true' }
    });
    
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    
    return { success: true, stdout, stderr };
  } catch (error) {
    console.error(`Failed: ${error.message}`);
    return { success: false, error };
  }
}

async function runFullTest(interviewCount, sizeMultiplier) {
  const testRun = {
    id: `fulltest_${Date.now()}`,
    startTime: new Date().toISOString(),
    config: getTestConfig(interviewCount, sizeMultiplier),
    phases: {}
  };
  
  console.log('========================================');
  console.log('🚀 FULL TEST SUITE');
  console.log('========================================');
  console.log(`Test ID: ${testRun.id}`);
  console.log(`Interviews: ${testRun.config.interviews.count}`);
  console.log(`Size Multiplier: ${testRun.config.interviews.sizeMultiplier}x`);
  console.log('========================================\n');
  
  try {
    // Phase 1: Generate mock data
    console.log('📝 PHASE 1: Generating Mock Data');
    console.log('----------------------------------------');
    
    const mockGeneration = await generateMockDataScaled(
      testRun.config.interviews.count,
      testRun.config.interviews.sizeMultiplier
    );
    
    testRun.phases.mockGeneration = {
      success: true,
      filesGenerated: mockGeneration.generatedFiles.length,
      details: mockGeneration
    };
    
    // Phase 2: Process data (generate embeddings)
    console.log('\n🔮 PHASE 2: Processing Data & Embeddings');
    console.log('----------------------------------------');
    
    const processResult = await runCommand(
      'npm run process-data',
      'Generating embeddings and search indices'
    );
    
    testRun.phases.dataProcessing = {
      success: processResult.success,
      duration: processResult.duration
    };
    
    if (!processResult.success) {
      throw new Error('Data processing failed');
    }
    
    // Phase 3: Build static site
    console.log('\n🏗️ PHASE 3: Building Static Site');
    console.log('----------------------------------------');
    
    const buildResult = await runCommand(
      'npm run build',
      'Building production site'
    );
    
    testRun.phases.siteBuild = {
      success: buildResult.success
    };
    
    if (!buildResult.success) {
      throw new Error('Site build failed');
    }
    
    // Phase 4: Deploy to GitHub Pages
    console.log('\n🌍 PHASE 4: Deploying to GitHub Pages');
    console.log('----------------------------------------');
    
    // Check if gh-pages branch exists, create if not
    await runCommand(
      'git branch gh-pages 2>/dev/null || git checkout -b gh-pages',
      'Ensuring gh-pages branch exists'
    );
    
    // Deploy using gh-pages or similar
    const deployResult = await runCommand(
      'npx gh-pages -d dist --dotfiles',
      'Deploying to GitHub Pages'
    );
    
    testRun.phases.deployment = {
      success: deployResult.success
    };
    
    // Phase 5: Run performance tests
    console.log('\n⚡ PHASE 5: Performance Testing');
    console.log('----------------------------------------');
    
    const perfRunner = new PerformanceTestRunner(testRun.config);
    const perfResults = await perfRunner.runTests();
    
    testRun.phases.performanceTest = {
      success: perfResults.errors.length === 0,
      results: perfResults
    };
    
    // Generate final summary
    testRun.endTime = new Date().toISOString();
    testRun.summary = perfRunner.generateSummary();
    
    // Save complete test run results
    const resultsDir = path.join(__dirname, '../test-results');
    await fs.mkdir(resultsDir, { recursive: true });
    
    const resultsFile = path.join(resultsDir, `${testRun.id}_complete.json`);
    await fs.writeFile(resultsFile, JSON.stringify(testRun, null, 2));
    
    // Print summary
    console.log('\n========================================');
    console.log('📊 TEST SUMMARY');
    console.log('========================================');
    console.log(`Test ID: ${testRun.summary.testId}`);
    console.log(`Status: ${testRun.summary.status}`);
    console.log('\nConfiguration:');
    console.log(`  - Interviews: ${testRun.summary.configuration.interviews}`);
    console.log(`  - Size Multiplier: ${testRun.summary.configuration.sizeMultiplier}x`);
    console.log('\nPerformance:');
    console.log(`  - Page Load: ${testRun.summary.performance.pageLoad}`);
    console.log(`  - Cluster Switch: ${testRun.summary.performance.clusterSwitch}`);
    console.log(`  - Search: ${testRun.summary.performance.search}`);
    console.log(`  - Build Size: ${testRun.summary.performance.buildSize}`);
    console.log('\n✅ Full test completed successfully!');
    console.log(`Results saved to: ${resultsFile}`);
    
    return testRun;
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    testRun.error = error.message;
    testRun.endTime = new Date().toISOString();
    
    // Save failed test results
    const resultsDir = path.join(__dirname, '../test-results');
    await fs.mkdir(resultsDir, { recursive: true });
    
    const resultsFile = path.join(resultsDir, `${testRun.id}_failed.json`);
    await fs.writeFile(resultsFile, JSON.stringify(testRun, null, 2));
    
    throw error;
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const interviewCount = parseInt(process.argv[2]) || undefined;
  const sizeMultiplier = parseFloat(process.argv[3]) || undefined;
  
  runFullTest(interviewCount, sizeMultiplier)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}