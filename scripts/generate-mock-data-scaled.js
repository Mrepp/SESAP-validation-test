import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { getTestConfig } from '../config/test-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../examples');
const TEST_MARKER_FILE = path.join(DATA_DIR, '.test-files.json');

// Constants for data generation
const MAJORS = [
  'Computer Science', 'Psychology', 'Biology', 'Business Administration',
  'English Literature', 'Political Science', 'Engineering', 'Nursing',
  'Economics', 'Communications', 'History', 'Chemistry', 'Physics',
  'Sociology', 'Art History', 'Mathematics', 'Philosophy', 'Education',
  'Environmental Science', 'International Relations'
];

const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior'];
const GENDERS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];
const INTERVIEW_FORMATS = ['In-person', 'Virtual', 'Phone'];
const INTERVIEWER_NAMES = [
  'Dr. Sarah Johnson', 'Dr. Michael Chen', 'Dr. Emily Williams',
  'Dr. Robert Davis', 'Dr. Lisa Anderson', 'Dr. James Wilson'
];

const THEME_CATEGORIES = [
  'Academic', 'Social', 'Financial', 'Personal Growth', 'Career',
  'Mental Health', 'Campus Life', 'Diversity & Inclusion'
];

const QUOTE_TAGS = [
  'advocacy', 'representation', 'community', 'leadership', 'challenge',
  'success', 'struggle', 'growth', 'support', 'barrier', 'opportunity',
  'identity', 'belonging', 'resilience', 'achievement'
];

// Helper functions
function generateUUID() {
  return crypto.randomUUID();
}

function generateId(prefix) {
  return `${prefix}_${Math.random().toString(36).substr(2, 9)}`;
}

function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function randomSubset(array, minSize = 1, maxSize = null) {
  const max = maxSize || array.length;
  const size = minSize + Math.floor(Math.random() * (max - minSize + 1));
  const shuffled = [...array].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, size);
}

function generateRecentDate() {
  const now = new Date();
  const pastDate = new Date(now.getTime() - Math.random() * 365 * 24 * 60 * 60 * 1000);
  return pastDate.toISOString().split('T')[0];
}

function generateLoremIpsum(wordCount) {
  const words = [
    'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
    'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
    'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud'
  ];
  
  const result = [];
  for (let i = 0; i < wordCount; i++) {
    result.push(randomChoice(words));
  }
  return result.join(' ');
}

// Track generated test files
async function trackTestFiles(files) {
  let existingFiles = [];
  try {
    const data = await fs.readFile(TEST_MARKER_FILE, 'utf-8');
    existingFiles = JSON.parse(data);
  } catch {
    // File doesn't exist yet
  }
  
  const allFiles = [...new Set([...existingFiles, ...files])];
  await fs.writeFile(TEST_MARKER_FILE, JSON.stringify(allFiles, null, 2));
  return allFiles;
}

// Clean up ALL non-base test files
export async function cleanupTestFiles() {
  const baseFiles = ['01.json', '02.json', '03.json', '04.json', '05.json', '06.json', '07.json', 'base.json'];
  
  try {
    const files = await fs.readdir(DATA_DIR);
    let deletedCount = 0;
    
    for (const file of files) {
      // Skip base files and non-JSON files
      if (baseFiles.includes(file) || !file.endsWith('.json')) {
        continue;
      }
      
      // Delete all other JSON files (test files)
      const filePath = path.join(DATA_DIR, file);
      try {
        await fs.unlink(filePath);
        console.log(`  Deleted: ${file}`);
        deletedCount++;
      } catch (error) {
        console.warn(`  Failed to delete ${file}: ${error.message}`);
      }
    }
    
    // Clean up marker file
    try {
      await fs.unlink(TEST_MARKER_FILE);
    } catch {
      // Marker file might not exist
    }
    
    console.log(`Cleanup complete! Deleted ${deletedCount} test files.`);
    return deletedCount;
  } catch (error) {
    console.log('Error during cleanup:', error.message);
    return 0;
  }
}

