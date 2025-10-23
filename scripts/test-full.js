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
  console.log('Setting up Git configuration...');
  try {
    await execAsync('git config user.email "actions@github.com"');
    await execAsync('git config user.name "GitHub Actions"');
    console.log('Git configuration set successfully');
  } catch (error) {
    console.warn('Git config warning:', error.message);
  }
}

async function runCommand(command, description, env = {}) {
  console.log(`\n🔧 ${description}`);
  console.log(`   Command: ${command}`);
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ...env }
    });
    
    if (stdout) console.log(stdout);
    if (stderr && !stderr.includes('warning')) console.error(stderr);
    
    return { success: true, stdout, stderr };
  } catch (error) {
    console.error(`Failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function deployWithAuth() {
  // For GitHub Actions, use the built-in token
  if (process.env.GITHUB_TOKEN) {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY || 'user/repo';
    
    // Use token-authenticated URL
    const authUrl = `https://x-access-token:${token}@github.com/${repo}.git`;
    
    return runCommand(
      `npx gh-pages -d dist --dotfiles --repo "${authUrl}"`,
      'Deploying to GitHub Pages with authentication'
    );
  } else {
    // Local deployment
    return runCommand(
      'npx gh-pages -d dist --dotfiles',
      'Deploying to GitHub Pages'
    );
  }
}

async function verifyDeployment(url, testId) {
  console.log(`\n🔍 Verifying deployment for test ${testId}...`);
  
  try {
    // Check if metadata.json contains our test ID
    const metadataUrl = `${url}/data/metadata.json`;
    const response = await fetch(metadataUrl);
    
    if (!response.ok) {
      console.log('Metadata not available yet');
      return false;
    }
    
    const metadata = await response.json();
    const deploymentTime = new Date(metadata.processedAt);
    const testTime = new Date();
    
    // Check if deployment is recent (within last 10 minutes)
    const timeDiff = testTime - deploymentTime;
    const isRecent = timeDiff < 10 * 60 * 1000; // 10 minutes
    
    console.log(`Deployment timestamp: ${metadata.processedAt}`);
    console.log(`Current test time: ${testTime.toISOString()}`);
    console.log(`Deployment is ${isRecent ? 'recent' : 'outdated'}`);
    
    return isRecent;
  } catch (error) {
    console.log('Could not verify deployment:', error.message);
    return false;
  }
}

async function runFullTest(interviewCount, sizeMultiplier) {
  const testRun = {
    id: `fulltest_${Date.now()}`,
    startTime: new Date().toISOString(),
    config: getTestConfig(interviewCount, sizeMultiplier),
    phases: {},
    errors: [],
    deploymentSuccess: false
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
    
    // Phase 4: Deploy to GitHub Pages (only if build succeeded)
    if (testPassed && process.env.CI) {
      console.log('\n🌍 PHASE 4: Deploying to GitHub Pages');
      console.log('----------------------------------------');
      
      const deployResult = await deployWithAuth();
      
      testRun.phases.deployment = {
        success: deployResult.success
      };
      
      if (deployResult.success) {
        testRun.deploymentSuccess = true;
        console.log('✅ Deployment successful');
        
        // Wait a bit for deployment to propagate
        console.log('Waiting for deployment to propagate...');
        await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds
      } else {
        testRun.errors.push('Deployment failed: ' + deployResult.error);
        testPassed = false;
      }
    } else if (!process.env.CI) {
      console.log('\n⚠️ Skipping deployment (not in CI environment)');
      testRun.phases.deployment = { skipped: true, reason: 'Not in CI' };
    } else {
      console.log('\n⚠️ Skipping deployment due to previous failures');
      testRun.phases.deployment = { skipped: true, reason: 'Previous failures' };
    }
    
    // Phase 5: Run performance tests (only if deployment succeeded)
    if (testRun.deploymentSuccess) {
      console.log('\n⚡ PHASE 5: Performance Testing');
      console.log('----------------------------------------');
      
      // Verify deployment is current
      const deploymentUrl = testRun.config.deployment.githubPagesUrl;
      const isCurrentDeployment = await verifyDeployment(deploymentUrl, testRun.id);
      
      if (isCurrentDeployment) {
        try {
          const perfRunner = new PerformanceTestRunner(testRun.config);
          const perfResults = await perfRunner.runTests();
          
          testRun.phases.performanceTest = {
            success: perfResults.errors.length === 0,
            results: perfResults
          };
          
          if (perfResults.errors.length > 0) {
            testRun.errors.push(...perfResults.errors.map(e => `Performance test: ${e.error || e}`));
            testPassed = false;
          }
          
          // Generate summary
          testRun.summary = perfRunner.generateSummary();
        } catch (perfError) {
          console.error('Performance test error:', perfError);
          testRun.phases.performanceTest = {
            success: false,
            error: perfError.message
          };
          testRun.errors.push('Performance testing failed: ' + perfError.message);
          testPassed = false;
        }
      } else {
        console.log('\n⚠️ Skipping performance tests - deployment not current');
        testRun.phases.performanceTest = { 
          skipped: true, 
          reason: 'Deployment not current or not accessible' 
        };
        testRun.errors.push('Could not verify current deployment');
        testPassed = false;
      }
    } else {
      console.log('\n⚠️ Skipping performance tests - deployment did not succeed');
      testRun.phases.performanceTest = { 
        skipped: true, 
        reason: 'No successful deployment' 
      };
    }
    
  } catch (error) {
    console.error('\n❌ Unexpected error:', error.message);
    testRun.errors.push(`Unexpected error: ${error.message}`);
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
    testRun.overallSuccess = testPassed && testRun.errors.length === 0;
    
    // Save results
    const resultsDir = path.join(__dirname, '../test-results');
    await fs.mkdir(resultsDir, { recursive: true });
    
    const resultsFile = path.join(resultsDir, `${testRun.id}_${testRun.overallSuccess ? 'complete' : 'failed'}.json`);
    await fs.writeFile(resultsFile, JSON.stringify(testRun, null, 2));
    
    // Print summary
    console.log('\n========================================');
    console.log('📊 TEST SUMMARY');
    console.log('========================================');
    console.log(`Test ID: ${testRun.id}`);
    console.log(`Overall Status: ${testRun.overallSuccess ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Deployment: ${testRun.deploymentSuccess ? '✅ Successful' : '❌ Failed or Skipped'}`);
    
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
      console.log('\n❌ Errors encountered:');
      testRun.errors.forEach((error, i) => {
        console.log(`  ${i + 1}. ${error}`);
      });
    }
    
    console.log(`\n📁 Results saved to: ${resultsFile}`);
    
    if (testRun.config.deployment?.githubPagesUrl) {
      console.log(`\n🌐 Site URL: ${testRun.config.deployment.githubPagesUrl}`);
      if (testRun.deploymentSuccess) {
        console.log('   ✅ Deployment verified and current');
      } else {
        console.log('   ⚠️ Deployment may not be current');
      }
    }
  }
  
  return testRun;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const interviewCount = parseInt(process.argv[2]) || undefined;
  const sizeMultiplier = parseFloat(process.argv[3]) || undefined;
  
  runFullTest(interviewCount, sizeMultiplier)
    .then((testRun) => {
      process.exit(testRun.overallSuccess ? 0 : 1);
    })
    .catch(() => process.exit(1));
}