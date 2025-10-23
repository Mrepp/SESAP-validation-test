import { Octokit } from '@octokit/rest';
import open from 'open';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

class WorkflowMonitor {
  constructor(token, owner, repo) {
    this.octokit = new Octokit({ auth: token });
    this.owner = owner;
    this.repo = repo;
  }

  async triggerWorkflow(interviewCount = 10, sizeMultiplier = 1.0, architecture = 0) {
    console.log('🚀 Triggering workflow...');
    
    // Determine runner label based on architecture
    let runnerLabel;
    switch (architecture) {
      case 1:
        runnerLabel = 'ubuntu-24.04-arm';
        console.log('   Architecture: ARM64');
        break;
      case 2:
        runnerLabel = 'both';
        console.log('   Architecture: Both x64 and ARM64');
        break;
      default:
        runnerLabel = 'ubuntu-latest';
        console.log('   Architecture: x64');
    }
    
    try {
      // Get the workflow ID
      const { data: workflows } = await this.octokit.actions.listRepoWorkflows({
        owner: this.owner,
        repo: this.repo
      });
      
      const workflow = workflows.workflows.find(w => 
        w.name === 'Test and Deploy' || w.path === '.github/workflows/test-and-deploy.yml'
      );
      
      if (!workflow) {
        throw new Error('Workflow not found');
      }
      
      // Trigger the workflow
      const response = await this.octokit.actions.createWorkflowDispatch({
        owner: this.owner,
        repo: this.repo,
        workflow_id: workflow.id,
        ref: 'main',
        inputs: {
          interview_count: String(interviewCount),
          size_multiplier: String(sizeMultiplier),
          runner_label: runnerLabel
        }
      });
      
      console.log('✅ Workflow triggered successfully');
      
      // Wait a bit for the run to be created
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Get the latest run
      const { data: runs } = await this.octokit.actions.listWorkflowRuns({
        owner: this.owner,
        repo: this.repo,
        workflow_id: workflow.id,
        per_page: 1
      });
      
      if (runs.workflow_runs.length > 0) {
        return runs.workflow_runs[0];
      }
      
      throw new Error('Could not find triggered run');
    } catch (error) {
      console.error('Failed to trigger workflow:', error.message);
      throw error;
    }
  }