// Load base data from original files only
async function loadOrGenerateBaseData() {
  const baseFiles = ['01.json', '02.json', '03.json', '04.json', '05.json', '06.json', '07.json'];
  
  const allData = {
    summaries: [],
    themes: [],
    quotes: [],
    timelinePoints: [],
    areasForImprovement: []
  };
  
  for (const fileName of baseFiles) {
    try {
      const filePath = path.join(DATA_DIR, fileName);
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      
      if (data.analysis?.summaries) {
        allData.summaries.push(...data.analysis.summaries);
      }
      if (data.analysis?.themes) {
        allData.themes.push(...data.analysis.themes);
      }
      if (data.analysis?.quotes) {
        allData.quotes.push(...data.analysis.quotes);
      }
      if (data.analysis?.timelinePoints) {
        allData.timelinePoints.push(...data.analysis.timelinePoints);
      }
      if (data.analysis?.areasForImprovement) {
        allData.areasForImprovement.push(...data.analysis.areasForImprovement);
      }
    } catch (error) {
      console.warn(`Could not load base file ${fileName}:`, error.message);
    }
  }
  
  // If no data, generate some base content
  if (allData.summaries.length === 0) {
    allData.summaries = [
      { summaryText: 'Student discussed academic challenges and support systems.' },
      { summaryText: 'Financial concerns were a major topic throughout the interview.' },
      { summaryText: 'Social integration and campus community were highlighted.' }
    ];
  }
  
  if (allData.themes.length === 0) {
    allData.themes = [
      { title: 'Academic Success', description: 'Strategies for academic achievement' },
      { title: 'Campus Resources', description: 'Utilization of available support services' },
      { title: 'Personal Growth', description: 'Development during college years' }
    ];
  }
  
  if (allData.quotes.length === 0) {
    allData.quotes = [
      { quoteText: 'College has been transformative for me.' },
      { quoteText: 'I wish I had known about these resources earlier.' },
      { quoteText: 'The support from faculty made all the difference.' }
    ];
  }
  
  if (allData.timelinePoints.length === 0) {
    allData.timelinePoints = [
      { eventDescription: 'Started college with uncertainty' },
      { eventDescription: 'Found mentor in sophomore year' },
      { eventDescription: 'Decided on major after exploration' }
    ];
  }
  
  if (allData.areasForImprovement.length === 0) {
    allData.areasForImprovement = [
      { title: 'Communication', description: 'Better information dissemination needed' },
      { title: 'Resources', description: 'More support services required' }
    ];
  }
  
  return allData;
}

