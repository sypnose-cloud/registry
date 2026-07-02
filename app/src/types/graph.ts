// Graph type definitions for Sypnose Registry

export type NodeType = 'file' | 'function' | 'class' | 'document' | 'data' | 'config' | 'asset' | 'route' | 'table' | 'module' | 'interface' | 'variable';
export type Language = string;

export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  language?: Language;
  path?: string;
  lines?: number;
  size_bytes?: number;
  community?: number;
  communityName?: string;
  x?: number;
  y?: number;
  size?: number;
  color?: string;
  // Connection counts (computed)
  inDegree?: number;
  outDegree?: number;
  degree?: number;
  // Metadata
  exported?: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'imports' | 'contains';
  weight?: number;
  color?: string;
}

export interface Community {
  id: number;
  name: string;
  color: string;
  nodeCount: number;
}

export interface UnifiedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  communities: Community[];
  projectName: string;
  projectPath: string;
  scannedAt: string;
  totalFiles: number;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
  zoom: number;
}
