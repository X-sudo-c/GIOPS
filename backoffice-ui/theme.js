/** GIOP Cytoscape SLD theme — voltage classes and conflict styling */
window.GIOP_CYTOSCAPE_THEME = [
  {
    selector: 'node',
    style: {
      'background-color': '#475569',
      label: 'data(label)',
      color: '#f8fafc',
      'font-size': 10,
      'text-valign': 'bottom',
      'text-margin-y': 6,
      width: 22,
      height: 22,
    },
  },
  {
    selector: 'node[connected = "false"]',
    style: {
      'border-width': 3,
      'border-color': '#f59e0b',
      'border-style': 'dashed',
      'background-color': '#334155',
    },
  },
  {
    selector: 'node[validation = "IN_CONFLICT"]',
    style: {
      'border-width': 4,
      'border-color': '#ef4444',
      'background-color': '#7f1d1d',
    },
  },
  {
    selector: 'node[validation = "PENDING_FIELD"]',
    style: {
      'border-width': 3,
      'border-color': '#f59e0b',
    },
  },
  {
    selector: 'edge[phases]',
    style: {
      label: 'data(phases)',
      'font-size': 8,
      color: '#94a3b8',
    },
  },
  {
    selector: 'edge',
    style: {
      width: 3,
      'line-color': '#475569',
      'target-arrow-color': '#475569',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
    },
  },
  {
    selector: 'edge[voltage = "HV_161KV"]',
    style: { width: 5, 'line-color': '#78350F', 'target-arrow-color': '#78350F' },
  },
  {
    selector: 'edge[voltage = "MV_33KV"]',
    style: { width: 3.5, 'line-color': '#1D4ED8', 'target-arrow-color': '#1D4ED8' },
  },
  {
    selector: 'edge[voltage = "MV_11KV"]',
    style: { width: 2.5, 'line-color': '#B91C1C', 'target-arrow-color': '#B91C1C' },
  },
  {
    selector: 'edge[voltage = "LV_230V"]',
    style: {
      width: 1.5,
      'line-color': '#0F172A',
      'line-style': 'dashed',
      'target-arrow-color': '#0F172A',
    },
  },
  {
    selector: 'node.highlighted',
    style: {
      'background-color': '#22d3ee',
      'border-width': 4,
      'border-color': '#ffffff',
    },
  },
];
