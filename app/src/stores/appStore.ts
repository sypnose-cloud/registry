import { create } from 'zustand';
import type { GraphNode, UnifiedGraph, GraphStats } from '../types/graph';

interface SelectionHistoryEntry {
  nodeId: string;
  timestamp: number;
}

// ── M3: temporal memory / time-slider ──────────────────────────────────
export interface ScanSummary {
  scan_id: number;
  ts: string;
  node_count: number;
  edge_count: number;
  added: number;
  removed: number;
  modified: number;
}

export interface ChangeEvent {
  entity_id: string;
  entity_kind: 'node' | 'edge';
  change_type: 'added' | 'removed' | 'modified';
  payload_json: string;
}

/**
 * View mode governs the interaction between M2 (live watcher) and M3 (time travel):
 *  - 'live': the watcher's graph-updated events flow into the graph (present).
 *  - 'historical': the graph is frozen on a past snapshot; graph-updated events
 *    are IGNORED so the past view is not stomped. Returning to 'live' re-engages.
 */
export type ViewMode = 'live' | 'historical';

interface AppState {
  // Graph data
  graph: UnifiedGraph | null;
  setGraph: (graph: UnifiedGraph) => void;

  // Selected node
  selectedNodeId: string | null;
  selectedNode: GraphNode | null;
  setSelectedNode: (nodeId: string | null) => void;

  // UI panels
  isSearchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  toggleSearch: () => void;

  isFilterOpen: boolean;
  setFilterOpen: (open: boolean) => void;
  toggleFilter: () => void;

  // M4: chat panel (NotebookLM-style)
  isChatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  toggleChat: () => void;

  // M8: architecture view ("¿Cómo estoy hecho?")
  isArchitectureOpen: boolean;
  setArchitectureOpen: (open: boolean) => void;
  toggleArchitecture: () => void;

  isIndexing: boolean;
  indexingProgress: { current: number; total: number };
  setIndexing: (indexing: boolean, progress?: { current: number; total: number }) => void;

  // Filters
  activeTypeFilters: Set<string>;
  activeCommunityFilters: Set<number>;
  activeLanguageFilters: Set<string>;
  toggleTypeFilter: (type: string) => void;
  toggleCommunityFilter: (communityId: number) => void;
  toggleLanguageFilter: (language: string) => void;
  clearAllFilters: () => void;

  // Graph stats
  stats: GraphStats;
  setStats: (stats: Partial<GraphStats>) => void;

  // Selection history (for [ ] navigation)
  selectionHistory: SelectionHistoryEntry[];
  historyIndex: number;
  navigateHistoryBack: () => void;
  navigateHistoryForward: () => void;

  // Focus on node (triggers sigma camera)
  focusNodeId: string | null;
  setFocusNode: (nodeId: string | null) => void;

  // Fit graph to view
  fitRequestId: number;
  requestFit: () => void;

  // ── M3: temporal memory / time-slider ──
  /** Active project path (set when a folder loads) — needed for snapshot commands. */
  projectPath: string | null;
  setProjectPath: (path: string | null) => void;

  /** All recorded scans (oldest first). Slider is shown only when length > 1. */
  historyScans: ScanSummary[];
  setHistoryScans: (scans: ScanSummary[]) => void;

  /** 'live' (present, watcher active) vs 'historical' (frozen on a past snapshot). */
  viewMode: ViewMode;
  /** scan_id currently being viewed in historical mode (null in live mode). */
  activeScanId: number | null;
  /** Change overlay (added/removed/modified) for the active historical scan. */
  changeOverlay: ChangeEvent[];
  /** Enter historical mode on a given scan with its change overlay. */
  enterHistorical: (scanId: number, overlay: ChangeEvent[]) => void;
  /** Return to live/present mode (re-engages the watcher view). */
  returnToLive: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Graph data
  graph: null,
  setGraph: (graph) => set({ graph }),

  // Selected node
  selectedNodeId: null,
  selectedNode: null,
  setSelectedNode: (nodeId) => {
    const { graph, selectionHistory, historyIndex } = get();
    const node = nodeId && graph ? graph.nodes.find(n => n.id === nodeId) ?? null : null;

    if (nodeId && node) {
      // Add to history
      const newEntry: SelectionHistoryEntry = { nodeId, timestamp: Date.now() };
      const truncated = selectionHistory.slice(0, historyIndex + 1);
      const newHistory = [...truncated, newEntry].slice(-50); // keep last 50
      set({
        selectedNodeId: nodeId,
        selectedNode: node,
        selectionHistory: newHistory,
        historyIndex: newHistory.length - 1,
      });
    } else {
      set({ selectedNodeId: null, selectedNode: null });
    }
  },