// Generate scaled mock interview
function generateScaledMockInterview(existingData, config, index) {
  const interviewId = generateUUID();
  const year = randomChoice(YEARS);
  const isFirstGen = Math.random() > 0.7;
  const major = randomChoice(MAJORS);
  const gender = randomChoice(GENDERS);
  
  // Generate summaries with scaling
  const summaryCount = config.content.summaries.min + 
    Math.floor(Math.random() * (config.content.summaries.max - config.content.summaries.min + 1));
  const selectedSummaries = [];
  for (let i = 0; i < summaryCount; i++) {
    const baseSummary = randomChoice(existingData.summaries);
    selectedSummaries.push({
      ...baseSummary,
      category: randomChoice(THEME_CATEGORIES),
      title: `Summary ${index + 1}.${i + 1}`,
      summaryText: baseSummary.summaryText || generateLoremIpsum(100 * config.interviews.sizeMultiplier),
      embedding: []
    });
  }
  
  // Generate themes with scaling
  const themeCount = config.content.themes.min + 
    Math.floor(Math.random() * (config.content.themes.max - config.content.themes.min + 1));
  const selectedThemes = [];
  for (let i = 0; i < themeCount; i++) {
    const baseTheme = existingData.themes.length > 0 ? 
      randomChoice(existingData.themes) : 
      { title: 'Generated Theme', description: 'Auto-generated theme description' };
    
    selectedThemes.push({
      ...baseTheme,
      themeId: generateId('theme'),
      category: randomChoice(THEME_CATEGORIES),
      frequency: Math.floor(Math.random() * 10) + 1,
      impactScore: Math.floor(Math.random() * 10) + 1,
      actionable: Math.random() > 0.5,
      relatedQuoteIds: [],
      description: baseTheme.description || generateLoremIpsum(50 * config.interviews.sizeMultiplier),
      embedding: []
    });
  }
  
  // Generate quotes with scaling
  const quoteCount = config.content.quotes.min + 
    Math.floor(Math.random() * (config.content.quotes.max - config.content.quotes.min + 1));
  const selectedQuotes = [];
  for (let i = 0; i < quoteCount; i++) {
    const quoteId = generateId('quote');
    const relatedTheme = randomChoice(selectedThemes);
    const baseQuote = existingData.quotes.length > 0 ?
      randomChoice(existingData.quotes) :
      { quoteText: generateLoremIpsum(30 * config.interviews.sizeMultiplier) };
    
    selectedQuotes.push({
      ...baseQuote,
      quoteId,
      quoteText: baseQuote.quoteText || generateLoremIpsum(30 * config.interviews.sizeMultiplier),
      context: 'Interview context',
      tags: randomSubset(QUOTE_TAGS, 1, Math.min(4, Math.ceil(4 * config.interviews.sizeMultiplier))),
      sentiment: randomChoice(['positive', 'negative', 'neutral', 'mixed']),
      significanceLevel: randomChoice(['high', 'medium', 'low']),
      timestamp: `${Math.floor(Math.random() * 45) + 1}:${Math.floor(Math.random() * 60).toString().padStart(2, '0')}`,
      relatedThemeIds: [relatedTheme.themeId],
      embedding: []
    });
  }
  
  // Link themes to quotes
  selectedThemes.forEach(theme => {
    const relatedQuotes = randomSubset(selectedQuotes, 1, Math.min(3, selectedQuotes.length));
    theme.relatedQuoteIds = relatedQuotes.map(q => q.quoteId);
  });
  
  // Generate timeline points
  const timelineCount = config.content.timelinePoints.min + 
    Math.floor(Math.random() * (config.content.timelinePoints.max - config.content.timelinePoints.min + 1));
  const selectedTimeline = [];
  for (let i = 0; i < timelineCount; i++) {
    const basePoint = existingData.timelinePoints.length > 0 ?
      randomChoice(existingData.timelinePoints) :
      { eventDescription: generateLoremIpsum(20 * config.interviews.sizeMultiplier) };
    
    selectedTimeline.push({
      ...basePoint,
      eventDescription: basePoint.eventDescription || generateLoremIpsum(20 * config.interviews.sizeMultiplier),
      timeframeType: randomChoice(['past', 'present', 'future', 'ongoing']),
      category: randomChoice(THEME_CATEGORIES),
      sentiment: randomChoice(['positive', 'negative', 'neutral', 'mixed']),
      embedding: []
    });
  }
  
  // Generate areas for improvement
  const improvementCount = config.content.areasForImprovement.min + 
    Math.floor(Math.random() * (config.content.areasForImprovement.max - config.content.areasForImprovement.min + 1));
  const selectedImprovements = [];
  for (let i = 0; i < improvementCount; i++) {
    const baseArea = existingData.areasForImprovement.length > 0 ?
      randomChoice(existingData.areasForImprovement) :
      { title: 'Improvement Area', description: generateLoremIpsum(40 * config.interviews.sizeMultiplier) };
    
    const actionItems = [
      'Implement new support systems',
      'Increase resource allocation',
      'Enhance communication channels',
      'Develop training programs',
      'Create feedback mechanisms'
    ];
    
    selectedImprovements.push({
      ...baseArea,
      areaId: generateId('area'),
      description: baseArea.description || generateLoremIpsum(40 * config.interviews.sizeMultiplier),
      priority: randomChoice(['high', 'medium', 'low']),
      stakeholders: randomSubset(['Students', 'Faculty', 'Administration'], 1, 3),
      actionItems: randomSubset(actionItems, 1, Math.min(actionItems.length, Math.ceil(2 * config.interviews.sizeMultiplier))),
      embedding: []
    });
  }
  
  const firstNames = {
    'Male': ['James', 'Michael', 'David', 'Robert', 'William'],
    'Female': ['Sarah', 'Emily', 'Jessica', 'Ashley', 'Michelle'],
    'Non-binary': ['Alex', 'Jordan', 'Taylor', 'Casey', 'Morgan'],
    'Prefer not to say': ['A.', '  B.', 'C.', 'D.', 'E.']
  };
  
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones'];
  const firstName = randomChoice(firstNames[gender] || firstNames['Non-binary']);
  const lastName = randomChoice(lastNames);
  
  return {
    interviewId,
    intervieweeName: `${firstName} ${lastName}`,
    interviewDate: generateRecentDate(),
    interviewFormat: randomChoice(INTERVIEW_FORMATS),
    interviewerName: randomChoice(INTERVIEWER_NAMES),
    demographics: {
      age: (18 + Math.floor(Math.random() * 5)).toString(),
      gender,
      major,
      year,
      other: isFirstGen ? 'First-generation college student' : ''
    },
    transcript: {
      fileName: `transcript_${interviewId}.txt`,
      fileType: 'text/plain',
      rawText: '[Transcript content]',
      wordCount: Math.floor(2000 * config.interviews.sizeMultiplier + Math.random() * 3000),
      validation: {
        minimumLengthCheck: {
          passed: true,
          warningIssued: false,
          overrideApprovedBy: ''
        }
      }
    },
    analysis: {
      model: {
        provider: 'OpenRouter',
        modelName: 'anthropic/claude-2',
        temperature: 0.7,
        promptVersion: '2.0',
        promptTemplateId: 'college-interview-v2'
      },
      summaries: selectedSummaries,
      timelinePoints: selectedTimeline,
      themes: selectedThemes,
      quotes: selectedQuotes,
      areasForImprovement: selectedImprovements
    },
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: '1.0',
      source: 'mock-generator-scaled',
      validatedBy: 'auto-generated',
      testConfig: {
        sizeMultiplier: config.interviews.sizeMultiplier,
        contentCounts: {
          summaries: selectedSummaries.length,
          themes: selectedThemes.length,
          quotes: selectedQuotes.length,
          timelinePoints: selectedTimeline.length,
          improvements: selectedImprovements.length
        }
      }
    }
  };
}

