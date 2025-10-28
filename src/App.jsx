import React, { useState, useEffect } from 'react';
import ClusterVisualization from './components/ClusterVisualization';
import SearchPanel from './components/SearchPanel';
import InterviewDetail from './components/InterviewDetail';
import ProcessingStatus from './components/ProcessingStatus';
import TagPanel from './components/TagPanel.jsx';
import './App.css';

function App() {
  const [interviews, setInterviews] = useState([]);
  const [clusters, setClusters] = useState(null);
  const [selectedInterview, setSelectedInterview] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [metadata, setMetadata] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selectedTags, setSelectedTags] = useState(new Set());

  useEffect(() => {
    // Load all data with correct base path
    const baseUrl = import.meta.env.BASE_URL;
    Promise.all([
      fetch(`${baseUrl}data/interviews.json`).then(r => r.json()),
      fetch(`${baseUrl}data/clusters.json`).then(r => r.json()),
      fetch(`${baseUrl}data/metadata.json`).then(r => r.json())
    ]).then(([interviewData, clusterData, metaData]) => {
      setInterviews(interviewData);
      setClusters(clusterData);
      setMetadata(metaData);
      setLoading(false);
    }).catch(error => {
      console.error('Error loading data:', error);
      setLoadError(error.message);
      setLoading(false);
    });
  }, []);

  const handleTagToggle = (tag) => {
    const newTags = new Set(selectedTags);
    if (newTags.has(tag)) {
      newTags.delete(tag);
    } else {
      newTags.add(tag);
    }
    setSelectedTags(newTags);
  };

  const clearSelectedTags = () => {
    setSelectedTags(new Set());
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <div className="mt-4 text-xl text-gray-700">Loading interview data...</div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center bg-white p-8 rounded-lg shadow-md">
          <div className="text-red-600 text-xl mb-4">Error Loading Data</div>
          <div className="text-gray-700">{loadError}</div>
          <button 
            onClick={() => window.location.reload()} 
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                College Student Interview Explorer
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                AI-powered analysis and visualization of student experiences
              </p>
            </div>
            {metadata && (
              <ProcessingStatus metadata={metadata} />
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4">
                Interview Clusters
                <span className="ml-2 text-sm font-normal text-gray-600">
                  (Grouped by similarity)
                </span>
              </h2>
              <ClusterVisualization
                interviews={interviews}
                clusters={clusters}
                onSelectInterview={setSelectedInterview}
                selectedInterview={selectedInterview}
                selectedTags={selectedTags}
              />
            </div>
            
            {selectedInterview && (
              <div className="mt-8">
                <InterviewDetail interview={selectedInterview} />
              </div>
            )}
          </div>
          
          <div className="lg:col-span-1">
            <SearchPanel
              interviews={interviews}
              onSearchResults={setSearchResults}
              onSelectInterview={setSelectedInterview}
              selectedTags={selectedTags}
            />
            
            {metadata?.tags && metadata.tags.length > 0 && (
              <div className="mt-8">
                <TagPanel
                  tags={metadata.tags}
                  selectedTags={selectedTags}
                  onTagToggle={handleTagToggle}
                  onClearAll={clearSelectedTags}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;