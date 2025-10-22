import React from 'react';

const TagPanel = ({ tags, selectedTags, onTagToggle, onClearAll }) => {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-semibold">Filter by Tags</h3>
        {selectedTags.size > 0 && (
          <button
            onClick={onClearAll}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Clear all
          </button>
        )}
      </div>
      
      <div className="flex flex-wrap gap-2">
        {tags.map(tag => {
          const isSelected = selectedTags.has(tag);
          return (
            <button
              key={tag}
              onClick={() => onTagToggle(tag)}
              className={`
                text-sm px-3 py-1.5 rounded-full transition-all
                ${isSelected 
                  ? 'bg-blue-600 text-white shadow-md transform scale-105' 
                  : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                }
              `}
            >
              <span className="flex items-center">
                {isSelected && (
                  <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
                {tag}
              </span>
            </button>
          );
        })}
      </div>
      
      {selectedTags.size > 0 && (
        <div className="mt-3 text-sm text-gray-600">
          {selectedTags.size} tag{selectedTags.size > 1 ? 's' : ''} selected
        </div>
      )}
    </div>
  );
};

export default TagPanel;