  // UI panels
  isSearchOpen: false,
  setSearchOpen: (open) => set({ isSearchOpen: open }),
  toggleSearch: () => set((s) => ({ isSearchOpen: !s.isSearchOpen })),

  isFilterOpen: false,
  setFilterOpen: (open) => set({ isFilterOpen: open }),
  toggleFilter: () => set((s) => ({ isFilterOpen: !s.isFilterOpen })),

  // M4: chat panel
  isChatOpen: false,
  setChatOpen: (open) => set({ isChatOpen: open }),
  toggleChat: () => set((s) => ({ isChatOpen: !s.isChatOpen })),

  // M8: architecture view
  isArchitectureOpen: false,
  setArchitectureOpen: (open) => set({ isArchitectureOpen: open }),
  toggleArchitecture: () => set((s) => ({ isArchitectureOpen: !s.isArchitectureOpen })),

  isIndexing: false,
  indexingProgress: { current: 0, total: 0 },
  setIndexing: (indexing, progress) =>
    set({ isIndexing: indexing, ...(progress ? { indexingProgress: progress } : {}) }),

  // Filters
  activeTypeFilters: new Set(),
  activeCommunityFilters: new Set(),
  activeLanguageFilters: new Set(),

  toggleTypeFilter: (type) =>
    set((s) => {
      const next = new Set(s.activeTypeFilters);
      if (next.has(type)) next.delete(type); else next.add(type);
      return { activeTypeFilters: next };
    }),

  toggleCommunityFilter: (communityId) =>
    set((s) => {
      const next = new Set(s.activeCommunityFilters);
      if (next.has(communityId)) next.delete(communityId); else next.add(communityId);
      return { activeCommunityFilters: next };
    }),

  toggleLanguageFilter: (language) =>
    set((s) => {
      const next = new Set(s.activeLanguageFilters);
      if (next.has(language)) next.delete(language); else next.add(language);
      return { activeLanguageFilters: next };
    }),

  clearAllFilters: () =>
    set({
      activeTypeFilters: new Set(),
      activeCommunityFilters: new Set(),
      activeLanguageFilters: new Set(),
    }),

  // Graph stats
  stats: { nodeCount: 0, edgeCount: 0, communityCount: 0, zoom: 1 },
  setStats: (partial) => set((s) => ({ stats: { ...s.stats, ...partial } })),

  // Selection history
  selectionHistory: [],
  historyIndex: -1,

  navigateHistoryBack: () => {
    const { selectionHistory, historyIndex, graph } = get();
    const newIndex = historyIndex - 1;
    if (newIndex < 0 || selectionHistory.length === 0) return;
    const entry = selectionHistory[newIndex];
    const node = graph ? graph.nodes.find(n => n.id === entry.nodeId) ?? null : null;
    set({ historyIndex: newIndex, selectedNodeId: entry.nodeId, selectedNode: node, focusNodeId: entry.nodeId });
  },

  navigateHistoryForward: () => {
    const { selectionHistory, historyIndex, graph } = get();
    const newIndex = historyIndex + 1;
    if (newIndex >= selectionHistory.length) return;
    const entry = selectionHistory[newIndex];
    const node = graph ? graph.nodes.find(n => n.id === entry.nodeId) ?? null : null;
    set({ historyIndex: newIndex, selectedNodeId: entry.nodeId, selectedNode: node, focusNodeId: entry.nodeId });
  },

  // Focus node
  focusNodeId: null,
  setFocusNode: (nodeId) => set({ focusNodeId: nodeId }),

  // Fit graph to view
  fitRequestId: 0,
  requestFit: () => set((s) => ({ fitRequestId: s.fitRequestId + 1 })),

  // ── M3: temporal memory / time-slider ──
  projectPath: null,
  setProjectPath: (path) => set({ projectPath: path }),

  historyScans: [],
  setHistoryScans: (scans) => set({ historyScans: scans }),

  viewMode: 'live',
  activeScanId: null,
  changeOverlay: [],
  enterHistorical: (scanId, overlay) =>
    set({ viewMode: 'historical', activeScanId: scanId, changeOverlay: overlay }),
  returnToLive: () =>
    set({ viewMode: 'live', activeScanId: null, changeOverlay: [] }),
}));
