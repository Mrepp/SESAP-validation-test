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

  async triggerWorkflow(interviewCount = 10, sizeMultiplier = 1.0) {
    console.log('🚀 Triggering workflow...');
    
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
          size_multiplier: String(sizeMultiplier)
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
    
    while (true) {
      try {
        const { data: run } = await this.octokit.actions.getWorkflowRun({
          owner: this.owner,
          repo: this.repo,
          run_id: runId
        });
        
        if (run.status !== lastStatus) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          console.log(`[${elapsed}s] Status: ${run.status} | Conclusion: ${run.conclusion || 'pending'}`);
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
              process.stdout.write(`\r  Running: ${currentStep.name}...`);
            }
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        console.error('Error monitoring run:', error.message);
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }

  async downloadArtifacts(runId) {
    console.log('\n📦 Downloading artifacts...');
    
    try {
      const { data: artifacts } = await this.octokit.actions.listWorkflowRunArtifacts({
        owner: this.owner,
        repo: this.repo,
        run_id: runId
      });
      
      const artifactsDir = path.join(__dirname, '../workflow-artifacts', `run-${runId}`);
      await fs.mkdir(artifactsDir, { recursive: true });
      
      for (const artifact of artifacts.artifacts) {
        console.log(`  Downloading: ${artifact.name}`);
        
        const { data } = await this.octokit.actions.downloadArtifact({
          owner: this.owner,
          repo: this.repo,
          artifact_id: artifact.id,
          archive_format: 'zip'
        });
        
        const artifactPath = path.join(artifactsDir, `${artifact.name}.zip`);
        await fs.writeFile(artifactPath, Buffer.from(data));
        
        // Unzip the artifact
        await execAsync(`unzip -o "${artifactPath}" -d "${artifactsDir}/${artifact.name}"`, {
          cwd: artifactsDir
        });
        
        // Remove the zip file
        await fs.unlink(artifactPath);
      }
      
      console.log(`✅ Artifacts saved to: ${artifactsDir}`);
      return artifactsDir;
    } catch (error) {
      console.error('Failed to download artifacts:', error.message);
      return null;
    }
  }

  async getDeploymentUrl() {
    // Get pages URL
    try {
      const { data: pages } = await this.octokit.repos.getPages({
        owner: this.owner,
        repo: this.repo
      });
      
      return pages.html_url;
    } catch (error) {
      // Fallback to constructed URL
      return `https://${this.owner}.github.io/${this.repo}`;
    }
  }
}

async function main() {
  // Parse command line arguments
  const interviewCount = parseInt(process.argv[2]) || 10;
  const sizeMultiplier = parseFloat(process.argv[3]) || 1.0;
  
  console.log('========================================');
  console.log('🔍 GITHUB WORKFLOW MONITOR');
  console.log('========================================');
  console.log(`Configuration:`);
  console.log(`  - Interviews: ${interviewCount}`);
  console.log(`  - Size Multiplier: ${sizeMultiplier}x`);
  console.log('========================================\n');
  
  // Get GitHub token from environment
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('❌ GITHUB_TOKEN environment variable is required');
    console.log('\nSet it with: export GITHUB_TOKEN=your_token_here');
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
    console.log('Using defaults...');
    owner = process.env.GITHUB_REPOSITORY_OWNER || 'your-username';
    repo = process.env.GITHUB_REPOSITORY || 'college-interview-explorer';
  }
  
  console.log(`Repository: ${owner}/${repo}\n`);
  
  const monitor = new WorkflowMonitor(token, owner, repo);
  
  try {
    // Trigger the workflow
    const run = await monitor.triggerWorkflow(interviewCount, sizeMultiplier);
    console.log(`\n🎯 Workflow run started: #${run.run_number}`);
    console.log(`   URL: ${run.html_url}`);
    
    // Open the run in browser
    console.log('\n🌐 Opening workflow in browser...');
    open(run.html_url);
    
    // Monitor the run
    const completedRun = await monitor.monitorRun(run.id);
    
    console.log('\n========================================');
    console.log(`✅ Workflow completed: ${completedRun.conclusion}`);
    console.log(`   Duration: ${Math.floor((new Date(completedRun.updated_at) - new Date(completedRun.created_at)) / 1000)}s`);
    
    if (completedRun.conclusion === 'success') {
      // Download artifacts
      const artifactsDir = await monitor.downloadArtifacts(run.id);
      
      // Get deployment URL
      const deploymentUrl = await monitor.getDeploymentUrl();
      console.log(`\n🌍 Site deployed at: ${deploymentUrl}`);
      console.log('\n🚀 Opening deployed site...');
      open(deploymentUrl);
      
      // Open test results if available
      if (artifactsDir) {
        console.log('\n📊 Opening test results...');
        const testResultsPath = path.join(artifactsDir, 'test-results-x64-node18');
        
        try {
          const files = await fs.readdir(testResultsPath);
          const resultFile = files.find(f => f.endsWith('_complete.json'));
          
          if (resultFile) {
            const resultPath = path.join(testResultsPath, resultFile);
            const results = JSON.parse(await fs.readFile(resultPath, 'utf-8'));
            
            console.log('\n📈 Performance Summary:');
            console.log(`  - Page Load: ${results.summary.performance.pageLoad}`);
            console.log(`  - Cluster Switch: ${results.summary.performance.clusterSwitch}`);
            console.log(`  - Search: ${results.summary.performance.search}`);
            console.log(`  - Build Size: ${results.summary.performance.buildSize}`);
          }
        } catch (error) {
          console.log('Could not parse test results');
        }
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