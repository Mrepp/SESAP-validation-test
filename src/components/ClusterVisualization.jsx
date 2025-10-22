import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';

const ClusterVisualization = ({ 
  interviews, 
  clusters, 
  onSelectInterview, 
  selectedInterview,
  selectedTags 
}) => {
  const svgRef = useRef(null);
  const [clusterType, setClusterType] = useState('summary');
  const [currentClusters, setCurrentClusters] = useState(clusters?.summary || []);
  const [availableTags, setAvailableTags] = useState([]);

  useEffect(() => {
    if (clusters?.tags) {
      setAvailableTags(Object.keys(clusters.tags));
    }
  }, [clusters]);

  useEffect(() => {
    if (clusterType.startsWith('tag:')) {
      const tag = clusterType.replace('tag:', '');
      setCurrentClusters(clusters?.tags?.[tag] || []);
    } else {
      setCurrentClusters(clusters?.[clusterType] || []);
    }
  }, [clusterType, clusters]);

  const interviewHasSelectedTags = (interview) => {
    if (!selectedTags || selectedTags.size === 0) return false;
    
    const quoteTags = interview.analysis?.quotes?.flatMap(q => q.tags || []) || [];
    return [...selectedTags].some(tag => quoteTags.includes(tag));
  };

  useEffect(() => {
    if (!interviews || interviews.length === 0 || !currentClusters) return;
    
    const width = 800;
    const height = 600;
    const margin = 60;
    const svg = d3.select(svgRef.current);
    
    svg.selectAll('*').remove();
    
    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g');
    
    // Calculate static positions for nodes based on cluster assignment
    const calculateNodePositions = () => {
      const positions = [];
      const clusterCenters = [];
      const numClusters = currentClusters.length;
      
      // Calculate cluster centers in a circle
      if (numClusters > 0) {
        const angleStep = (2 * Math.PI) / numClusters;
        const radius = Math.min(width, height) * 0.3;
        
        for (let i = 0; i < numClusters; i++) {
          const angle = i * angleStep - Math.PI / 2;
          clusterCenters.push({
            x: width / 2 + radius * Math.cos(angle),
            y: height / 2 + radius * Math.sin(angle)
          });
        }
      }
      
      // Position nodes around their cluster centers
      interviews.forEach((interview, idx) => {
        const clusterIdx = currentClusters.findIndex(c => c.members.includes(idx));
        
        if (clusterIdx >= 0 && clusterCenters[clusterIdx]) {
          // Position in a circle around cluster center
          const clusterMembers = currentClusters[clusterIdx].members;
          const memberIndex = clusterMembers.indexOf(idx);
          const numMembers = clusterMembers.length;
          const angle = (2 * Math.PI * memberIndex) / numMembers;
          const nodeRadius = Math.min(80, 200 / Math.sqrt(numMembers));
          
          positions.push({
            x: clusterCenters[clusterIdx].x + nodeRadius * Math.cos(angle),
            y: clusterCenters[clusterIdx].y + nodeRadius * Math.sin(angle),
            cluster: clusterIdx
          });
        } else {
          // Unclustered nodes go in the center
          const unclusteredCount = interviews.filter((_, i) => 
            !currentClusters.some(c => c.members.includes(i))
          ).length;
          const unclusteredIndex = interviews.slice(0, idx).filter((_, i) => 
            !currentClusters.some(c => c.members.includes(i))
          ).length;
          
          const angle = (2 * Math.PI * unclusteredIndex) / unclusteredCount;
          const radius = 50;
          
          positions.push({
            x: width / 2 + radius * Math.cos(angle),
            y: height / 2 + radius * Math.sin(angle),
            cluster: -1
          });
        }
      });
      
      return positions;
    };
    
    const positions = calculateNodePositions();
    
    const nodes = interviews.map((interview, idx) => ({
      id: interview.interviewId,
      data: interview,
      cluster: positions[idx].cluster,
      x: positions[idx].x,
      y: positions[idx].y,
      hasSelectedTags: interviewHasSelectedTags(interview)
    }));
    
    const color = d3.scaleOrdinal(d3.schemeCategory10);
    
    // Legend
    const legend = g.append('g')
      .attr('class', 'legend')
      .attr('transform', `translate(${width - 150}, 20)`);
    
    currentClusters.forEach((cluster, i) => {
      const legendItem = legend.append('g')
        .attr('transform', `translate(0, ${i * 25})`);
      
      legendItem.append('circle')
        .attr('r', 8)
        .attr('fill', color(i));
      
      legendItem.append('text')
        .attr('x', 15)
        .attr('y', 5)
        .style('font-size', '12px')
        .text(`Cluster ${i + 1} (${cluster.members.length})`);
    });
    
    // Create node groups
    const node = g.selectAll('.node')
      .data(nodes)
      .enter().append('g')
      .attr('class', 'node')
      .attr('transform', d => `translate(${d.x},${d.y})`);
    
    // Add circles
    node.append('circle')
      .attr('r', d => d.cluster === -1 ? 15 : 25)
      .attr('fill', d => d.cluster === -1 ? '#999' : color(d.cluster))
      .attr('stroke', d => {
        if (d.data.interviewId === selectedInterview?.interviewId) return '#000';
        if (d.hasSelectedTags && selectedTags.size > 0) return '#f59e0b';
        return '#fff';
      })
      .attr('stroke-width', d => {
        if (d.data.interviewId === selectedInterview?.interviewId) return 3;
        if (d.hasSelectedTags && selectedTags.size > 0) return 4;
        return 2;
      })
      .style('cursor', 'pointer')
      .on('click', function(event, d) {
        event.stopPropagation();
        onSelectInterview(d.data);
      })
      .on('mouseover', function(event, d) {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('r', d.cluster === -1 ? 20 : 30);
        showTooltip(event, d);
      })
      .on('mouseout', function(event, d) {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('r', d.cluster === -1 ? 15 : 25);
        hideTooltip();
      });
    
    // Add highlight effect for nodes with selected tags
    node.filter(d => d.hasSelectedTags && selectedTags.size > 0)
      .append('circle')
      .attr('r', d => d.cluster === -1 ? 22 : 32)
      .attr('fill', 'none')
      .attr('stroke', '#f59e0b')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4,2')
      .style('pointer-events', 'none')
      .append('animate')
      .attr('attributeName', 'stroke-dashoffset')
      .attr('values', '0;8')
      .attr('dur', '2s')
      .attr('repeatCount', 'indefinite');
    
    // Add labels
    node.append('text')
      .attr('dy', '.35em')
      .attr('text-anchor', 'middle')
      .attr('fill', 'white')
      .attr('font-size', '12px')
      .attr('font-weight', 'bold')
      .style('pointer-events', 'none')
      .text(d => d.data.interviewId.substring(0, 3));
    
    // Tooltip
    const tooltip = d3.select('body').append('div')
      .attr('class', 'tooltip')
      .style('opacity', 0)
      .style('position', 'absolute')
      .style('background', 'rgba(0, 0, 0, 0.9)')
      .style('color', 'white')
      .style('padding', '12px')
      .style('border-radius', '8px')
      .style('font-size', '14px')
      .style('box-shadow', '0 4px 6px rgba(0, 0, 0, 0.1)')
      .style('pointer-events', 'none')
      .style('z-index', '1000');
    
    function showTooltip(event, d) {
      const cluster = currentClusters[d.cluster];
      const quoteTags = d.data.analysis?.quotes?.flatMap(q => q.tags || []) || [];
      const uniqueTags = [...new Set(quoteTags)];
      
      tooltip.transition().duration(200).style('opacity', .9);
      tooltip.html(`
        <strong>${d.data.intervieweeName || d.data.interviewId}</strong><br/>
        <div style="margin-top: 8px; font-size: 12px;">
          ${d.data.demographics?.major || 'Unknown Major'}<br/>
          ${d.data.demographics?.year || 'Unknown Year'}<br/>
          ${d.cluster >= 0 ? `Cluster: ${d.cluster + 1}` : 'Unclustered'}<br/>
          ${cluster ? `Cohesion: ${(cluster.cohesion * 100).toFixed(1)}%` : ''}<br/>
          <div style="margin-top: 8px;">
            Themes: ${d.data.analysis?.themes?.length || 0}<br/>
            Quotes: ${d.data.analysis?.quotes?.length || 0}
          </div>
          ${uniqueTags.length > 0 ? `
            <div style="margin-top: 8px;">
              <strong>Tags:</strong><br/>
              ${uniqueTags.map(tag => `
                <span style="
                  display: inline-block;
                  background: ${selectedTags.has(tag) ? '#f59e0b' : '#4a5568'};
                  padding: 2px 6px;
                  margin: 2px;
                  border-radius: 4px;
                  font-size: 11px;
                ">${tag}</span>
              `).join('')}
            </div>
          ` : ''}
        </div>
        <div style="margin-top: 8px; font-size: 10px; opacity: 0.7;">
          Click to view details
        </div>
      `)
      .style('left', (event.pageX + 10) + 'px')
      .style('top', (event.pageY - 28) + 'px');
    }
    
    function hideTooltip() {
      tooltip.transition().duration(500).style('opacity', 0);
    }
    
    // Cleanup on unmount
    return () => {
      d3.select('body').selectAll('.tooltip').remove();
    };
  }, [interviews, currentClusters, selectedInterview, onSelectInterview, selectedTags]);
  
  return (
    <div>
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Cluster By:
        </label>
        <select
          value={clusterType}
          onChange={(e) => setClusterType(e.target.value)}
          className="w-full md:w-auto px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="summary">Summary Content</option>
          <option value="themes">Themes</option>
          <option value="collegeExperience">College Experiences</option>
          <option value="quotes">All Quotes</option>
          {availableTags.length > 0 && (
            <optgroup label="Quote Tags">
              {availableTags.map(tag => (
                <option key={tag} value={`tag:${tag}`}>
                  Tag: {tag.charAt(0).toUpperCase() + tag.slice(1)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      
      {selectedTags.size > 0 && (
        <div className="mb-3 flex items-center text-sm">
          <span className="text-amber-600 mr-2">🔍</span>
          <span className="text-gray-600">
            Highlighting interviews with selected tags
          </span>
        </div>
      )}
      
      <div className="w-full h-full flex justify-center">
        <svg ref={svgRef}></svg>
      </div>
    </div>
  );
};

export default ClusterVisualization;