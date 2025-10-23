import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from '@xenova/transformers';
import Ajv from 'ajv';
import lunr from 'lunr';
import { interviewSchema } from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../examples');
const OUTPUT_DIR = path.join(__dirname, '../public/data');

// Initialize schema validator
const ajv = new Ajv();
const validate = ajv.compile(interviewSchema);

// Embedding model initialization
let embedder = null;

async function getEmbedder() {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedder;
}

// Generate embeddings for text
async function generateEmbedding(text) {
  if (!text || text.trim() === '') return [];
  
  const model = await getEmbedder();
  const output = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

// Process individual interview file
async function processInterview(filePath) {
  console.log(`Processing: ${path.basename(filePath)}`);
  
  const content = await fs.readFile(filePath, 'utf-8');
  const data = JSON.parse(content);
  
  // Validate schema
  const valid = validate(data);
  if (!valid) {
    console.error(`Schema validation failed for ${filePath}:`, validate.errors);
    return { success: false, errors: validate.errors, file: filePath };
  }
  
  // Generate embeddings for all text fields
  try {
    // Process summaries
    if (data.analysis?.summaries) {
      for (const summary of data.analysis.summaries) {
        if (!summary.embedding || summary.embedding.length === 0) {
          summary.embedding = await generateEmbedding(summary.summaryText);
        }
      }
    }
    
    // Process themes
    if (data.analysis?.themes) {
      for (const theme of data.analysis.themes) {
        if (!theme.embedding || theme.embedding.length === 0) {
          const text = `${theme.title} ${theme.description}`;
          theme.embedding = await generateEmbedding(text);
        }
      }
    }
    
    // Process quotes
    if (data.analysis?.quotes) {
      for (const quote of data.analysis.quotes) {
        if (!quote.embedding || quote.embedding.length === 0) {
          quote.embedding = await generateEmbedding(quote.quoteText);
        }
      }
    }
    
    // Process timeline points
    if (data.analysis?.timelinePoints) {
      for (const point of data.analysis.timelinePoints) {
        if (!point.embedding || point.embedding.length === 0) {
          point.embedding = await generateEmbedding(point.eventDescription);
        }
      }
    }
    
    // Process areas for improvement
    if (data.analysis?.areasForImprovement) {
      for (const area of data.analysis.areasForImprovement) {
        if (!area.embedding || area.embedding.length === 0) {
          const text = `${area.title} ${area.description}`;
          area.embedding = await generateEmbedding(text);
        }
      }
    }
    
    // Generate category-specific embeddings
    data.categoryEmbeddings = {
      summary: await generateEmbedding(
        data.analysis?.summaries?.map(s => s.summaryText).join(' ') || ''
      ),
      themes: await generateEmbedding(
        data.analysis?.themes?.map(t => `${t.title} ${t.description}`).join(' ') || ''
      ),
      collegeExperience: await generateEmbedding(
        data.analysis?.summaries
          ?.filter(s => s.category?.toLowerCase().includes('college') || 
                       s.category?.toLowerCase().includes('academic'))
          ?.map(s => s.summaryText).join(' ') || ''
      ),
      quotes: await generateEmbedding(
        data.analysis?.quotes?.map(q => q.quoteText).join(' ') || ''
      )
    };
    
    // Generate tag-based embeddings for clustering
    const quoteTags = [...new Set(data.analysis?.quotes?.flatMap(q => q.tags || []) || [])];
    data.tagEmbeddings = {};
    for (const tag of quoteTags) {
      const tagQuotes = data.analysis?.quotes
        ?.filter(q => q.tags?.includes(tag))
        ?.map(q => q.quoteText)
        .join(' ') || '';
      if (tagQuotes) {
        data.tagEmbeddings[tag] = await generateEmbedding(tagQuotes);
      }
    }
    
    return { success: true, data, file: filePath };
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
    return { success: false, error: error.message, file: filePath };
  }
}

// [Rest of the clustering and search functions remain the same...]

// Main processing function
async function main() {
  console.log('Starting data processing...');
  
  // Ensure output directory exists
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  
  // Get all JSON files, excluding the test marker file
  const files = await fs.readdir(DATA_DIR);
  const jsonFiles = files
    .filter(f => f.endsWith('.json') && f !== 'base.json' && f !== '.test-files.json')
    .map(f => path.join(DATA_DIR, f));
  
  console.log(`Found ${jsonFiles.length} interview files`);
  
  // Process each file
  const results = await Promise.all(jsonFiles.map(processInterview));
  
  // Separate successful and failed processes
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`Successfully processed: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);
  
  if (failed.length > 0) {
    console.error('Failed files:', failed.map(f => path.basename(f.file)));
  }
  
  // Extract processed data
  const interviews = successful.map(r => r.data);
  
  // Build vector indices
  console.log('Building vector indices...');
  const vectorIndices = buildVectorIndices(interviews);
  
  // Perform clustering for each type
  console.log('Performing clustering...');
  const clusteringResults = {
    summary: performClustering(vectorIndices.summary),
    themes: performClustering(vectorIndices.themes),
    collegeExperience: performClustering(vectorIndices.collegeExperience),
    quotes: performClustering(vectorIndices.quotes),
    tags: {}
  };
  
  // Cluster by tags
  Object.keys(vectorIndices.tags).forEach(tag => {
    if (vectorIndices.tags[tag].length >= 2) {
      clusteringResults.tags[tag] = performClustering(
        vectorIndices.tags[tag], 
        Math.min(2, Math.ceil(vectorIndices.tags[tag].length / 2))
      );
    }
  });
  
  // Build search index
  console.log('Building search index...');
  const searchData = buildSearchIndex(interviews);
  
  // Save processed data
  await fs.writeFile(
    path.join(OUTPUT_DIR, 'interviews.json'),
    JSON.stringify(interviews, null, 2)
  );
  
  await fs.writeFile(
    path.join(OUTPUT_DIR, 'vector-indices.json'),
    JSON.stringify(vectorIndices, null, 2)
  );
  
  await fs.writeFile(
    path.join(OUTPUT_DIR, 'clusters.json'),
    JSON.stringify(clusteringResults, null, 2)
  );
  
  await fs.writeFile(
    path.join(OUTPUT_DIR, 'search-index.json'),
    JSON.stringify({
      index: searchData.index.toJSON(),
      documents: searchData.documents,
      embeddings: searchData.embeddings
    }, null, 2)
  );
  
  // Save metadata including deployment timestamp
  await fs.writeFile(
    path.join(OUTPUT_DIR, 'metadata.json'),
    JSON.stringify({
      processedAt: new Date().toISOString(),
      deploymentId: process.env.GITHUB_RUN_ID || `local_${Date.now()}`,
      totalInterviews: interviews.length,
      failedFiles: failed.length,
      clusterTypes: Object.keys(clusteringResults),
      searchDocuments: searchData.documents.length,
      embeddingDimension: 384,
      tags: Object.keys(vectorIndices.tags)
    }, null, 2)
  );
  
  console.log('Data processing complete!');
}

main().catch(console.error);