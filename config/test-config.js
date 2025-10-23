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
    maxPageLoadTime: 3000,
    maxClusterSwitchTime: 500,
    maxSearchTime: 1000,
    retryAttempts: 3,
    // Shorter wait times in CI since deployment is separate
    deploymentCheckInterval: process.env.CI ? 10000 : 30000, // 10s in CI, 30s local
    maxDeploymentWaitTime: process.env.CI ? 60000 : 600000  // 1 min in CI, 10 min local
  },
  deployment: {
    githubPagesUrl: process.env.GITHUB_PAGES_URL || 'https://your-username.github.io/college-interview-explorer',
    branch: 'gh-pages'
  }
};