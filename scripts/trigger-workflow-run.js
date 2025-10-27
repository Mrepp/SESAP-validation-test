import { Octokit } from '@octokit/rest';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const defaults = {
    interviews: 10,
    size: 1.0,
    pagesTimeoutSeconds: 600, // 10 minutes
    pollSeconds: 5
  };

  const options = { ...defaults };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--interviews' || arg === '-n') {
      const value = argv[i + 1];
      if (value) {
        options.interviews = Number.parseInt(value, 10);
        i += 1;
      }
      continue;
    }

    if (arg.startsWith('--interviews=')) {
      options.interviews = Number.parseInt(arg.split('=')[1], 10);
      continue;
    }

    if (arg === '--size' || arg === '-s') {
      const value = argv[i + 1];
      if (value) {
        options.size = Number.parseFloat(value);
        i += 1;
      }
      continue;
    }

    if (arg.startsWith('--size=')) {
      options.size = Number.parseFloat(arg.split('=')[1]);
      continue;
    }

    if (arg === '--pages-timeout') {
      const value = argv[i + 1];
      if (value) {
        options.pagesTimeoutSeconds = Number.parseFloat(value);
        i += 1;
      }
      continue;
    }

    if (arg.startsWith('--pages-timeout=')) {
      options.pagesTimeoutSeconds = Number.parseFloat(arg.split('=')[1]);
      continue;
    }

    if (arg === '--poll') {
      const value = argv[i + 1];
      if (value) {
        options.pollSeconds = Number.parseFloat(value);
        i += 1;
      }
      continue;
    }

    if (arg.startsWith('--poll=')) {
      options.pollSeconds = Number.parseFloat(arg.split('=')[1]);
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    positional.push(arg);
  }

  if (positional.length > 0 && Number.isNaN(options.interviews)) {
    options.interviews = Number.parseInt(positional[0], 10);
  } else if (positional.length > 0) {
    options.interviews = Number.parseInt(positional[0], 10);
  }

  if (positional.length > 1 && Number.isNaN(options.size)) {
    options.size = Number.parseFloat(positional[1]);
  } else if (positional.length > 1) {
    options.size = Number.parseFloat(positional[1]);
  }

  if (!Number.isFinite(options.interviews) || options.interviews <= 0) {
    throw new Error('Interview count must be a positive integer.');
  }

  if (!Number.isFinite(options.size) || options.size <= 0) {
    throw new Error('Size multiplier must be a positive number.');
  }

  if (!Number.isFinite(options.pagesTimeoutSeconds) || options.pagesTimeoutSeconds <= 0) {
    options.pagesTimeoutSeconds = defaults.pagesTimeoutSeconds;
  }

  if (!Number.isFinite(options.pollSeconds) || options.pollSeconds <= 0) {
    options.pollSeconds = defaults.pollSeconds;
  }

  return options;
}

async function resolveRepository() {
  try {
    const { stdout } = await execAsync('git remote get-url origin', { cwd: ROOT_DIR });
    const remoteUrl = stdout.trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/i);

    if (match) {
      return { owner: match[1], repo: match[2] };
    }

    throw new Error(`Could not parse GitHub repository from remote URL: ${remoteUrl}`);
  } catch (error) {
    const envRepo = process.env.GITHUB_REPOSITORY;
    if (envRepo) {
      const [owner, repo] = envRepo.split('/');
      if (owner && repo) {
        return { owner, repo };
      }
    }
    throw new Error('Unable to determine GitHub repository. Configure git remote origin or set GITHUB_REPOSITORY.');
  }
}

async function findWorkflow(octokit, owner, repo) {
  const workflowPath = '.github/workflows/test-and-deploy.yml';
  const { data } = await octokit.actions.listRepoWorkflows({ owner, repo });
  const workflow = data.workflows.find(
    item => item.path === workflowPath || item.name === 'Test and Deploy'
  );

  if (!workflow) {
    throw new Error(`Workflow "${workflowPath}" not found in ${owner}/${repo}.`);
  }

  return workflow;
}

async function waitForRunCreation(octokit, owner, repo, workflowId, requestedAt, pollMs, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await octokit.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id: workflowId,
      per_page: 10
    });

    const runs = response.data.workflow_runs || [];
    const match = runs.find(run => {
      if (run.event !== 'workflow_dispatch') {
        return false;
      }
      const createdAt = new Date(run.created_at).getTime();
      return createdAt >= requestedAt - pollMs;
    });

    if (match) {
      return match;
    }

    await delay(pollMs);
  }

  throw new Error('Timed out waiting for GitHub Actions run to start.');
}

async function triggerWorkflow(octokit, owner, repo, workflowId, inputs, pollMs) {
  const requestedAt = Date.now();

  await octokit.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: workflowId,
    ref: 'main',
    inputs
  });

  return waitForRunCreation(
    octokit,
    owner,
    repo,
    workflowId,
    requestedAt,
    pollMs,
    60_000
  );
}

async function monitorRun(octokit, owner, repo, runId, pollMs) {
  let lastStatus = '';
  const jobState = new Map();

  while (true) {
    const { data: run } = await octokit.actions.getWorkflowRun({
      owner,
      repo,
      run_id: runId
    });

    if (run.status !== lastStatus) {
      console.log(`[workflow] Status: ${run.status} (conclusion: ${run.conclusion || 'pending'})`);
      lastStatus = run.status;
    }

    const { data: jobResponse } = await octokit.actions.listJobsForWorkflowRun({
      owner,
      repo,
      run_id: runId
    });

    const jobs = jobResponse.jobs || [];

    for (const job of jobs) {
      const prev = jobState.get(job.name);
      const statusChanged = !prev || prev.status !== job.status;
      const conclusionChanged = !prev || prev.conclusion !== job.conclusion;

      if (statusChanged || conclusionChanged) {
        const detail = job.status === 'completed'
          ? `conclusion=${job.conclusion}`
          : `status=${job.status}`;
        console.log(`[job:${job.name}] ${detail}`);
      }

      jobState.set(job.name, {
        status: job.status,
        conclusion: job.conclusion,
        started_at: job.started_at,
        completed_at: job.completed_at,
        id: job.id
      });
    }

    if (run.status === 'completed') {
      return { run, jobs: jobState };
    }

    await delay(pollMs);
  }
}

