import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../examples');

// Realistic data pools
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

const SENTIMENTS = ['positive', 'negative', 'neutral', 'mixed'];

const SIGNIFICANCE_LEVELS = ['high', 'medium', 'low'];

const PRIORITIES = ['high', 'medium', 'low'];

const STAKEHOLDERS = [
  'Students', 'Faculty', 'Administration', 'Student Services',
  'Academic Advisors', 'Financial Aid Office', 'Career Center',
  'Counseling Services', 'Residence Life', 'IT Department'
];

// Generate UUID
export function generateUUID() {
  return crypto.randomUUID();
}

// Generate realistic ID
export function generateId(prefix) {
  return `${prefix}_${Math.random().toString(36).substr(2, 9)}`;
}

// Random selection helper
export function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// Random subset helper
export function randomSubset(array, minSize = 1, maxSize = null) {
  const max = maxSize || array.length;
  const size = minSize + Math.floor(Math.random() * (max - minSize + 1));
  const shuffled = [...array].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, size);
}

// Generate random date within last year
export function generateRecentDate() {
  const now = new Date();
  const pastDate = new Date(now.getTime() - Math.random() * 365 * 24 * 60 * 60 * 1000);
  return pastDate.toISOString().split('T')[0];
}

// Generate age based on year
export function generateAge(year) {
  const baseAge = {
    'Freshman': 18,
    'Sophomore': 19,
    'Junior': 20,
    'Senior': 21
  };
  return (baseAge[year] || 20) + Math.floor(Math.random() * 3);
}

// Export constants
export {
  MAJORS, YEARS, GENDERS, INTERVIEW_FORMATS, INTERVIEWER_NAMES,
  THEME_CATEGORIES, QUOTE_TAGS, SENTIMENTS, SIGNIFICANCE_LEVELS,
  PRIORITIES, STAKEHOLDERS
};

// Load existing interview data
async function loadExistingData() {
  const files = await fs.readdir(DATA_DIR);
  const jsonFiles = files.filter(f => f.match(/^\d+\.json$/));
  
  const allData = {
    summaries: [],
    themes: [],
    quotes: [],
    timelinePoints: [],
    areasForImprovement: []
  };
  
  for (const file of jsonFiles) {
    const content = await fs.readFile(path.join(DATA_DIR, file), 'utf-8');
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
  }
  
  return allData;
}

