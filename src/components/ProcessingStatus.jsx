import React from 'react';

const ProcessingStatus = ({ metadata }) => {
  return (
    <div className="flex items-center space-x-4 text-sm">
      <div className="flex items-center space-x-2">
        <span className="text-gray-500">Interviews:</span>
        <span className="font-semibold">{metadata.totalInterviews}</span>
      </div>
      <div className="flex items-center space-x-2">
        <span className="text-gray-500">Clusters:</span>
        <span className="font-semibold">{metadata.clusters}</span>
      </div>
      <div className="flex items-center space-x-2">
        <span className="text-gray-500">Last processed:</span>
        <span className="font-semibold">
          {new Date(metadata.processedAt).toLocaleDateString()}
        </span>
      </div>
      {metadata.failedFiles > 0 && (
        <div className="flex items-center space-x-2 text-red-600">
          <span>⚠️</span>
          <span>{metadata.failedFiles} failed</span>
        </div>
      )}
    </div>
  );
};

export default ProcessingStatus;