async function waitForPagesBuild(octokit, owner, repo, notBefore, pollMs, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = '';

  while (Date.now() < deadline) {
    try {
      const response = await octokit.repos.listPagesBuilds({
        owner,
        repo,
        per_page: 1
      });

      const builds = Array.isArray(response.data)
        ? response.data
        : response.data.builds || [];

      if (builds.length === 0) {
        console.log('[pages] No builds found yet. Waiting...');
      } else {
        const latest = builds[0];
        const buildUpdated = new Date(latest.updated_at || latest.created_at || latest.pushed_at).getTime();
        const status = latest.status || latest.state || 'unknown';

        if (status !== lastStatus) {
          console.log(`[pages] Latest build status: ${status}`);
          lastStatus = status;
        }

        if (buildUpdated >= notBefore) {
          if (status === 'built') {
            return latest;
          }

          if (status === 'errored' || status === 'failed') {
            throw new Error('GitHub Pages build failed.');
          }
        }
      }
    } catch (error) {
      if (error.status === 404) {
        throw new Error('GitHub Pages is not enabled for this repository.');
      }

      if (error.status === 409) {
        console.log('[pages] Pages configuration pending. Waiting...');
      } else {
        console.warn(`[pages] Polling error: ${error.message}`);
      }
    }

    await delay(pollMs);
  }

  throw new Error('Timed out waiting for GitHub Pages to complete deployment.');
}

async function getPagesUrl(octokit, owner, repo) {
  try {
    const { data } = await octokit.repos.getPages({ owner, repo });
    return { url: data.html_url, status: data.status };
  } catch (error) {
    if (error.status === 404) {
      return { url: `https://${owner}.github.io/${repo}`, status: 'unknown' };
    }
    throw error;
  }
}

function printHelp() {
  console.log(`
Usage: node scripts/trigger-workflow-run.js [options]

Options:
  -n, --interviews <count>      Number of interviews to generate (default: 10)
  -s, --size <multiplier>       Size multiplier for interview content (default: 1.0)
      --pages-timeout <sec>     Seconds to wait for Pages build (default: 600)
      --poll <sec>              Poll interval in seconds (default: 5)
  -h, --help                    Show this help message

Examples:
  node scripts/trigger-workflow-run.js 25 1.5
  node scripts/trigger-workflow-run.js --interviews=40 --size=2 --pages-timeout=900
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required to trigger the workflow.');
  }

  const { owner, repo } = await resolveRepository();
  console.log('========================================');
  console.log('🌐 GitHub Pages Deployment Orchestrator');
  console.log('========================================');
  console.log(`Repository: ${owner}/${repo}`);
  console.log(`Interviews: ${args.interviews}`);
  console.log(`Size multiplier: ${args.size}`);
  console.log(`Pages timeout: ${args.pagesTimeoutSeconds}s`);
  console.log('========================================\n');

  const octokit = new Octokit({ auth: token });

  const workflow = await findWorkflow(octokit, owner, repo);
  console.log(`Using workflow: ${workflow.name} (${workflow.path})`);

  const run = await triggerWorkflow(
    octokit,
    owner,
    repo,
    workflow.id,
    {
      interview_count: String(args.interviews),
      size_multiplier: String(args.size)
    },
    args.pollSeconds * 1000
  );

  console.log(`\n🚀 Workflow run created: #${run.run_number}`);
  console.log(`   URL: ${run.html_url}`);

  const { run: completedRun, jobs } = await monitorRun(
    octokit,
    owner,
    repo,
    run.id,
    args.pollSeconds * 1000
  );

  if (completedRun.conclusion !== 'success') {
    throw new Error(`Workflow completed with conclusion: ${completedRun.conclusion || 'unknown'}`);
  }

  const deployJob = jobs.get('deploy');
  if (!deployJob) {
    throw new Error('Deploy job did not run. Ensure workflow conditions allow deployment.');
  }

  if (deployJob.conclusion !== 'success') {
    throw new Error(`Deploy job concluded with status: ${deployJob.conclusion}`);
  }

  const deployFinishedAt = new Date(deployJob.completed_at || completedRun.updated_at).getTime();
  const pagesInfo = await getPagesUrl(octokit, owner, repo);

  let pagesBuild = null;
  try {
    pagesBuild = await waitForPagesBuild(
      octokit,
      owner,
      repo,
      deployFinishedAt,
      args.pollSeconds * 1000,
      args.pagesTimeoutSeconds * 1000
    );
  } catch (error) {
    console.warn(`⚠️ ${error.message}`);
  }

  console.log('\n========================================');
  console.log('✅ Workflow completed successfully');
  if (pagesBuild) {
    console.log(`GitHub Pages build status: ${pagesBuild.status}`);
    if (pagesBuild.updated_at) {
      console.log(`Pages updated at: ${pagesBuild.updated_at}`);
    }
  } else {
    console.log('GitHub Pages build status: Not confirmed (see warning above).');
  }
  console.log(`Run details: ${completedRun.html_url}`);
  console.log(`Live site: ${pagesInfo.url}`);
  console.log('========================================');
}

main().catch(error => {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
