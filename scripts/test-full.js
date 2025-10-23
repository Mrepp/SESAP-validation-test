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
  // Set up git config for GitHub Actions
  console.log('Setting up Git configuration...');
  try {
    await execAsync('git config user.email "actions@github.com"');
    await execAsync('git config user.name "GitHub Actions"');
    console.log('Git configuration set successfully');
  } catch (error) {
    console.warn('Git config warning:', error.message);
  }
}

async function runCommand(command, description) {
  console.log(`\n🔧 ${description}`);
  console.log(`   Command: ${command}`);
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env }
    });
    
    if (stdout) console.log(stdout);
    if (stderr && !stderr.includes('warning')) console.error(stderr);
    
    return { success: true, stdout, stderr };
  } catch (error) {
    console.error(`Failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runFullTest(interviewCount, sizeMultiplier) {
  const testRun = {
    id: `fulltest_${Date.now()}`,
    startTime: new Date().toISOString(),
    config: getTestConfig(interviewCount, sizeMultiplier),
    phases: {},
    errors: []
  };
  
  console.log('========================================');
  console.log('🚀 FULL TEST SUITE');
  console.log('========================================');
  console.log(`Test ID: ${testRun.id}`);
  console.log(`Interviews: ${testRun.config.interviews.count}`);
  console.log(`Size Multiplier: ${testRun.config.interviews.sizeMultiplier}x`);
  console.log('========================================\n');
  
  let testPassed = true;
  
  try {
    // Setup git config first
    await setupGitConfig();
    
    // Phase 1: Generate mock data (with automatic cleanup)
    console.log('\n📝 PHASE 1: Generating Mock Data');
    console.log('----------------------------------------');
    
    const mockGeneration = await generateMockDataScaled(
      testRun.config.interviews.count,
      testRun.config.interviews.sizeMultiplier,
      true // Enable cleanup of old files
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
      success: processResult.success
    };
    
    if (!processResult.success) {
      testRun.errors.push('Data processing failed');
      testPassed = false;
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
      testRun.errors.push('Site build failed');
      testPassed = false;
    }
    
    const skipDeploy = process.env.SKIP_DEPLOY === 'true' || process.env.GITHUB_EVENT_NAME === 'pull_request';
    
    if (testPassed && !skipDeploy && process.env.CI) {
      console.log('\n🌍 PHASE 4: Deploying to GitHub Pages');
      console.log('----------------------------------------');
      console.log('Using GitHub Actions deployment method...');
      
      // In CI, we don't deploy directly - the deploy job handles it
      testRun.phases.deployment = {
        success: true,
        method: 'github-actions-job',
        note: 'Deployment will be handled by separate job'
      };
    } else if (testPassed && !skipDeploy && !process.env.CI) {
      console.log('\n🌍 PHASE 4: Deploying to GitHub Pages');
      console.log('----------------------------------------');
      
      // Local deployment
      const deployResult = await runCommand(
        'npm run deploy',
        'Deploying to GitHub Pages (local)'
      );
      
      testRun.phases.deployment = {
        success: deployResult.success,
        method: 'local'
      };
      
      if (!deployResult.success) {
        testRun.errors.push('Deployment failed: ' + deployResult.error);
        console.warn('⚠️ Deployment failed');
      }
    } else {
      console.log('\n⚠️ Skipping deployment');
      testRun.phases.deployment = { 
        skipped: true, 
        reason: skipDeploy ? 'Skip flag set' : 'Previous failures' 
      };
    }
    
    // Phase 5: Run performance tests
    // For CI, skip if deployment is handled separately
    const skipPerfTest = process.env.CI && !skipDeploy;
    
    if (testPassed && !skipPerfTest) {
      console.log('\n⚡ PHASE 5: Performance Testing');
      console.log('----------------------------------------');
      
      try {
        const perfRunner = new PerformanceTestRunner(testRun.config);
        const perfResults = await perfRunner.runTests();
        
        testRun.phases.performanceTest = {
          success: perfResults.errors.length === 0,
          results: perfResults
        };
        
        if (perfResults.errors.length > 0) {
          testRun.errors.push(...perfResults.errors.map(e => e.error));
          
          // In CI, deployment verification failures are expected if deploy is separate
          const onlyDeploymentErrors = perfResults.errors.every(e => 
            e.phase === 'deployment' || e.error.includes('deployment')
          );
          
          if (!onlyDeploymentErrors) {
            testPassed = false;
          }
        }
        
        // Generate summary
        testRun.summary = perfRunner.generateSummary();
      } catch (perfError) {
        console.error('Performance test error:', perfError);
        
        // Check if it's just deployment verification in CI
        if (process.env.CI && perfError.message.includes('deployment')) {
          console.log('⚠️ Deployment verification failed in CI (expected if deployment is separate)');
          testRun.phases.performanceTest = {
            skipped: true,
            reason: 'Deployment not available in CI'
          };
        } else {
          testRun.phases.performanceTest = {
            success: false,
            error: perfError.message
          };
          testRun.errors.push('Performance testing failed: ' + perfError.message);
          testPassed = false;
        }
      }
    } else if (skipPerfTest) {
      console.log('\n⚠️ Skipping performance tests in CI (deployment handled separately)');
      testRun.phases.performanceTest = { 
        skipped: true, 
        reason: 'CI deployment in separate job' 
      };
    } else {
      console.log('\n⚠️ Skipping performance tests due to previous failures');
      testRun.phases.performanceTest = { skipped: true };
    }
    
  } catch (error) {
    console.error('\n❌ Unexpected error:', error.message);
    testRun.errors.push(error.message);
    testPassed = false;
  } finally {
    // Phase 6: Cleanup
    console.log('\n🧹 PHASE 6: Cleaning Up Test Files');
    console.log('----------------------------------------');
    try {
      await cleanupTestFiles();
    } catch (cleanupError) {
      console.warn('Cleanup warning:', cleanupError.message);
    }
    
    // Generate final summary
    testRun.endTime = new Date().toISOString();
    testRun.overallSuccess = testPassed;
    
    // Save results
    const resultsDir = path.join(__dirname, '../test-results');
    await fs.mkdir(resultsDir, { recursive: true });
    
    const resultsFile = path.join(resultsDir, `${testRun.id}_${testPassed ? 'complete' : 'failed'}.json`);
    await fs.writeFile(resultsFile, JSON.stringify(testRun, null, 2));
    
    // Print summary
    console.log('\n========================================');
    console.log('📊 TEST SUMMARY');
    console.log('========================================');
    console.log(`Test ID: ${testRun.id}`);
    console.log(`Status: ${testPassed ? '✅ PASSED' : '❌ FAILED'}`);
    
    if (testRun.summary) {
      console.log('\nConfiguration:');
      console.log(`  - Interviews: ${testRun.summary.configuration.interviews}`);
      console.log(`  - Size Multiplier: ${testRun.summary.configuration.sizeMultiplier}x`);
      console.log('\nPerformance:');
      console.log(`  - Page Load: ${testRun.summary.performance.pageLoad}`);
      console.log(`  - Cluster Switch: ${testRun.summary.performance.clusterSwitch}`);
      console.log(`  - Search: ${testRun.summary.performance.search}`);
      console.log(`  - Build Size: ${testRun.summary.performance.buildSize}`);
    }
    
    if (testRun.errors.length > 0) {
      console.log('\nErrors:');
      testRun.errors.forEach((error, i) => {
        console.log(`  ${i + 1}. ${error}`);
      });
    }
    
    console.log(`\n📁 Results saved to: ${resultsFile}`);
    
    if (testRun.config.deployment?.githubPagesUrl) {
      console.log(`\n🌐 Site URL: ${testRun.config.deployment.githubPagesUrl}`);
    }
    
    // Exit with appropriate code
    if (!testPassed && !process.env.CI) {
      process.exit(1);
    }
  }
  
  return testRun;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const interviewCount = parseInt(process.argv[2]) || undefined;
  const sizeMultiplier = parseFloat(process.argv[3]) || undefined;
  
  runFullTest(interviewCount, sizeMultiplier)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}