// Generate mock interview
function generateMockInterview(existingData, index) {
  const interviewId = generateUUID();
  const year = randomChoice(YEARS);
  const isFirstGen = Math.random() > 0.7;
  const major = randomChoice(MAJORS);
  const gender = randomChoice(GENDERS);
  
  // Generate name based on gender
  const firstNames = {
    'Male': ['James', 'Michael', 'David', 'Robert', 'William', 'John', 'Christopher', 'Daniel'],
    'Female': ['Sarah', 'Emily', 'Jessica', 'Ashley', 'Michelle', 'Jennifer', 'Amanda', 'Lisa'],
    'Non-binary': ['Alex', 'Jordan', 'Taylor', 'Casey', 'Morgan', 'Jamie', 'Avery', 'Riley'],
    'Prefer not to say': ['A.', 'B.', 'C.', 'D.', 'E.', 'F.', 'G.', 'H.']
  };
  
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];
  const firstName = randomChoice(firstNames[gender] || firstNames['Non-binary']);
  const lastName = randomChoice(lastNames);
  const intervieweeName = `${firstName} ${lastName}`;
  
  // Select random summaries
  const summaryCount = 2 + Math.floor(Math.random() * 3);
  const selectedSummaries = randomSubset(existingData.summaries, summaryCount, summaryCount)
    .map((s, idx) => ({
      ...s,
      category: randomChoice(THEME_CATEGORIES),
      title: `${s.title || 'Summary'} - ${index + 1}.${idx + 1}`,
      embedding: [] // Empty embedding
    }));
  
  // Select random themes
  const themeCount = 3 + Math.floor(Math.random() * 4);
  const selectedThemes = randomSubset(existingData.themes, themeCount, themeCount)
    .map(() => {
      const theme = randomChoice(existingData.themes);
      return {
        ...theme,
        themeId: generateId('theme'),
        category: randomChoice(THEME_CATEGORIES),
        frequency: Math.floor(Math.random() * 10) + 1,
        impactScore: Math.floor(Math.random() * 10) + 1,
        actionable: Math.random() > 0.5,
        relatedQuoteIds: [],
        embedding: []
      };
    });
  
  // Select random quotes
  const quoteCount = 4 + Math.floor(Math.random() * 6);
  const selectedQuotes = randomSubset(existingData.quotes, quoteCount, quoteCount)
    .map((q, idx) => {
      const quoteId = generateId('quote');
      const relatedTheme = randomChoice(selectedThemes);
      
      return {
        ...q,
        quoteId,
        tags: randomSubset(QUOTE_TAGS, 1, 4),
        sentiment: randomChoice(SENTIMENTS),
        significanceLevel: randomChoice(SIGNIFICANCE_LEVELS),
        timestamp: `${Math.floor(Math.random() * 45) + 1}:${Math.floor(Math.random() * 60).toString().padStart(2, '0')}`,
        relatedThemeIds: [relatedTheme.themeId],
        embedding: []
      };
    });
  
  // Update theme related quotes
  selectedThemes.forEach(theme => {
    const relatedQuotes = randomSubset(selectedQuotes, 1, 3);
    theme.relatedQuoteIds = relatedQuotes.map(q => q.quoteId);
  });
  
  // Select timeline points
  const timelineCount = 3 + Math.floor(Math.random() * 4);
  const selectedTimeline = randomSubset(existingData.timelinePoints, timelineCount, timelineCount)
    .map(point => ({
      ...point,
      timeframeType: randomChoice(['past', 'present', 'future', 'ongoing']),
      category: randomChoice(THEME_CATEGORIES),
      sentiment: randomChoice(SENTIMENTS),
      embedding: []
    }));
  
  // Select areas for improvement
  const improvementCount = 2 + Math.floor(Math.random() * 3);
  const selectedImprovements = randomSubset(existingData.areasForImprovement, improvementCount, improvementCount)
    .map(area => ({
      ...area,
      areaId: generateId('area'),
      priority: randomChoice(PRIORITIES),
      stakeholders: randomSubset(STAKEHOLDERS, 1, 3),
      actionItems: area.actionItems || [
        'Implement new support systems',
        'Increase resource allocation',
        'Enhance communication channels',
        'Develop training programs'
      ].slice(0, Math.floor(Math.random() * 3) + 1),
      embedding: []
    }));
  
  // Generate mock transcript
  const wordCount = 2000 + Math.floor(Math.random() * 3000);
  
  return {
    interviewId,
    intervieweeName,
    interviewDate: generateRecentDate(),
    interviewFormat: randomChoice(INTERVIEW_FORMATS),
    interviewerName: randomChoice(INTERVIEWER_NAMES),
    demographics: {
      age: generateAge(year).toString(),
      gender,
      major,
      year,
      other: isFirstGen ? 'First-generation college student' : ''
    },
    transcript: {
      fileName: `transcript_${interviewId}.txt`,
      fileType: 'text/plain',
      rawText: '[Transcript content would be here]',
      wordCount,
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
      source: 'mock-generator',
      validatedBy: 'auto-generated'
    }
  };
}

// Main function
async function generateMockData() {
  console.log('Loading existing interview data...');
  const existingData = await loadExistingData();
  
  console.log(`Loaded:
  - ${existingData.summaries.length} summaries
  - ${existingData.themes.length} themes
  - ${existingData.quotes.length} quotes
  - ${existingData.timelinePoints.length} timeline points
  - ${existingData.areasForImprovement.length} areas for improvement`);
  
  const mockCount = parseInt(process.argv[2]) || 10;
  console.log(`\nGenerating ${mockCount} mock interviews...`);
  
  const startIndex = 8; // Start after existing 01-07
  
  for (let i = 0; i < mockCount; i++) {
    const mockInterview = generateMockInterview(existingData, startIndex + i);
    const fileName = `${(startIndex + i).toString().padStart(2, '0')}.json`;
    const filePath = path.join(DATA_DIR, fileName);
    
    await fs.writeFile(filePath, JSON.stringify(mockInterview, null, 2));
    console.log(`Created: ${fileName} - ${mockInterview.intervieweeName} (${mockInterview.demographics.major}, ${mockInterview.demographics.year})`);
  }
  
  console.log('\nMock data generation complete!');
  console.log(`Run 'npm run process-data' to generate embeddings for the new files.`);
}

// Run the generator
generateMockData().catch(console.error);