import { useState, useCallback, useEffect } from 'react';
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
import type { UnifiedGraph } from './types/graph';
import { adaptRawGraph } from './utils/adaptGraph';
import { TimeSlider } from './components/TimeSlider';
import sampleData from './data/sample-graph.json';

function adaptSampleGraph(): UnifiedGraph {
  return adaptRawGraph(sampleData as unknown as Record<string, unknown>, '/demo/sample-project');
}

function App() {
  const {
    setGraph, selectedNodeId, isFilterOpen, isIndexing, setIndexing, setStats, graph,
    setProjectPath, setHistoryScans, viewMode, returnToLive,
  } = useAppStore();
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

  // ── M2 + M3: Live watcher + temporal snapshots ────────────────────────
  // When a folder is loaded, start the watcher, subscribe to `graph-updated`,
  // and load the snapshot history for the time-slider.
  //  - LIVE mode: graph-updated updates the visible graph (present).
  //  - HISTORICAL mode: the visible graph is frozen on a past snapshot; a
  //    graph-updated event does NOT stomp it (only the snapshot list refreshes,
  //    so a new tick appears on the slider). viewMode is read live via getState().
  // Cleanup: unlisten + stop the watcher when the folder changes / unmounts.
  useEffect(() => {
    if (!graph?.projectPath) return;

    const projectPath = graph.projectPath;
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;

    // Helper: refresh the snapshot tick list for the slider.
    const refreshHistory = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const scans = await invoke<import('./stores/appStore').ScanSummary[]>(
          'list_snapshots', { path: projectPath }
        );
        if (!cancelled) setHistoryScans(scans);
      } catch {
        // No Tauri / no history yet — leave the slider hidden.
      }
    };

    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const { listen } = await import('@tauri-apps/api/event');

        setProjectPath(projectPath);

        // Subscribe BEFORE starting the watcher so we never miss the first event.
        const unlisten = await listen<string>('graph-updated', (event) => {
          if (cancelled) return;
          // A new snapshot was just recorded by the backend — refresh the ticks.
          void refreshHistory();

          // Respect historical mode: do NOT overwrite a past view (read live state).
          if (useAppStore.getState().viewMode === 'historical') {
            console.log('[M3] graph-updated ignored (historical view frozen)');
            return;
          }
          try {
            const raw = JSON.parse(event.payload) as Record<string, unknown>;
            const updated = adaptRawGraph(raw, projectPath);
            setGraph(updated);
            setStats({
              nodeCount: updated.nodes?.length ?? 0,
              edgeCount: updated.edges?.length ?? 0,
              communityCount: updated.communities?.length ?? 0,
            });
          } catch (err) {
            console.error('[M2] graph-updated parse error:', err);
          }
        });

        if (cancelled) {
          // Effect cleaned up before the async subscribe finished — immediately unlisten.
          unlisten();
          return;
        }

        unlistenFn = unlisten;

        // Start the OS watcher on this folder (tears down any previous watcher first).
        await invoke('start_watch', { path: projectPath });
        console.log('[M2] watcher started for', projectPath);

        // Initial snapshot history load (the first index already recorded a scan).
        await refreshHistory();
      } catch (err) {
        // Running in browser dev mode (no Tauri) — silently skip.
        console.warn('[M2] start_watch not available (browser mode?):', err);
      }
    })();

    return () => {
      cancelled = true;
      // Cleanup: remove the event listener and stop the backend watcher.
      if (unlistenFn) unlistenFn();
      (async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('stop_watch');
          console.log('[M2] watcher stopped for', projectPath);
        } catch {
          // Silently ignore in browser mode.
        }
      })();
    };
  }, [graph?.projectPath, setGraph, setStats, setProjectPath, setHistoryScans]);
  // ── end M2 + M3 ───────────────────────────────────────────────────────

  const handleBack = useCallback(() => {
    setShowWelcome(true);
    setGraph(null!);
    // M3: leaving the project resets temporal state.
    setProjectPath(null);
    setHistoryScans([]);
    if (viewMode === 'historical') returnToLive();
  }, [setGraph, setProjectPath, setHistoryScans, viewMode, returnToLive]);

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
      <TimeSlider />
      <AiBridgeBadge />
      {selectedNodeId && <NodeDetailPanel />}
      <SearchPalette />
    </div>
  );
}

export default App;
