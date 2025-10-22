import React, { useState, useEffect, useRef } from 'react';
import lunr from 'lunr';

const SearchPanel = ({ interviews, onSearchResults, onSelectInterview, selectedTags }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchType, setSearchType] = useState('text');
  const [searchIndex, setSearchIndex] = useState(null);
  const [embeddings, setEmbeddings] = useState([]);
  const [results, setResults] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const embeddingCache = useRef(new Map());

  useEffect(() => {
    // Load search index and embeddings
    Promise.all([
      fetch('/data/search-index.json').then(r => r.json()),
      import('@xenova/transformers')
    ]).then(([data, transformers]) => {
      const idx = lunr.Index.load(data.index);
      setSearchIndex({ 
        index: idx, 
        documents: data.documents,
        embeddings: data.embeddings
      });
      setEmbeddings(data.embeddings || []);
      
      initializeEmbedder(transformers);
    });
  }, []);

  // Re-filter results when tags change
  useEffect(() => {
    if (results.length > 0 && searchTerm) {
      applyFilters();
    }
  }, [selectedTags]);

  const initializeEmbedder = async (transformers) => {
    if (!window.embeddingPipeline) {
      window.embeddingPipeline = await transformers.pipeline(
        'feature-extraction', 
        'Xenova/all-MiniLM-L6-v2'
      );
    }
  };

  const generateQueryEmbedding = async (query) => {
    if (embeddingCache.current.has(query)) {
      return embeddingCache.current.get(query);
    }

    if (window.embeddingPipeline) {
      const output = await window.embeddingPipeline(query, { 
        pooling: 'mean', 
        normalize: true 
      });
      const embedding = Array.from(output.data);
      embeddingCache.current.set(query, embedding);
      return embedding;
    }
    return null;
  };

  const cosineSimilarity = (a, b) => {
    if (!a || !b || a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  };

  const filterResultsByTags = (results) => {
    if (!selectedTags || selectedTags.size === 0) return results;

    return results.filter(result => {
      // Get the interview for this result
      const interview = interviews.find(i => 
        i.interviewId === result.interviewId || 
        i.interviewId === result.id?.split('_')[1]
      );
      
      if (!interview) return false;
      
      // Check if interview has any of the selected tags
      const quoteTags = interview.analysis?.quotes?.flatMap(q => q.tags || []) || [];
      const hasSelectedTags = [...selectedTags].some(tag => quoteTags.includes(tag));
      
      return hasSelectedTags;
    });
  };

  const applyFilters = () => {
    const filtered = filterResultsByTags(results);
    setResults(filtered);
    onSearchResults(filtered);
  };

  const performSemanticSearch = async (query) => {
    setIsProcessing(true);
    
    try {
      const queryEmbedding = await generateQueryEmbedding(query);
      if (!queryEmbedding) {
        setIsProcessing(false);
        return;
      }

      const similarities = embeddings.map(item => ({
        ...item,
        similarity: cosineSimilarity(queryEmbedding, item.embedding)
      }));

      const topResults = similarities
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 50) // Get more results initially
        .filter(item => item.similarity > 0.3);

      const semanticResults = topResults.map(item => {
        const doc = searchIndex.documents.find(d => d.id === item.id);
        return {
          ...doc,
          score: item.similarity,
          metadata: item.metadata
        };
      });

      // Apply tag filtering
      const filtered = filterResultsByTags(semanticResults);
      setResults(filtered);
      onSearchResults(filtered);
    } catch (error) {
      console.error('Semantic search error:', error);
      setResults([]);
    }
    
    setIsProcessing(false);
  };

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      setResults([]);
      return;
    }

    if (searchType === 'text' && searchIndex) {
      try {
        const searchResults = searchIndex.index.search(searchTerm);
        const resultDocs = searchResults.map(result => {
          const doc = searchIndex.documents.find(d => d.id === result.ref);
          return { ...doc, score: result.score };
        });
        
        // Apply tag filtering
        const filtered = filterResultsByTags(resultDocs);
        setResults(filtered);
        onSearchResults(filtered);
      } catch (error) {
        console.error('Search error:', error);
        setResults([]);
      }
    } else if (searchType === 'semantic') {
      await performSemanticSearch(searchTerm);
    }
  };

  const getInterviewFromResult = (result) => {
    if (result.type === 'interview') {
      return interviews.find(i => i.interviewId === result.interviewId);
    } else if (result.interviewId) {
      return interviews.find(i => i.interviewId === result.interviewId);
    }
    return null;
  };

  const getResultIcon = (type) => {
    const icons = {
      interview: '👤',
      theme: '💡',
      quote: '💬',
      timeline: '📅'
    };
    return icons[type] || '📄';
  };

  const getResultColor = (type) => {
    const colors = {
      interview: 'bg-blue-100 text-blue-800',
      theme: 'bg-purple-100 text-purple-800',
      quote: 'bg-green-100 text-green-800',
      timeline: 'bg-orange-100 text-orange-800'
    };
    return colors[type] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4">Search Interviews</h2>
      
      <div className="space-y-4">
        {selectedTags.size > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
            <p className="text-sm text-amber-800">
              🏷️ Results will be filtered by selected tags
            </p>
          </div>
        )}
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Search Type
          </label>
          <select
            value={searchType}
            onChange={(e) => setSearchType(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="text">Full-Text Search</option>
            <option value="semantic">Semantic Search (AI)</option>
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Search Query
          </label>
          <div className="relative">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !isProcessing && handleSearch()}
              placeholder={
                searchType === 'semantic' 
                  ? "Describe what you're looking for..." 
                  : "Enter search terms..."
              }
              className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchType === 'semantic' && (
              <span className="absolute right-3 top-2.5 text-gray-400">
                🤖
              </span>
            )}
          </div>
          {searchType === 'semantic' && (
            <p className="mt-1 text-xs text-gray-500">
              AI-powered search finds conceptually similar content
            </p>
          )}
        </div>
        
        <button
          onClick={handleSearch}
          disabled={isProcessing}
          className={`w-full py-2 px-4 rounded-md transition-colors ${
            isProcessing 
              ? 'bg-gray-400 cursor-not-allowed' 
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {isProcessing ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Processing...
            </span>
          ) : (
            'Search'
          )}
        </button>
        
        {results.length > 0 && (
          <div className="mt-6">
            <h3 className="text-lg font-medium mb-3 flex items-center justify-between">
              <span>Results ({results.length})</span>
              <div className="flex items-center text-xs text-gray-500">
                {selectedTags.size > 0 && (
                  <span className="mr-2">Filtered by tags</span>
                )}
                {searchType === 'semantic' && (
                  <span>Ranked by relevance</span>
                )}
              </div>
            </h3>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {results.map((result, idx) => {
                const interview = getInterviewFromResult(result);
                const interviewTags = interview?.analysis?.quotes?.flatMap(q => q.tags || []) || [];
                const uniqueTags = [...new Set(interviewTags)];
                
                return (
                  <div
                    key={idx}
                    className="p-3 border rounded-md cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => {
                      if (interview) onSelectInterview(interview);
                    }}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-grow">
                        <div className="flex items-center space-x-2 mb-1">
                          <span className="text-lg">{getResultIcon(result.type)}</span>
                          <span className={`text-xs px-2 py-1 rounded ${getResultColor(result.type)}`}>
                            {result.type}
                          </span>
                        </div>
                        <h4 className="font-medium">
                          {result.title || result.id}
                        </h4>
                        <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                          {result.content}
                        </p>
                        {uniqueTags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {uniqueTags.slice(0, 5).map((tag, tagIdx) => (
                              <span 
                                key={tagIdx} 
                                className={`text-xs px-2 py-0.5 rounded ${
                                  selectedTags.has(tag)
                                    ? 'bg-amber-200 text-amber-800 font-medium'
                                    : 'bg-gray-200 text-gray-700'
                                }`}
                              >
                                #{tag}
                              </span>
                            ))}
                            {uniqueTags.length > 5 && (
                              <span className="text-xs text-gray-500">
                                +{uniqueTags.length - 5} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="ml-3 text-right">
                        <span className="text-sm font-medium text-gray-700">
                          {searchType === 'semantic' 
                            ? `${(result.score * 100).toFixed(0)}%`
                            : `${(result.score * 100).toFixed(0)}%`
                          }
                        </span>
                        {searchType === 'semantic' && (
                          <div className="text-xs text-gray-500">match</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchPanel;