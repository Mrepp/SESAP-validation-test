import { Octokit } from '@octokit/rest';
import open from 'open';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ARCHITECTURES = {
  0: 'x64',
  1: 'arm64',
  2: 'both'
};

class WorkflowMonitor {
  constructor(token, owner, repo) {
    this.octokit = new Octokit({ auth: token });
    this.owner = owner;
    this.repo = repo;
  }

  async triggerWorkflow(interviewCount = 10, sizeMultiplier = 1.0, architecture = 'x64') {
    console.log(`🚀 Triggering workflow for ${architecture}...`);
    
    try {
      // Get the workflow file based on architecture
      let workflowFile = '.github/workflows/test-and-deploy.yml';
      if (architecture === 'arm64') {
        workflowFile = '.github/workflows/test-arm64.yml';
      } else if (architecture === 'both') {
        // Trigger both workflows
        const x64Run = await this.triggerWorkflow(interviewCount, sizeMultiplier, 'x64');
        const arm64Run = await this.triggerWorkflow(interviewCount, sizeMultiplier, 'arm64');
        return { x64: x64Run, arm64: arm64Run, both: true };
      }
      
      // Get the workflow
      const { data: workflows } = await this.octokit.actions.listRepoWorkflows({
        owner: this.owner,
        repo: this.repo
      });
      
      const workflow = workflows.workflows.find(w => 
        w.path === workflowFile || w.name === 'Test and Deploy'
      );
      
      if (!workflow) {
        throw new Error(`Workflow not found: ${workflowFile}`);
      }
      
      // Trigger the workflow
      await this.octokit.actions.createWorkflowDispatch({
        owner: this.owner,
        repo: this.repo,
        workflow_id: workflow.id,
        ref: 'main',
        inputs: {
          interview_count: String(interviewCount),
          size_multiplier: String(sizeMultiplier),
          architecture: architecture
        }
      });
      
      console.log(`✅ Workflow triggered successfully for ${architecture}`);
      
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
      console.error(`Failed to trigger workflow for ${architecture}:`, error.message);
      throw error;
    }
  }

