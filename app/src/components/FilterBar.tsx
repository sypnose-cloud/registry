import React, { useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import type { NodeType, Language } from '../types/graph';

const COMMUNITY_COLORS = [
  '#2563eb', '#16a34a', '#d97706', '#dc2626',
  '#9333ea', '#ea580c', '#0d9488', '#db2777',
  '#0284c7', '#65a30d',
];

const NODE_TYPES: NodeType[] = ['file', 'function', 'class', 'document', 'data', 'config', 'asset'];

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

const ClearIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

interface FilterPillProps {
  label: string;
  active: boolean;
  color?: string;
  dot?: boolean;
  onClick: () => void;
}

const FilterPill: React.FC<FilterPillProps> = ({ label, active, color, dot, onClick }) => {
  const [hovered, setHovered] = React.useState(false);

  const pillStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 10px',
    borderRadius: 100,
    fontSize: 11,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    border: `1px solid ${active ? (color ?? 'var(--accent)') : 'var(--border)'}`,
    background: active
      ? `${color ?? 'var(--accent)'}22`
      : hovered ? 'var(--panel-hover)' : 'transparent',
    color: active
      ? (color ?? 'var(--accent)')
      : hovered ? 'var(--text)' : 'var(--text-muted)',
    transition: 'all 0.12s ease',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  };

  return (
    <button
      style={pillStyle}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {dot && (
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: color ?? 'var(--accent)',
          flexShrink: 0,
        }} />
      )}
      <span style={{ textTransform: 'capitalize' }}>{label}</span>
    </button>
  );
};

interface FilterGroupProps {
  label: string;
  children: React.ReactNode;
}

const FilterGroup: React.FC<FilterGroupProps> = ({ label, children }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  }}>
    <span style={{
      fontSize: 10,
      fontWeight: 600,
      color: 'var(--text-dim)',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      flexShrink: 0,
    }}>
      {label}
    </span>
    <div style={{
      width: 1, height: 14,
      background: 'var(--border)',
      flexShrink: 0,
    }} />
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      flexWrap: 'nowrap',
    }}>
      {children}
    </div>
  </div>
);

export const FilterBar: React.FC = () => {
  const {
    isFilterOpen,
    graph,
    activeTypeFilters,
    activeCommunityFilters,
    activeLanguageFilters,
    toggleTypeFilter,
    toggleCommunityFilter,
    toggleLanguageFilter,
    clearAllFilters,
  } = useAppStore();

  // Derive unique languages from graph data
  const availableLanguages = useMemo((): Language[] => {
    if (!graph) return [];
    const langs = new Set<Language>();
    for (const node of graph.nodes) {
      if (node.language) langs.add(node.language);
    }
    return Array.from(langs).sort();
  }, [graph]);

  const hasActiveFilters =
    activeTypeFilters.size > 0 ||
    activeCommunityFilters.size > 0 ||
    activeLanguageFilters.size > 0;

  if (!isFilterOpen) return null;

  const barStyle: React.CSSProperties = {
    position: 'fixed',
    top: 48,
    left: 0,
    right: 0,
    height: 44,
    background: 'var(--panel)',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    gap: 16,
    zIndex: 190,
    overflowX: 'auto',
    overflowY: 'hidden',
    animation: 'slideInDown 0.15s ease',
  };

  return (
    <div style={barStyle}>
      {/* TYPE filters */}
      <FilterGroup label="Type">
        {NODE_TYPES.map(type => (
          <FilterPill
            key={type}
            label={type}
            active={activeTypeFilters.has(type)}
            color={NODE_TYPE_COLORS[type]}
            onClick={() => toggleTypeFilter(type)}
          />
        ))}
      </FilterGroup>

      {/* Vertical separator */}
      <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />

      {/* COMMUNITY filters */}
      {graph && graph.communities.length > 0 && (
        <>
          <FilterGroup label="Community">
            {graph.communities.slice(0, 8).map(community => (
              <FilterPill
                key={community.id}
                label={community.name}
                active={activeCommunityFilters.has(community.id)}
                color={COMMUNITY_COLORS[community.id % COMMUNITY_COLORS.length]}
                dot
                onClick={() => toggleCommunityFilter(community.id)}
              />
            ))}
          </FilterGroup>
          <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />
        </>
      )}

      {/* LANGUAGE filters */}
      {availableLanguages.length > 0 && (
        <FilterGroup label="Lang">
          {availableLanguages.map(lang => (
            <FilterPill
              key={lang}
              label={lang}
              active={activeLanguageFilters.has(lang)}
              onClick={() => toggleLanguageFilter(lang)}
            />
          ))}
        </FilterGroup>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Clear button */}
      {hasActiveFilters && (
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 10px',
            borderRadius: 100,
            border: '1px solid var(--danger)',
            background: 'var(--danger-dim)',
            color: 'var(--danger)',
            fontSize: 11,
            fontWeight: 500,
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.12s',
          }}
          onClick={clearAllFilters}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,107,107,0.25)'}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'var(--danger-dim)'}
        >
          <ClearIcon />
          Clear
        </button>
      )}
    </div>
  );
};
