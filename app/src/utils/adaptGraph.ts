// Single adapter from raw indexer/snapshot JSON → UnifiedGraph.
// Shared by App.tsx (live/index) and TimeSlider.tsx (historical snapshots) so
// that time-travel reconstruction goes through the EXACT same pipeline entry as
// live indexing (M1 principle: one graph pipeline). buildGraphologyGraph +
// positionCache downstream then keep persisting nodes from jumping.

import type { UnifiedGraph, NodeType, Language } from '../types/graph';

export function adaptRawGraph(raw: Record<string, unknown>, projectPath: string): UnifiedGraph {
  const rawNodes = (raw.nodes ?? []) as Array<Record<string, unknown>>;
  const seenIds = new Set<string>();
  const nodes = rawNodes.filter(n => {
    const id = n.id as string;
    if (id == null || seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  }).map(n => ({
    id: n.id as string,
    label: n.label as string,
    type: (n.type as NodeType) || 'file',
    language: (n.language as Language) ?? undefined,
    path: (n.path as string) ?? undefined,
    lines: (n.lines as number) ?? undefined,
    size_bytes: (n.size_bytes as number) ?? undefined,
    community: (n.community as number) ?? undefined,
    communityName: (n.communityName as string) ?? undefined,
    exported: (n.exported as boolean) ?? undefined,
  }));

  const rawEdges = (raw.edges ?? []) as Array<Record<string, unknown>>;
  const edges = rawEdges.filter(e => e.source != null && e.target != null).map((e, i) => ({
    id: (e.id as string) || `e${i}`,
    source: e.source as string,
    target: e.target as string,
    type: (['imports', 'contains'].includes(e.type as string) ? e.type as 'imports' | 'contains' : 'imports'),
    weight: e.weight as number | undefined,
  }));

  // Compute degree for each node
  const degreeMap = new Map<string, { in: number; out: number }>();
  for (const node of nodes) degreeMap.set(node.id, { in: 0, out: 0 });
  for (const edge of edges) {
    const src = degreeMap.get(edge.source);
    if (src) src.out++;
    const tgt = degreeMap.get(edge.target);
    if (tgt) tgt.in++;
  }
  for (const node of nodes) {
    const d = degreeMap.get(node.id);
    if (d) {
      (node as Record<string, unknown>).inDegree = d.in;
      (node as Record<string, unknown>).outDegree = d.out;
      (node as Record<string, unknown>).degree = d.in + d.out;
    }
  }

  const communityMap = new Map<number, { name: string; color: string; count: number }>();
  for (const n of nodes) {
    if (n.community != null) {
      const existing = communityMap.get(n.community);
      if (existing) {
        existing.count++;
      } else {
        communityMap.set(n.community, {
          name: n.communityName || `Community ${n.community}`,
          color: '',
          count: 1,
        });
      }
    }
  }

  const meta = raw.metadata as Record<string, unknown> | undefined;
  if (meta?.communities) {
    const mc = meta.communities as Record<string, { name: string; color: string; size: number }>;
    for (const [id, c] of Object.entries(mc)) {
      const existing = communityMap.get(Number(id));
      if (existing) {
        existing.name = c.name;
        existing.color = c.color;
      } else {
        communityMap.set(Number(id), { name: c.name, color: c.color, count: c.size });
      }
    }
  }

  const defaultColors = ['#2563eb', '#51cf66', '#ffd43b', '#dc2626', '#cc5de8', '#ff922b', '#20c997', '#f06595'];
  const communities = Array.from(communityMap.entries()).map(([id, c], i) => ({
    id,
    name: c.name,
    color: c.color || defaultColors[i % defaultColors.length],
    nodeCount: c.count,
  }));

  const folderName = projectPath.split(/[\\/]/).filter(Boolean).pop() || 'Project';

  return {
    projectName: folderName,
    projectPath,
    scannedAt: new Date().toISOString(),
    totalFiles: (meta?.total_files as number) || nodes.length,
    communities,
    nodes,
    edges,
  };
}
