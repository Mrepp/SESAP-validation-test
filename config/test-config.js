export const defaultTestConfig = {
  interviews: {
    count: 10,
    sizeMultiplier: 1.0
  },
  content: {
    summaries: { min: 2, max: 4 },
    themes: { min: 3, max: 6 },
    quotes: { min: 4, max: 8 },
    timelinePoints: { min: 3, max: 5 },
    areasForImprovement: { min: 2, max: 4 }
  },
  performance: {
    maxPageLoadTime: 3000, // ms
    maxClusterSwitchTime: 500, // ms
    maxSearchTime: 1000, // ms
    retryAttempts: 3,
    deploymentCheckInterval: 30000, // 30 seconds
    maxDeploymentWaitTime: 600000 // 10 minutes
  },
  deployment: {
    githubPagesUrl: process.env.GITHUB_PAGES_URL || 'https://your-username.github.io/college-interview-explorer',
    branch: 'gh-pages'
  }
};

export function getTestConfig(interviewCount, sizeMultiplier) {
  const config = JSON.parse(JSON.stringify(defaultTestConfig));
  
  if (interviewCount) {
    config.interviews.count = interviewCount;
  }
  
  if (sizeMultiplier) {
    config.interviews.sizeMultiplier = sizeMultiplier;
    
    // Scale content based on multiplier
    Object.keys(config.content).forEach(key => {
      config.content[key].min = Math.ceil(config.content[key].min * sizeMultiplier);
      config.content[key].max = Math.ceil(config.content[key].max * sizeMultiplier);
    });
  }
  
  return config;
}