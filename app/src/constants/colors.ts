// Single source of truth for node type and community colors.
// All components must import from here — never redefine locally.

export const NODE_TYPE_COLORS: Record<string, string> = {
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

// 12 vivid, well-separated hues for mindmap branches.
// FilterBar shows a subset (10) — always use slice(0, 10) there if needed,
// but the canonical list has 12 to match the canvas renderer.
export const COMMUNITY_COLORS: string[] = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#f97316', '#14b8a6', '#ec4899',
  '#06b6d4', '#84cc16', '#6366f1', '#e11d48',
];
