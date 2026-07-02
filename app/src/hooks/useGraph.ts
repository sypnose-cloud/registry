import { useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import type { UnifiedGraph } from '../types/graph';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

// Color map by node type
const NODE_TYPE_COLORS: Record<string, string> = {
  file: '#2563eb',
  function: '#16a34a',
  class: '#d97706',
  route: '#dc2626',
  table: '#9333ea',
  module: '#ea580c',
  interface: '#0d9488',
  variable: '#0284c7',
  document: '#6366f1',
  data: '#0891b2',
  config: '#78716c',
  asset: '#f59e0b',
};

// Community colors — vivid, well-separated hues for mindmap branches
const COMMUNITY_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#f97316', '#14b8a6', '#ec4899',
  '#06b6d4', '#84cc16', '#6366f1', '#e11d48',
];

export function buildGraphologyGraph(data: UnifiedGraph): Graph {
  const g = new Graph({ multi: false, type: 'directed' });

  // Compute degree ahead of time
  const inDegree: Record<string, number> = {};
  const outDegree: Record<string, number> = {};
  const nodes = data.nodes ?? [];
  const edges = data.edges ?? [];
  for (const node of nodes) {
    if (node.id == null) continue;
    inDegree[node.id] = 0;
    outDegree[node.id] = 0;
  }
  for (const edge of edges) {
    if (edge.source == null || edge.target == null) continue;
    outDegree[edge.source] = (outDegree[edge.source] || 0) + 1;
    inDegree[edge.target] = (inDegree[edge.target] || 0) + 1;
  }

  const seenNodes = new Set<string>();
  for (const node of nodes) {
    if (node.id == null || seenNodes.has(node.id)) continue;
    seenNodes.add(node.id);

    const deg = (inDegree[node.id] || 0) + (outDegree[node.id] || 0);
    const baseSize = 6 + Math.sqrt(deg) * 4;
    const communityColor = node.community != null
      ? COMMUNITY_COLORS[node.community % COMMUNITY_COLORS.length]
      : NODE_TYPE_COLORS[node.type ?? ''] ?? '#8890a0';

    g.addNode(node.id, {
      label: node.label ?? node.id ?? '(unnamed)',
      nodeType: node.type,
      language: node.language,
      path: node.path,
      lines: node.lines,
      community: node.community,
      communityName: node.communityName,
      x: node.x ?? (Math.random() - 0.5) * 1000,
      y: node.y ?? (Math.random() - 0.5) * 1000,
      size: node.size ?? baseSize,
      color: node.color ?? communityColor,
      borderColor: NODE_TYPE_COLORS[node.type ?? ''] ?? '#8890a0',
      inDegree: inDegree[node.id] || 0,
      outDegree: outDegree[node.id] || 0,
      degree: deg,
      exported: node.exported,
      // Sigma attributes
      highlighted: false,
    });
  }

  for (const edge of edges) {
    // Skip if either endpoint doesn't exist
    if (edge.source == null || edge.target == null) continue;
    if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue;
    // Skip self-loops
    if (edge.source === edge.target) continue;
    // Skip duplicates
    if (g.hasEdge(edge.source, edge.target)) continue;

    const sourceColor = g.getNodeAttribute(edge.source, 'color') as string;
    const edgeColor = edge.color ?? (sourceColor ? sourceColor + '60' : 'rgba(160, 170, 190, 0.35)');
    g.addEdge(edge.source, edge.target, {
      edgeType: edge.type,
      size: edge.weight ?? 1,
      color: edgeColor,
    });
  }

  // Layout: radial mindmap with multiple possible roots
  const needsLayout = nodes.some(n => n.x == null || n.y == null);
  if (needsLayout && g.order > 0) {
    // Find top roots by degree — take top 1-3 hubs as roots
    const scored: { id: string; score: number }[] = [];
    g.forEachNode((nodeId, attrs) => {
      scored.push({ id: nodeId, score: (attrs.outDegree as number) * 2 + (attrs.degree as number) });
    });
    scored.sort((a, b) => b.score - a.score);

    // Pick roots: top node always, then any node with score >= 50% of top
    const topScore = scored[0]?.score ?? 0;
    const threshold = Math.max(topScore * 0.5, 1);
    const roots = scored.filter(s => s.score >= threshold).slice(0, 5).map(s => s.id);
    if (roots.length === 0 && scored.length > 0) roots.push(scored[0].id);

    // BFS from all roots simultaneously to build tree layers
    const visited = new Set<string>();
    const parentMap = new Map<string, string>();
    const rootOf = new Map<string, string>();
    const layers: string[][] = [];

    for (const rid of roots) {
      visited.add(rid);
      rootOf.set(rid, rid);
    }
    layers.push([...roots]);

    while (visited.size < g.order) {
      const prev = layers[layers.length - 1];
      const next: string[] = [];
      for (const nid of prev) {
        for (const neighbor of g.neighbors(nid)) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            next.push(neighbor);
            parentMap.set(neighbor, nid);
            rootOf.set(neighbor, rootOf.get(nid) ?? nid);
          }
        }
      }
      if (next.length === 0) {
        g.forEachNode((nodeId) => {
          if (!visited.has(nodeId)) {
            visited.add(nodeId);
            next.push(nodeId);
            rootOf.set(nodeId, nodeId);
          }
        });
      }
      if (next.length > 0) layers.push(next);
    }

    // Place roots: if 1 root, center; if multiple, spread on a small circle
    if (roots.length === 1) {
      g.setNodeAttribute(roots[0], 'x', 0);
      g.setNodeAttribute(roots[0], 'y', 0);
    } else {
      const rootRadius = 100 + roots.length * 40;
      for (let ri = 0; ri < roots.length; ri++) {
        const angle = (ri / roots.length) * 2 * Math.PI - Math.PI / 2;
        g.setNodeAttribute(roots[ri], 'x', Math.cos(angle) * rootRadius);
        g.setNodeAttribute(roots[ri], 'y', Math.sin(angle) * rootRadius);
      }
    }
    for (const rid of roots) {
      g.setNodeAttribute(rid, 'size', (g.getNodeAttribute(rid, 'size') as number) * 1.5);
    }

    // Place each layer in concentric rings, grouping by branch (root ancestor)
    const layerSpacing = 120 + Math.sqrt(g.order) * 6;
    for (let li = 1; li < layers.length; li++) {
      const layer = layers[li];
      const r = li * layerSpacing;

      // Group by parent to keep branches together
      const byParent = new Map<string, string[]>();
      for (const nid of layer) {
        const p = parentMap.get(nid) ?? '__orphan__';
        if (!byParent.has(p)) byParent.set(p, []);
        byParent.get(p)!.push(nid);
      }

      const totalNodes = layer.length;
      let angleOffset = 0;
      byParent.forEach((children) => {
        const sectorSize = (children.length / totalNodes) * 2 * Math.PI;
        for (let ci = 0; ci < children.length; ci++) {
          const angle = angleOffset + (ci + 0.5) * (sectorSize / children.length);
          const jitter = (Math.random() - 0.5) * layerSpacing * 0.12;
          g.setNodeAttribute(children[ci], 'x', Math.cos(angle) * (r + jitter));
          g.setNodeAttribute(children[ci], 'y', Math.sin(angle) * (r + jitter));
        }
        angleOffset += sectorSize;
      });
    }

    // Light ForceAtlas2 pass to untangle overlaps
    try {
      forceAtlas2.assign(g, {
        iterations: 15,
        settings: {
          gravity: 0.5,
          scalingRatio: 20,
          barnesHutOptimize: true,
          strongGravityMode: true,
        },
      });
    } catch {
      // radial positions are already good
    }
  }

  return g;
}

// Hook that watches for graph data changes and syncs stats
export function useGraphStats() {
  const { graph, setStats } = useAppStore();

  useEffect(() => {
    if (!graph) return;
    setStats({
      nodeCount: graph.nodes?.length ?? 0,
      edgeCount: graph.edges?.length ?? 0,
      communityCount: graph.communities?.length ?? 0,
    });
  }, [graph, setStats]);
}
