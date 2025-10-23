import { generateMockDataScaled, cleanupTestFiles } from './generate-mock-data-scaled.js';
import { PerformanceTestRunner } from './performance-test.js';
import { getTestConfig } from '../config/test-config.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function setupGitConfig() {
  // Set up git config for GitHub Actions and local testing
  console.log('Setting up Git configuration...');
  try {
    await execAsync('git config user.email "test@example.com"');
    await execAsync('git config user.name "Test User"');
    console.log('Git configuration set successfully');
  } catch (error) {
    console.warn('Git config already set or failed:', error.message);
  }
}

async function runCommand(command, description, critical = true) {
  console.log(`\n🔧 ${description}`);
  console.log(`   Command: ${command}`);
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, CI: 'true' }
    });
    
    if (stdout) console.log(stdout);
    if (stderr && !stderr.includes('warning')) console.error(stderr);
    
    return { success: true, stdout, stderr };
  } catch (error) {
    console.error(`Failed: ${error.message}`);
    if (critical) {
      throw error;
    }
    return { success: false, error };
  }
}

async function runFullTest(interviewCount, sizeMultiplier) {
  const testRun = {
    id: `fulltest_${Date.now()}`,
    startTime: new Date().toISOString(),
    config: getTestConfig(interviewCount, sizeMultiplier),
    phases: {},
    failed: false
  };
  
  console.log('========================================');
  console.log('🚀 FULL TEST SUITE');
  console.log('========================================');
  console.log(`Test ID: ${testRun.id}`);
  console.log(`Interviews: ${testRun.config.interviews.count}`);
  console.log(`Size Multiplier: ${testRun.config.interviews.sizeMultiplier}x`);
  console.log('========================================\n');
  
  let cleanupRequired = false;
  
  try {
    // Setup git config FIRST
    await setupGitConfig();
    
    // Phase 0: Clean up previous test files
    console.log('🧹 PHASE 0: Cleaning Previous Test Files');
    console.log('----------------------------------------');
    const cleanedFiles = await cleanupTestFiles();
    console.log(`Cleaned up ${cleanedFiles} previous test files`);
    
    // Phase 1: Generate mock data
    console.log('\n📝 PHASE 1: Generating Mock Data');
    console.log('----------------------------------------');
    
    const mockGeneration = await generateMockDataScaled(
      testRun.config.interviews.count,
      testRun.config.interviews.sizeMultiplier,
      false
    );
    
    cleanupRequired = true;
    
    testRun.phases.mockGeneration = {
      success: true,
      filesGenerated: mockGeneration.generatedFiles.length,
      details: mockGeneration
    };
    
    // Phase 2: Process only the new files
    console.log('\n🔮 PHASE 2: Processing Data & Embeddings');
    console.log('----------------------------------------');
    
    // Create a temporary process script that only processes new files
    const processScriptContent = `
import { processInterview } from './process-data.js';
import fs from 'fs/promises';
import path from 'path';

const testFiles = ${JSON.stringify(mockGeneration.generatedFiles)};
const DATA_DIR = path.join(process.cwd(), 'examples');

async function processTestFiles() {
  console.log('Processing only test files:', testFiles.length);
  
  for (const file of testFiles) {
    const filePath = path.join(DATA_DIR, file);
    await processInterview(filePath);
  }
  
  console.log('Test file processing complete');
}

processTestFiles().catch(console.error);
    `;
    
    const tempProcessScript = path.join(__dirname, '.temp-process.js');
    await fs.writeFile(tempProcessScript, processScriptContent);
    
    const processResult = await runCommand(
      `node ${tempProcessScript}`,
      'Processing test data only'
    );
    
    // Clean up temp script
    await fs.unlink(tempProcessScript).catch(() => {});
    
    // Now run the full process-data to rebuild indices
    const fullProcessResult = await runCommand(
      'npm run process-data',
      'Rebuilding search indices'
    );
    
    testRun.phases.dataProcessing = {
      success: processResult.success && fullProcessResult.success
    };
    
    if (!processResult.success || !fullProcessResult.success) {
      testRun.failed = true;
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
      testRun.failed = true;
      throw new Error('Site build failed');
    }
    
    // Phase 4: Deploy to GitHub Pages (non-critical in CI)
    console.log('\n🌍 PHASE 4: Deploying to GitHub Pages');
    console.log('----------------------------------------');
    
    const deployResult = await runCommand(
      'npx gh-pages -d dist --dotfiles',
      'Deploying to GitHub Pages',
      false // non-critical
    );
    
    testRun.phases.deployment = {
      success: deployResult.success,
      skipped: !deployResult.success
    };
    
    if (!deployResult.success) {
      console.warn('⚠️ Deployment skipped or failed (non-critical)');
    }
    
    // Phase 5: Run performance tests
    console.log('\n⚡ PHASE 5: Performance Testing');
    console.log('----------------------------------------');
    
    const perfRunner = new PerformanceTestRunner(testRun.config);
    const perfResults = await perfRunner.runTests();
    
    testRun.phases.performanceTest = {
      success: perfResults.errors.length === 0,
      results: perfResults
    };
    
    if (perfResults.errors.length > 0) {
      testRun.failed = true;
    }
    
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
    console.log(`Status: ${testRun.failed ? '❌ FAILED' : '✅ PASSED'}`);
    console.log('\nConfiguration:');
    console.log(`  - Interviews: ${testRun.summary.configuration.interviews}`);
    console.log(`  - Size Multiplier: ${testRun.summary.configuration.sizeMultiplier}x`);
    console.log('\nPerformance:');
    console.log(`  - Page Load: ${testRun.summary.performance.pageLoad}`);
    console.log(`  - Cluster Switch: ${testRun.summary.performance.clusterSwitch}`);
    console.log(`  - Search: ${testRun.summary.performance.search}`);
    console.log(`  - Build Size: ${testRun.summary.performance.buildSize}`);
    
    if (testRun.failed) {
      console.log('\n❌ Test completed with errors');
    } else {
      console.log('\n✅ Full test completed successfully!');
    }
    
    console.log(`Results saved to: ${resultsFile}`);
    
    // Get deployment URL
    const deploymentUrl = testRun.config.deployment.githubPagesUrl;
    console.log(`\n🌐 Site deployed at: ${deploymentUrl}`);
    
    return testRun;
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    testRun.error = error.message;
    testRun.endTime = new Date().toISOString();
    testRun.failed = true;
    
    // Save failed test results
    const resultsDir = path.join(__dirname, '../test-results');
    await fs.mkdir(resultsDir, { recursive: true });
    
    const resultsFile = path.join(resultsDir, `${testRun.id}_failed.json`);
    await fs.writeFile(resultsFile, JSON.stringify(testRun, null, 2));
    
    throw error;
  } finally {
    // Phase 6: Cleanup
    if (cleanupRequired) {
      console.log('\n🧹 PHASE 6: Cleaning Up Test Files');
      console.log('----------------------------------------');
      await cleanupTestFiles();
    }
  }
}

// Export for use in scripts
export { runFullTest };

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const interviewCount = parseInt(process.argv[2]) || undefined;
  const sizeMultiplier = parseFloat(process.argv[3]) || undefined;
  
  runFullTest(interviewCount, sizeMultiplier)
    .then((result) => process.exit(result.failed ? 1 : 0))
    .catch(() => process.exit(1));
}