import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAppStore } from '../stores/appStore';
import type { GraphNode } from '../types/graph';
import { NODE_TYPE_COLORS } from '../constants/colors';

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M10.5 10.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const NODE_TYPE_ICONS: Record<string, React.ReactNode> = {
  file: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2 1h6l2 2v8H2V1z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
      <path d="M7 1v3h3" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
    </svg>
  ),
  function: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2 6h8M5 2l-2 4 2 4M7 2l2 4-2 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  ),
  class: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1"/>
      <path d="M1.5 4.5h9" stroke="currentColor" strokeWidth="1"/>
    </svg>
  ),
  route: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M1 6h10M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  table: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1" y="1" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1"/>
      <path d="M1 4h10M4 4v7" stroke="currentColor" strokeWidth="1"/>
    </svg>
  ),
  module: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="2" y="2" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1"/>
      <circle cx="6" cy="6" r="1.5" fill="currentColor" opacity="0.6"/>
    </svg>
  ),
};

type ResultGroup = {
  label: string;
  nodes: GraphNode[];
};

function groupResults(nodes: GraphNode[]): ResultGroup[] {
  const groups: Record<string, GraphNode[]> = {};
  for (const node of nodes) {
    const key = (node.type ?? 'unknown').toUpperCase() + 'S';
    if (!groups[key]) groups[key] = [];
    groups[key].push(node);
  }
  return Object.entries(groups).map(([label, nodes]) => ({ label, nodes }));
}

function scoreNode(node: GraphNode, query: string): number {
  const q = query.toLowerCase();
  const label = (node.label ?? '').toLowerCase();
  const path = (node.path ?? '').toLowerCase();

  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.includes(q)) return 60;
  if (path.includes(q)) return 30;
  return 0;
}

export const SearchPalette: React.FC = () => {
  const { isSearchOpen, setSearchOpen, graph, setSelectedNode, setFocusNode } = useAppStore();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter and score nodes
  const results = useMemo((): GraphNode[] => {
    if (!graph) return [];
    const q = query.trim().toLowerCase();
    if (!q) {
      // Show top nodes by degree when no query
      return [...(graph.nodes ?? [])]
        .sort((a, b) => ((b.degree ?? 0) - (a.degree ?? 0)))
        .slice(0, 20);
    }

    return (graph.nodes ?? [])
      .map(node => ({ node, score: scoreNode(node, q) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ node }) => node)
      .slice(0, 20);
  }, [graph, query]);

  const groups = useMemo(() => groupResults(results), [results]);

  // Flat result list for keyboard nav
  const flatResults = results;

  // Reset on open
  useEffect(() => {
    if (isSearchOpen) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isSearchOpen]);

  const selectNode = useCallback((node: GraphNode) => {
    setSelectedNode(node.id);
    setFocusNode(node.id);
    setSearchOpen(false);
  }, [setSelectedNode, setFocusNode, setSearchOpen]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => flatResults.length === 0 ? 0 : Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const node = flatResults[activeIndex];
      if (node) selectNode(node);
    }
  }, [flatResults, activeIndex, selectNode]);

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const activeEl = list.querySelector('[data-active="true"]') as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.25)',
    backdropFilter: 'blur(4px)',
    zIndex: 400,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: '15vh',
    animation: 'fadeIn 0.12s ease',
  };

  const paletteStyle: React.CSSProperties = {
    width: 560,
    maxWidth: 'calc(100vw - 32px)',
    background: 'var(--panel)',
    border: '1px solid var(--border-light)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-lg)',
    overflow: 'hidden',
    animation: 'slideInDown 0.15s ease',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '60vh',
  };

  const inputWrapStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    fontSize: 15,
    color: 'var(--text)',
    caretColor: 'var(--accent)',
    boxShadow: 'none',
  };

  return (
    <Dialog.Root open={isSearchOpen} onOpenChange={setSearchOpen}>
      <Dialog.Portal>
        <Dialog.Overlay style={overlayStyle}>
          <Dialog.Content
            style={paletteStyle}
            onOpenAutoFocus={e => e.preventDefault()}
          >
            {/* Search input */}
            <div style={inputWrapStyle}>
              <span style={{ color: 'var(--text-muted)', flexShrink: 0, display: 'flex' }}>
                <SearchIcon />
              </span>
              <input
                ref={inputRef}
                style={inputStyle}
                placeholder="Search nodes, files, functions..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                spellCheck={false}
              />
              {query && (
                <button
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 20, height: 20, borderRadius: '50%',
                    background: 'var(--border)', color: 'var(--text-muted)',
                    cursor: 'pointer', flexShrink: 0,
                    border: 'none',
                  }}
                  onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                >
                  <CloseIcon />
                </button>
              )}
              <kbd style={{ flexShrink: 0 }}>Esc</kbd>
            </div>

            {/* Results */}
            <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
              {flatResults.length === 0 ? (
                <div style={{
                  padding: '32px 16px',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: 13,
                }}>
                  {query ? `No results for "${query}"` : 'Start typing to search...'}
                </div>
              ) : (
                (() => {
                  let globalIndex = 0;
                  return groups.map(group => (
                    <div key={group.label}>
                      <div style={{
                        padding: '8px 16px 4px',
                        fontSize: 10,
                        fontWeight: 700,
                        color: 'var(--text-dim)',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        position: 'sticky',
                        top: 0,
                        background: 'var(--panel)',
                        zIndex: 1,
                      }}>
                        {group.label}
                      </div>
                      {group.nodes.map(node => {
                        const idx = globalIndex++;
                        const isActive = idx === activeIndex;
                        const typeColor = NODE_TYPE_COLORS[node.type] ?? '#8890a0';
                        return (
                          <button
                            key={node.id}
                            data-active={isActive}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              width: '100%',
                              padding: '8px 16px',
                              background: isActive ? 'var(--accent-dim)' : 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              textAlign: 'left',
                              transition: 'background 0.1s',
                              borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                            }}
                            onClick={() => selectNode(node)}
                            onMouseEnter={() => setActiveIndex(idx)}
                          >
                            <span style={{ color: typeColor, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                              {NODE_TYPE_ICONS[node.type] ?? NODE_TYPE_ICONS.file}
                            </span>
                            <span style={{
                              flex: 1,
                              fontSize: 13,
                              color: 'var(--text)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontWeight: isActive ? 500 : 400,
                            }}>
                              {node.label}
                            </span>
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              padding: '1px 6px',
                              borderRadius: 100,
                              fontSize: 9,
                              fontWeight: 600,
                              letterSpacing: '0.04em',
                              textTransform: 'uppercase',
                              background: `${typeColor}22`,
                              color: typeColor,
                              flexShrink: 0,
                            }}>
                              {node.type}
                            </span>
                            {node.path && (
                              <span style={{
                                fontSize: 10,
                                color: 'var(--text-dim)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: 120,
                                flexShrink: 0,
                              }}>
                                {node.path.split('/').slice(-2).join('/')}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ));
                })()
              )}
            </div>

            {/* Footer */}
            {flatResults.length > 0 && (
              <div style={{
                padding: '8px 16px',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                fontSize: 10,
                color: 'var(--text-dim)',
                flexShrink: 0,
              }}>
                <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
                <span><kbd>Enter</kbd> select</span>
                <span><kbd>Esc</kbd> close</span>
                <span style={{ marginLeft: 'auto' }}>{flatResults.length} results</span>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
