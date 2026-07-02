import { useState, useCallback } from 'react';
import './styles/global.css';

import { Toolbar } from './components/Toolbar';
import { StatusBar } from './components/StatusBar';
import { GraphCanvas } from './components/GraphCanvas';
import { NodeDetailPanel } from './components/NodeDetailPanel';
import { SearchPalette } from './components/SearchPalette';
import { FilterBar } from './components/FilterBar';
import { IndexingProgress } from './components/IndexingProgress';
import { WelcomeScreen } from './components/WelcomeScreen';
import { AiBridgeBadge } from './components/AiBridgeBadge';
import { useKeyboard } from './hooks/useKeyboard';
import { useAppStore } from './stores/appStore';
import type { UnifiedGraph, NodeType, Language } from './types/graph';
import sampleData from './data/sample-graph.json';

function adaptRawGraph(raw: Record<string, unknown>, projectPath: string): UnifiedGraph {
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

function adaptSampleGraph(): UnifiedGraph {
  return adaptRawGraph(sampleData as unknown as Record<string, unknown>, '/demo/sample-project');
}

function App() {
  const { setGraph, selectedNodeId, isFilterOpen, isIndexing, setIndexing, setStats, graph } = useAppStore();
  const [showWelcome, setShowWelcome] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useKeyboard();

  const loadGraph = useCallback((data: UnifiedGraph) => {
    setShowWelcome(false);
    setLoadError(null);
    setIndexing(true, { current: 0, total: data.totalFiles });

    let current = 0;
    const total = data.totalFiles || 1;
    const step = Math.max(1, Math.ceil(total / 30));
    const interval = setInterval(() => {
      current += step + Math.floor(Math.random() * step);
      if (current >= total) {
        current = total;
        clearInterval(interval);
        setTimeout(() => {
          setGraph(data);
          setStats({
            nodeCount: data.nodes?.length ?? 0,
            edgeCount: data.edges?.length ?? 0,
            communityCount: data.communities?.length ?? 0,
            zoom: 1,
          });
          setIndexing(false);
        }, 300);
        return;
      }
      setIndexing(true, { current, total });
    }, 60);
  }, [setGraph, setStats, setIndexing]);

  const openFolder = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const folder = await invoke<string | null>('open_folder_dialog');
      if (!folder) return;

      try {
        const jsonStr = await invoke<string>('read_graph_json', { path: folder });
        const raw = JSON.parse(jsonStr);
        const data = adaptRawGraph(raw, folder);

        await invoke('save_recent_project', {
          path: folder,
          name: folder.split(/[\\/]/).filter(Boolean).pop() || 'Project',
        });

        loadGraph(data);
      } catch {
        // No graph.json found — auto-index the project
        setShowWelcome(false);
        setLoadError(null);
        setIndexing(true, { current: 0, total: 0 });

        try {
          const indexedJson = await invoke<string>('index_project', { path: folder });
          const raw = JSON.parse(indexedJson);
          const data = adaptRawGraph(raw, folder);

          await invoke('save_recent_project', {
            path: folder,
            name: folder.split(/[\\/]/).filter(Boolean).pop() || 'Project',
          });

          setIndexing(false);
          setGraph(data);
          setStats({
            nodeCount: data.nodes?.length ?? 0,
            edgeCount: data.edges?.length ?? 0,
            communityCount: data.communities?.length ?? 0,
            zoom: 1,
          });
        } catch (indexErr) {
          setIndexing(false);
          setShowWelcome(true);
          setLoadError(
            `Could not index "${folder}".\n\n${indexErr}`
          );
        }
      }
    } catch {
      // Not running in Tauri — load demo
      loadGraph(adaptSampleGraph());
    }
  }, [loadGraph]);

  const openProject = useCallback(async (path: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');

      let jsonStr: string;
      try {
        jsonStr = await invoke<string>('read_graph_json', { path });
      } catch {
        // No graph found — auto-index
        setShowWelcome(false);
        setLoadError(null);
        setIndexing(true, { current: 0, total: 0 });

        try {
          jsonStr = await invoke<string>('index_project', { path });
        } catch (indexErr) {
          setIndexing(false);
          setShowWelcome(true);
          setLoadError(`Could not index "${path}".\n\n${indexErr}`);
          return;
        }
        setIndexing(false);
      }

      const raw = JSON.parse(jsonStr);
      const data = adaptRawGraph(raw, path);

      await invoke('save_recent_project', {
        path,
        name: path.split(/[\\/]/).filter(Boolean).pop() || 'Project',
      });

      loadGraph(data);
    } catch {
      setLoadError(`Could not load graph from "${path}".`);
    }
  }, [loadGraph, setGraph, setStats, setIndexing]);

  const handleBack = useCallback(() => {
    setShowWelcome(true);
    setGraph(null!);
  }, [setGraph]);

  if (showWelcome && !graph) {
    return (
      <div className="app-layout">
        <WelcomeScreen onOpenFolder={openFolder} onSelectProject={openProject} />
        {loadError && (
          <div style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#ffffff',
            border: '1px solid #dc2626',
            borderRadius: 8,
            padding: '12px 20px',
            maxWidth: 500,
            zIndex: 999,
          }}>
            <div style={{ color: '#dc2626', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Graph not found
            </div>
            <div style={{ color: '#6b7280', fontSize: 12, whiteSpace: 'pre-line' }}>
              {loadError}
            </div>
            <button
              onClick={() => { setLoadError(null); loadGraph(adaptSampleGraph()); }}
              style={{
                marginTop: 8,
                padding: '6px 14px',
                borderRadius: 4,
                background: '#2563eb',
                color: '#fff',
                fontSize: 12,
                fontWeight: 500,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Load Demo Graph
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Toolbar projectName={graph?.projectName ?? 'Sypnose Registry'} onBack={handleBack} />
      <FilterBar />
      <GraphCanvas data={graph ?? undefined} />
      <div style={{
        position: 'fixed',
        top: isFilterOpen ? 92 : 48,
        bottom: 28,
        left: 0,
        right: 0,
        pointerEvents: isIndexing ? 'all' : 'none',
        zIndex: 50,
      }}>
        <IndexingProgress />
      </div>
      <StatusBar />
      <AiBridgeBadge />
      {selectedNodeId && <NodeDetailPanel />}
      <SearchPalette />
    </div>
  );
}

export default App;