// Main generation function with cleanup
export async function generateMockDataScaled(interviewCount, sizeMultiplier, cleanup = true) {
  const config = getTestConfig(interviewCount, sizeMultiplier);
  
  // Always clean up previous test files first
  if (cleanup) {
    console.log('\n🧹 Cleaning up previous test files...');
    await cleanupTestFiles();
  }
  
  console.log('\nConfiguration:', JSON.stringify(config.interviews, null, 2));
  console.log('Loading base interview data...');
  
  const existingData = await loadOrGenerateBaseData();
  
  console.log(`Loaded base data:
  - ${existingData.summaries.length} summaries
  - ${existingData.themes.length} themes
  - ${existingData.quotes.length} quotes
  - ${existingData.timelinePoints.length} timeline points
  - ${existingData.areasForImprovement.length} areas for improvement`);
  
  // Ensure examples directory exists
  await fs.mkdir(DATA_DIR, { recursive: true });
  
  // Generate unique filenames for test files
  const generatedFiles = [];
  const timestamp = Date.now();
  
  for (let i = 0; i < config.interviews.count; i++) {
    const mockInterview = generateScaledMockInterview(existingData, config, i);
    
    // Use timestamp-based naming for test files
    const fileName = `test_${timestamp}_${i.toString().padStart(3, '0')}.json`;
    const filePath = path.join(DATA_DIR, fileName);
    
    await fs.writeFile(filePath, JSON.stringify(mockInterview, null, 2));
    generatedFiles.push(fileName);
    
    console.log(`Created: ${fileName} - ${mockInterview.intervieweeName} (${mockInterview.demographics.major})`);
  }
  
  // Track generated test files
  await trackTestFiles(generatedFiles);
  
  console.log(`\n✅ Generated ${config.interviews.count} test interviews`);
  
  // Return generation metadata
  return {
    config,
    generatedFiles,
    totalGenerated: config.interviews.count,
    timestamp: new Date().toISOString(),
    testId: timestamp
  };
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const interviewCount = parseInt(process.argv[2]) || undefined;
  const sizeMultiplier = parseFloat(process.argv[3]) || undefined;
  
  generateMockDataScaled(interviewCount, sizeMultiplier)
    .then(result => {
      console.log('\nGeneration complete!');
      console.log('Summary:', JSON.stringify(result, null, 2));
    })
    .catch(console.error);
}