import React, { useState } from 'react';

const InterviewDetail = ({ interview }) => {
  const [activeTab, setActiveTab] = useState('summary');

  if (!interview) return null;

  const tabs = [
    { id: 'summary', label: 'Summary' },
    { id: 'themes', label: 'Themes' },
    { id: 'quotes', label: 'Quotes' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'improvements', label: 'Improvements' },
    { id: 'raw', label: 'Raw JSON' }
  ];

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="border-b border-gray-200 mb-6">
        <h2 className="text-2xl font-bold mb-4">
          {interview.intervieweeName || interview.interviewId}
        </h2>
        
        <div className="flex space-x-4 text-sm text-gray-600 mb-4">
          <span>📅 {interview.interviewDate}</span>
          <span>🎓 {interview.demographics?.major}</span>
          <span>📚 {interview.demographics?.year}</span>
          <span>👤 {interview.demographics?.gender}, {interview.demographics?.age}</span>
        </div>
        
        <div className="flex space-x-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-t-md ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      
      <div className="mt-4">
        {activeTab === 'summary' && (
          <div className="space-y-4">
            {interview.analysis?.summaries?.map((summary, idx) => (
              <div key={idx} className="border-l-4 border-blue-500 pl-4">
                <h3 className="font-semibold text-lg">{summary.title}</h3>
                <span className="text-sm text-gray-500">{summary.category}</span>
                <p className="mt-2 text-gray-700">{summary.summaryText}</p>
              </div>
            ))}
          </div>
        )}
        
        {activeTab === 'themes' && (
          <div className="space-y-4">
            {interview.analysis?.themes?.map((theme, idx) => (
              <div key={idx} className="border rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-lg">{theme.title}</h3>
                    <span className="text-sm bg-gray-200 text-gray-700 px-2 py-1 rounded">
                      {theme.category}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-500">Impact</div>
                    <div className="font-bold text-lg">{theme.impactScore}/10</div>
                  </div>
                </div>
                <p className="mt-2 text-gray-700">{theme.description}</p>
                {theme.actionable && (
                  <span className="mt-2 inline-block text-sm bg-green-100 text-green-800 px-2 py-1 rounded">
                    Actionable
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        
        {activeTab === 'quotes' && (
          <div className="space-y-4">
            {interview.analysis?.quotes?.map((quote, idx) => (
              <blockquote key={idx} className="border-l-4 border-gray-300 pl-4 italic">
                <p className="text-gray-700">"{quote.quoteText}"</p>
                <div className="mt-2 text-sm text-gray-500">
                  <span className="mr-3">Context: {quote.context}</span>
                  <span className="mr-3">Sentiment: {quote.sentiment}</span>
                  <span>Significance: {quote.significanceLevel}</span>
                </div>
                {quote.tags?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {quote.tags.map((tag, tagIdx) => (
                      <span key={tagIdx} className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </blockquote>
            ))}
          </div>
        )}
        
        {activeTab === 'timeline' && (
          <div className="space-y-4">
            {interview.analysis?.timelinePoints?.map((point, idx) => (
              <div key={idx} className="flex items-start space-x-4">
                <div className="flex-shrink-0 w-2 h-2 mt-2 bg-blue-600 rounded-full"></div>
                <div className="flex-grow">
                  <p className="font-medium">{point.eventDescription}</p>
                  <div className="text-sm text-gray-500 mt-1">
                    <span className="mr-3">{point.timeframeType}</span>
                    <span className="mr-3">{point.category}</span>
                    <span>Sentiment: {point.sentiment}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {activeTab === 'improvements' && (
          <div className="space-y-4">
            {interview.analysis?.areasForImprovement?.map((area, idx) => (
              <div key={idx} className="border rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <h3 className="font-semibold text-lg">{area.title}</h3>
                  <span className={`px-2 py-1 rounded text-sm ${
                    area.priority === 'high' ? 'bg-red-100 text-red-800' :
                    area.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-green-100 text-green-800'
                  }`}>
                    {area.priority} priority
                  </span>
                </div>
                <p className="mt-2 text-gray-700">{area.description}</p>
                {area.actionItems?.length > 0 && (
                  <div className="mt-3">
                    <h4 className="font-medium text-sm">Action Items:</h4>
                    <ul className="list-disc list-inside text-sm text-gray-600 mt-1">
                      {area.actionItems.map((item, itemIdx) => (
                        <li key={itemIdx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {area.stakeholders?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {area.stakeholders.map((stakeholder, sIdx) => (
                      <span key={sIdx} className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded">
                        {stakeholder}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        
        {activeTab === 'raw' && (
          <pre className="bg-gray-100 p-4 rounded-lg overflow-auto max-h-96 text-xs">
            {JSON.stringify(interview, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
};

export default InterviewDetail;