  async monitorRun(runId, label = '') {
    console.log(`\n📊 Monitoring run ${runId} ${label}...`);
    
    const startTime = Date.now();
    let lastStatus = '';
    let lastStep = '';
    
    while (true) {
      try {
        const { data: run } = await this.octokit.actions.getWorkflowRun({
          owner: this.owner,
          repo: this.repo,
          run_id: runId
        });
        
        if (run.status !== lastStatus) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          console.log(`[${elapsed}s] ${label} Status: ${run.status} | Conclusion: ${run.conclusion || 'pending'}`);
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
            if (currentStep && currentStep.name !== lastStep) {
              process.stdout.write(`\r${label} Running: ${currentStep.name}...                    `);
              lastStep = currentStep.name;
            }
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        console.error(`Error monitoring run ${label}:`, error.message);
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }

  async monitorMultipleRuns(runs) {
    console.log('\n📊 Monitoring multiple workflow runs...');
    
    const results = {};
    const promises = [];
    
    if (runs.x64) {
      promises.push(
        this.monitorRun(runs.x64.id, '[x64]').then(r => results.x64 = r)
      );
    }
    
    if (runs.arm64) {
      promises.push(
        this.monitorRun(runs.arm64.id, '[arm64]').then(r => results.arm64 = r)
      );
    }
    
    await Promise.all(promises);
    return results;
  }

  async downloadArtifacts(runId, architecture = '') {
    console.log(`\n📦 Downloading artifacts ${architecture}...`);
    
    try {
      const { data: artifacts } = await this.octokit.actions.listWorkflowRunArtifacts({
        owner: this.owner,
        repo: this.repo,
        run_id: runId
      });
      
      const artifactsDir = path.join(__dirname, '../workflow-artifacts', `run-${runId}${architecture ? `-${architecture}` : ''}`);
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
        try {
          await execAsync(`unzip -o "${artifactPath}" -d "${artifactsDir}/${artifact.name}"`, {
            cwd: artifactsDir
          });
          await fs.unlink(artifactPath);
        } catch (error) {
          console.warn(`Failed to unzip ${artifact.name}: ${error.message}`);
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

  async printTestResults(artifactsDir, architecture = '') {
    console.log(`\n📊 Test Results ${architecture}:`);
    
    try {
      const testResultsPath = path.join(artifactsDir, `test-results-${architecture || 'x64'}-node18`);
      const files = await fs.readdir(testResultsPath);
      const resultFile = files.find(f => f.endsWith('_complete.json'));
      
      if (resultFile) {
        const resultPath = path.join(testResultsPath, resultFile);
        const results = JSON.parse(await fs.readFile(resultPath, 'utf-8'));
        
        console.log(`\n📈 Performance Summary ${architecture}:`);
        console.log(`  - Page Load: ${results.summary?.performance?.pageLoad || 'N/A'}`);
        console.log(`  - Cluster Switch: ${results.summary?.performance?.clusterSwitch || 'N/A'}`);
        console.log(`  - Search: ${results.summary?.performance?.search || 'N/A'}`);
        console.log(`  - Build Size: ${results.summary?.performance?.buildSize || 'N/A'}`);
        console.log(`  - Status: ${results.summary?.status || 'Unknown'}`);
        
        if (results.systemInfo) {
          console.log(`\n💻 System Info ${architecture}:`);
          console.log(`  - CPU: ${results.systemInfo.cpu}`);
          console.log(`  - Memory: ${results.systemInfo.memoryMB} MB`);
          console.log(`  - Architecture: ${results.systemInfo.architecture}`);
          console.log(`  - OS: ${results.systemInfo.os}`);
        }
      }
    } catch (error) {
      console.log(`Could not parse test results for ${architecture}: ${error.message}`);
    }
  }
}

async function main() {
  // Parse command line arguments
  const interviewCount = parseInt(process.argv[2]) || 10;
  const sizeMultiplier = parseFloat(process.argv[3]) || 1.0;
  const architectureCode = parseInt(process.argv[4]) || 0;
  const architecture = ARCHITECTURES[architectureCode] || 'x64';
  
  console.log('========================================');
  console.log('🔍 GITHUB WORKFLOW MONITOR');
  console.log('========================================');
  console.log(`Configuration:`);
  console.log(`  - Interviews: ${interviewCount}`);
  console.log(`  - Size Multiplier: ${sizeMultiplier}x`);
  console.log(`  - Architecture: ${architecture} (${architectureCode})`);
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
    // Trigger the workflow(s)
    const runs = await monitor.triggerWorkflow(interviewCount, sizeMultiplier, architecture);
    
    if (architecture === 'both') {
      console.log(`\n🎯 Workflows started:`);
      console.log(`   x64: #${runs.x64.run_number} - ${runs.x64.html_url}`);
      console.log(`   arm64: #${runs.arm64.run_number} - ${runs.arm64.html_url}`);
      
      // Monitor both runs
      const completedRuns = await monitor.monitorMultipleRuns(runs);
      
      console.log('\n========================================');
      console.log('✅ All workflows completed');
      
      // Download artifacts for both
      if (completedRuns.x64?.conclusion === 'success') {
        const artifactsDir = await monitor.downloadArtifacts(runs.x64.id, 'x64');
        if (artifactsDir) {
          await monitor.printTestResults(artifactsDir, 'x64');
        }
      }
      
      if (completedRuns.arm64?.conclusion === 'success') {
        const artifactsDir = await monitor.downloadArtifacts(runs.arm64.id, 'arm64');
        if (artifactsDir) {
          await monitor.printTestResults(artifactsDir, 'arm64');
        }
      }
    } else {
      console.log(`\n🎯 Workflow run started: #${runs.run_number}`);
      console.log(`   URL: ${runs.html_url}`);
      
      // Open the run in browser
      console.log('\n🌐 Opening workflow in browser...');
      open(runs.html_url);
      
      // Monitor the run
      const completedRun = await monitor.monitorRun(runs.id);
      
      console.log('\n========================================');
      console.log(`✅ Workflow completed: ${completedRun.conclusion}`);
      console.log(`   Duration: ${Math.floor((new Date(completedRun.updated_at) - new Date(completedRun.created_at)) / 1000)}s`);
      
      if (completedRun.conclusion === 'success') {
        // Download artifacts
        const artifactsDir = await monitor.downloadArtifacts(runs.id);
        
        // Get deployment URL
        const deploymentUrl = await monitor.getDeploymentUrl();
        console.log(`\n🌍 Site deployed at: ${deploymentUrl}`);
        console.log('\n🚀 Opening deployed site...');
        open(deploymentUrl);
        
        // Print test results
        if (artifactsDir) {
          await monitor.printTestResults(artifactsDir, architecture);
        }
      } else {
        console.log('\n⚠️ Workflow did not complete successfully');
        console.log('Check the logs at:', completedRun.html_url);
      }
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the monitor
main().catch(console.error);