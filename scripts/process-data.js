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

// Build vector indices for different clustering types
function buildVectorIndices(interviews) {
  const indices = {
    summary: [],
    themes: [],
    collegeExperience: [],
    quotes: [],
    tags: {}
  };
  
  // Collect all unique tags
  const allTags = new Set();
  interviews.forEach(interview => {
    interview.analysis?.quotes?.forEach(quote => {
      quote.tags?.forEach(tag => allTags.add(tag));
    });
  });
  
  // Build indices
  interviews.forEach((interview, idx) => {
    // Summary index
    if (interview.categoryEmbeddings?.summary?.length > 0) {
      indices.summary.push({
        id: interview.interviewId,
        index: idx,
        embedding: interview.categoryEmbeddings.summary
      });
    }
    
    // Themes index
    if (interview.categoryEmbeddings?.themes?.length > 0) {
      indices.themes.push({
        id: interview.interviewId,
        index: idx,
        embedding: interview.categoryEmbeddings.themes
      });
    }
    
    // College experience index
    if (interview.categoryEmbeddings?.collegeExperience?.length > 0) {
      indices.collegeExperience.push({
        id: interview.interviewId,
        index: idx,
        embedding: interview.categoryEmbeddings.collegeExperience
      });
    }
    
    // Quotes index
    if (interview.categoryEmbeddings?.quotes?.length > 0) {
      indices.quotes.push({
        id: interview.interviewId,
        index: idx,
        embedding: interview.categoryEmbeddings.quotes
      });
    }
    
    // Tag-based indices
    allTags.forEach(tag => {
      if (interview.tagEmbeddings?.[tag]) {
        if (!indices.tags[tag]) {
          indices.tags[tag] = [];
        }
        indices.tags[tag].push({
          id: interview.interviewId,
          index: idx,
          embedding: interview.tagEmbeddings[tag]
        });
      }
    });
  });
  
  return indices;
}

// Build search indices with embeddings
function buildSearchIndex(interviews) {
  const documents = [];
  const embeddings = [];
  
  interviews.forEach(interview => {
    // Add main interview document
    const docId = `interview_${interview.interviewId}`;
    documents.push({
      id: docId,
      type: 'interview',
      title: interview.intervieweeName || interview.interviewId,
      content: interview.analysis?.summaries?.map(s => s.summaryText).join(' ') || '',
      demographics: JSON.stringify(interview.demographics || {}),
      date: interview.interviewDate,
      interviewId: interview.interviewId
    });
    
    // Add embedding for vector search
    if (interview.categoryEmbeddings?.summary) {
      embeddings.push({
        id: docId,
        embedding: interview.categoryEmbeddings.summary,
        metadata: { type: 'interview', interviewId: interview.interviewId }
      });
    }
    
    // Add themes as documents
    interview.analysis?.themes?.forEach(theme => {
      const themeDocId = `theme_${interview.interviewId}_${theme.themeId}`;
      documents.push({
        id: themeDocId,
        type: 'theme',
        interviewId: interview.interviewId,
        title: theme.title,
        content: theme.description,
        category: theme.category
      });
      
      if (theme.embedding) {
        embeddings.push({
          id: themeDocId,
          embedding: theme.embedding,
          metadata: { type: 'theme', interviewId: interview.interviewId, themeId: theme.themeId }
        });
      }
    });
    
    // Add quotes as documents
    interview.analysis?.quotes?.forEach(quote => {
      const quoteDocId = `quote_${interview.interviewId}_${quote.quoteId}`;
      documents.push({
        id: quoteDocId,
        type: 'quote',
        interviewId: interview.interviewId,
        content: quote.quoteText,
        context: quote.context,
        sentiment: quote.sentiment,
        tags: (quote.tags || []).join(' ')
      });
      
      if (quote.embedding) {
        embeddings.push({
          id: quoteDocId,
          embedding: quote.embedding,
          metadata: { 
            type: 'quote', 
            interviewId: interview.interviewId, 
            quoteId: quote.quoteId,
            tags: quote.tags || []
          }
        });
      }
    });
  });
  
  // Build Lunr index
  const idx = lunr(function() {
    this.ref('id');
    this.field('title');
    this.field('content');
    this.field('demographics');
    this.field('category');
    this.field('sentiment');
    this.field('tags');
    
    documents.forEach(doc => {
      this.add(doc);
    });
  });
  
  return {
    index: idx,
    documents: documents,
    embeddings: embeddings
  };
}

