import { create } from 'zustand';
import type { GraphNode, UnifiedGraph, GraphStats } from '../types/graph';

interface SelectionHistoryEntry {
  nodeId: string;
  timestamp: number;
}

interface AppState {
  // Graph data
  graph: UnifiedGraph | null;
  setGraph: (graph: UnifiedGraph) => void;

  // Selected node
  selectedNodeId: string | null;
  selectedNode: GraphNode | null;
  setSelectedNode: (nodeId: string | null) => void;

  // Hovered node
  hoveredNodeId: string | null;
  setHoveredNode: (nodeId: string | null) => void;

  // UI panels
  isSearchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  toggleSearch: () => void;

  isFilterOpen: boolean;
  setFilterOpen: (open: boolean) => void;
  toggleFilter: () => void;

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

  // Layout
  isLayoutPaused: boolean;
  toggleLayoutPause: () => void;

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

  // Hovered node
  hoveredNodeId: null,
  setHoveredNode: (nodeId) => set({ hoveredNodeId: nodeId }),

  // UI panels
  isSearchOpen: false,
  setSearchOpen: (open) => set({ isSearchOpen: open }),
  toggleSearch: () => set((s) => ({ isSearchOpen: !s.isSearchOpen })),

  isFilterOpen: false,
  setFilterOpen: (open) => set({ isFilterOpen: open }),
  toggleFilter: () => set((s) => ({ isFilterOpen: !s.isFilterOpen })),

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

  // Layout
  isLayoutPaused: false,
  toggleLayoutPause: () => set((s) => ({ isLayoutPaused: !s.isLayoutPaused })),

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
}));
