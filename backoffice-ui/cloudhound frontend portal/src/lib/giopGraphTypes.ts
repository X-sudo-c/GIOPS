export type {
  CloudHoundPortalGraphResponse as PortalGraphResponse,
  CloudHoundPortalGraphNode as PortalGraphNode,
  CloudHoundPortalGraphEdge as PortalGraphEdge,
  CloudHoundAIChatResponse as PortalAIChatResponse,
  CloudHoundPolicyDocumentResponse as PortalPolicyDocumentResponse,
  CloudHoundPathFindingResponse as PortalPathFindingResponse,
} from '../api/cloudhound-api';

export type GiopGraphQueryKey =
  | 'network_topology'
  | 'traced_subgraph'
  | 'viewport_subgraph'
  | 'topology_gaps'
  | 'conflicts'
  | 'critical_assets';

export const GIOP_GRAPH_QUERY_OPTIONS: Array<{ key: GiopGraphQueryKey; label: string }> = [
  { key: 'traced_subgraph', label: 'Traced' },
  { key: 'viewport_subgraph', label: 'Viewport' },
  { key: 'network_topology', label: 'Full network (map)' },
  { key: 'topology_gaps', label: 'Disconnected' },
  { key: 'conflicts', label: 'Conflicts' },
  { key: 'critical_assets', label: 'Critical assets' },
];

export const SPLIT_VIEW_GRAPH_QUERY_OPTIONS = GIOP_GRAPH_QUERY_OPTIONS.filter(
  (o) => o.key === 'viewport_subgraph' || o.key === 'traced_subgraph',
);