// Perform clustering using k-means++
function performClustering(vectorIndex, k = 3) {
  if (!vectorIndex || vectorIndex.length === 0) return [];
  
  const vectors = vectorIndex.map(item => item.embedding);
  const actualK = Math.min(k, vectors.length);
  
  // K-means++ initialization
  const centers = [];
  const usedIndices = new Set();
  
  // Choose first center randomly
  const firstIdx = Math.floor(Math.random() * vectors.length);
  centers.push([...vectors[firstIdx]]);
  usedIndices.add(firstIdx);
  
  // Choose remaining centers
  for (let i = 1; i < actualK; i++) {
    const distances = vectors.map((v, idx) => {
      if (usedIndices.has(idx)) return 0;
      
      let minDist = Infinity;
      centers.forEach(center => {
        const dist = euclideanDistance(v, center);
        minDist = Math.min(minDist, dist);
      });
      return minDist;
    });
    
    // Choose next center with probability proportional to distance squared
    const sumDist = distances.reduce((a, b) => a + b * b, 0);
    let random = Math.random() * sumDist;
    let chosenIdx = 0;
    
    for (let j = 0; j < distances.length; j++) {
      random -= distances[j] * distances[j];
      if (random <= 0 && !usedIndices.has(j)) {
        chosenIdx = j;
        break;
      }
    }
    
    centers.push([...vectors[chosenIdx]]);
    usedIndices.add(chosenIdx);
  }
  
  // Assign points to clusters
  const clusters = Array(actualK).fill(null).map((_, i) => ({
    id: `cluster_${i}`,
    center: centers[i],
    members: []
  }));
  
  // Run k-means iterations
  for (let iter = 0; iter < 20; iter++) {
    // Clear members
    clusters.forEach(c => c.members = []);
    
    // Assign to nearest cluster
    vectorIndex.forEach((item, idx) => {
      let minDist = Infinity;
      let nearestCluster = 0;
      
      clusters.forEach((cluster, cIdx) => {
        const dist = euclideanDistance(item.embedding, cluster.center);
        if (dist < minDist) {
          minDist = dist;
          nearestCluster = cIdx;
        }
      });
      
      clusters[nearestCluster].members.push(item.index);
    });
    
    // Update centers
    let changed = false;
    clusters.forEach(cluster => {
      if (cluster.members.length === 0) return;
      
      const newCenter = Array(cluster.center.length).fill(0);
      cluster.members.forEach(memberIdx => {
        const member = vectorIndex.find(v => v.index === memberIdx);
        if (member) {
          member.embedding.forEach((val, i) => {
            newCenter[i] += val;
          });
        }
      });
      
      newCenter.forEach((val, i) => {
        newCenter[i] /= cluster.members.length;
        if (Math.abs(newCenter[i] - cluster.center[i]) > 0.001) {
          changed = true;
        }
      });
      
      cluster.center = newCenter;
    });
    
    if (!changed) break;
  }
  
  // Calculate cluster statistics
  clusters.forEach(cluster => {
    cluster.size = cluster.members.length;
    cluster.cohesion = calculateClusterCohesion(cluster, vectorIndex);
  });
  
  return clusters;
}

function euclideanDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

function calculateClusterCohesion(cluster, vectorIndex) {
  if (cluster.members.length <= 1) return 1;
  
  let totalDist = 0;
  let count = 0;
  
  cluster.members.forEach(memberIdx => {
    const member = vectorIndex.find(v => v.index === memberIdx);
    if (member) {
      totalDist += euclideanDistance(member.embedding, cluster.center);
      count++;
    }
  });
  
  return count > 0 ? 1 / (1 + totalDist / count) : 0;
}

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