  async monitorRun(runId) {
    console.log(`\n📊 Monitoring run ${runId}...`);
    
    const startTime = Date.now();
    let lastStatus = '';
    let spinnerIndex = 0;
    const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    
    while (true) {
      try {
        const { data: run } = await this.octokit.actions.getWorkflowRun({
          owner: this.owner,
          repo: this.repo,
          run_id: runId
        });
        
        if (run.status !== lastStatus) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          console.log(`\n[${elapsed}s] Status: ${run.status} | Conclusion: ${run.conclusion || 'pending'}`);
          lastStatus = run.status;
        }
        
        if (run.status === 'completed') {
          return run;
        }
        
        // Check jobs for more detail
        const { data: jobs } = await this.octokit.actions.listJobsForWorkflowRun({
          owner: this.owner,
          repo: this.repo,
          run_id: runId
        });
        
        for (const job of jobs.jobs) {
          if (job.status === 'in_progress' && job.steps) {
            const currentStep = job.steps.find(s => s.status === 'in_progress');
            if (currentStep) {
              process.stdout.write(`\r${spinnerChars[spinnerIndex]} Running: ${currentStep.name}...`);
              spinnerIndex = (spinnerIndex + 1) % spinnerChars.length;
            }
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        console.error('\nError monitoring run:', error.message);
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }

  async downloadArtifacts(runId) {
    console.log('\n\n📦 Downloading artifacts...');
    
    try {
      const { data: artifacts } = await this.octokit.actions.listWorkflowRunArtifacts({
        owner: this.owner,
        repo: this.repo,
        run_id: runId
      });
      
      const artifactsDir = path.join(__dirname, '../workflow-artifacts', `run-${runId}`);
      await fs.mkdir(artifactsDir, { recursive: true });
      
      for (const artifact of artifacts.artifacts) {
        console.log(`  📥 Downloading: ${artifact.name}`);
        
        const { data } = await this.octokit.actions.downloadArtifact({
          owner: this.owner,
          repo: this.repo,
          artifact_id: artifact.id,
          archive_format: 'zip'
        });
        
        const artifactPath = path.join(artifactsDir, `${artifact.name}.zip`);
        await fs.writeFile(artifactPath, Buffer.from(data));
        
        // Unzip the artifact
        try {
          await execAsync(`unzip -q -o "${artifactPath}" -d "${artifactsDir}/${artifact.name}"`, {
            cwd: artifactsDir
          });
          await fs.unlink(artifactPath);
        } catch (unzipError) {
          console.warn(`  ⚠️ Could not unzip ${artifact.name}`);
        }
      }
      
      console.log(`✅ Artifacts saved to: ${artifactsDir}`);
      return artifactsDir;
    } catch (error) {
      console.error('Failed to download artifacts:', error.message);
      return null;
    }
  }

  async getDeploymentUrl() {
    try {
      const { data: pages } = await this.octokit.repos.getPages({
        owner: this.owner,
        repo: this.repo
      });
      
      return pages.html_url;
    } catch (error) {
      return `https://${this.owner}.github.io/${this.repo}`;
    }
  }
}

async function main() {
  // Parse command line arguments
  const interviewCount = parseInt(process.argv[2]) || 10;
  const sizeMultiplier = parseFloat(process.argv[3]) || 1.0;
  const architecture = parseInt(process.argv[4]) || 0; // 0=x64, 1=arm64, 2=both
  
  console.log('========================================');
  console.log('🔍 GITHUB WORKFLOW MONITOR');
  console.log('========================================');
  console.log(`Configuration:`);
  console.log(`  - Interviews: ${interviewCount}`);
  console.log(`  - Size Multiplier: ${sizeMultiplier}x`);
  console.log(`  - Architecture: ${architecture === 0 ? 'x64' : architecture === 1 ? 'ARM64' : 'Both'}`);
  console.log('========================================\n');
  
  // Get GitHub token from environment
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('❌ GITHUB_TOKEN environment variable is required');
    console.log('\nSet it with:');
    console.log('  export GITHUB_TOKEN=your_token_here');
    console.log('\nOr create a personal access token at:');
    console.log('  https://github.com/settings/tokens');
    process.exit(1);
  }
  
  // Parse repository from git remote
  let owner, repo;
  try {
    const { stdout } = await execAsync('git remote get-url origin');
    const match = stdout.match(/github\.com[:/]([^/]+)\/([^.]+)/);
    if (match) {
      owner = match[1];
      repo = match[2].replace('.git', '');
    } else {
      throw new Error('Could not parse repository');
    }
  } catch (error) {
    console.error('Failed to determine repository:', error.message);
    console.log('Using defaults or environment variables...');
    owner = process.env.GITHUB_REPOSITORY_OWNER || 'your-username';
    repo = process.env.GITHUB_REPOSITORY || 'college-interview-explorer';
  }
  
  console.log(`Repository: ${owner}/${repo}\n`);
  
  const monitor = new WorkflowMonitor(token, owner, repo);
  
  try {
    // Trigger the workflow
    const run = await monitor.triggerWorkflow(interviewCount, sizeMultiplier, architecture);
    console.log(`\n🎯 Workflow run started: #${run.run_number}`);
    console.log(`   URL: ${run.html_url}`);
    
    // Open the run in browser
    console.log('\n🌐 Opening workflow in browser...');
    await open(run.html_url);
    
    // Monitor the run
    const completedRun = await monitor.monitorRun(run.id);
    
    console.log('\n\n========================================');
    console.log(`✅ Workflow completed: ${completedRun.conclusion}`);
    console.log(`   Duration: ${Math.floor((new Date(completedRun.updated_at) - new Date(completedRun.created_at)) / 1000)}s`);
    
    if (completedRun.conclusion === 'success') {
      // Download artifacts
      const artifactsDir = await monitor.downloadArtifacts(run.id);
      
      // Get deployment URL
      const deploymentUrl = await monitor.getDeploymentUrl();
      console.log(`\n🌍 Site deployed at: ${deploymentUrl}`);
      console.log('\n🚀 Opening deployed site...');
      await open(deploymentUrl);
      
      // Parse and display test results if available
      if (artifactsDir) {
        console.log('\n📊 Test Results Summary:');
        console.log('----------------------------------------');
        
        try {
          // Find test results file
          const testDirs = await fs.readdir(artifactsDir);
          for (const dir of testDirs) {
            if (dir.includes('test-results')) {
              const testPath = path.join(artifactsDir, dir);
              const files = await fs.readdir(testPath);
              const resultFile = files.find(f => f.includes('complete') && f.endsWith('.json'));
              
              if (resultFile) {
                const resultPath = path.join(testPath, resultFile);
                const results = JSON.parse(await fs.readFile(resultPath, 'utf-8'));
                
                if (results.summary) {
                  console.log(`\n📈 Performance Metrics (${dir}):`);
                  console.log(`  - Page Load: ${results.summary.performance.pageLoad}`);
                  console.log(`  - Cluster Switch: ${results.summary.performance.clusterSwitch}`);
                  console.log(`  - Search: ${results.summary.performance.search}`);
                  console.log(`  - Build Size: ${results.summary.performance.buildSize}`);
                  console.log(`  - Status: ${results.summary.status}`);
                }
              }
            }
          }
        } catch (error) {
          console.log('  ⚠️ Could not parse all test results');
        }
        
        console.log('\n📁 All artifacts available at:');
        console.log(`   ${artifactsDir}`);
      }
    } else {
      console.log('\n⚠️ Workflow did not complete successfully');
      console.log('Check the logs at:', completedRun.html_url);
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the monitor
main().catch(console.error);