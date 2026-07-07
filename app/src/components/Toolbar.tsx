import React, { useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { NotebookLmWizard } from './NotebookLmWizard';

// SVG Icons inline
const BackIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M10.5 10.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const FilterIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const ChatIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v6A1.5 1.5 0 0112.5 11H6l-3 3v-3H3.5A1.5 1.5 0 012 9.5v-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
  </svg>
);

// M5: Export digest icon (document with down-arrow).
const ExportIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 2h5l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    <path d="M8 6.5v4M6.5 9l1.5 1.5L9.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// M8: Architecture view icon (stacked boxes / layout).
const LayoutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="2" y="9" width="12" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStyle = React.CSSProperties & Record<string, any>;

interface ToolbarProps {
  projectName?: string;
  onBack?: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  projectName = 'Sypnose Registry',
  onBack,
}) => {
  const { toggleSearch, toggleFilter, isFilterOpen, toggleChat, isChatOpen, graph, toggleArchitecture, isArchitectureOpen } = useAppStore();

  // v2.2: NotebookLM wizard overlay (replaces the old one-shot export + toast).
  const [nbOpen, setNbOpen] = useState(false);

  const styles: Record<string, AnyStyle> = {
    toolbar: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: 48,
      background: 'var(--panel)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: 4,
      zIndex: 200,
      WebkitAppRegion: 'drag',
    },
    left: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flex: '0 0 auto',
      WebkitAppRegion: 'no-drag',
    },
    center: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    right: {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      flex: '0 0 auto',
      WebkitAppRegion: 'no-drag',
    },
    backBtn: {
      width: 28,
      height: 28,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--text-muted)',
      transition: 'background 0.15s, color 0.15s',
      cursor: 'pointer',
    },
    projectName: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--text)',
      letterSpacing: '-0.01em',
    },
    projectDot: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: 'var(--accent)',
      flexShrink: 0,
    },
    iconBtn: {
      width: 32,
      height: 32,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--text-muted)',
      transition: 'background 0.15s, color 0.15s',
      cursor: 'pointer',
      gap: 4,
      fontSize: 11,
    },
    iconBtnActive: {
      background: 'var(--accent-dim)',
      color: 'var(--accent)',
    },
    searchBtn: {
      height: 30,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '0 10px',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border)',
      background: 'var(--bg)',
      color: 'var(--text-muted)',
      cursor: 'pointer',
      fontSize: 12,
      transition: 'border-color 0.15s, color 0.15s',
      WebkitAppRegion: 'no-drag',
    },
    separator: {
      width: 1,
      height: 20,
      background: 'var(--border)',
      margin: '0 4px',
    },
    // M5: export result toast, anchored below the toolbar on the right.
    toast: {
      position: 'fixed',
      top: 54,
      right: 12,
      maxWidth: 480,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 10px',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--panel)',
      border: '1px solid var(--border)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
      fontSize: 12,
      color: 'var(--text)',
      zIndex: 300,
      WebkitAppRegion: 'no-drag',
    },
    toastText: {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      maxWidth: 340,
      fontFamily: 'var(--font-mono, monospace)',
      color: 'var(--text-muted)',
    },
    toastBtn: {
      border: '1px solid var(--border)',
      background: 'var(--bg)',
      color: 'var(--text-muted)',
      borderRadius: 'var(--radius-sm)',
      padding: '2px 6px',
      fontSize: 11,
      cursor: 'pointer',
      flexShrink: 0,
    },
  };

  return (
    <div style={styles.toolbar}>
      {/* Left: Back + Project name */}
      <div style={styles.left}>
        <button
          style={styles.backBtn}
          onClick={onBack}
          title="Go back"
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel-hover)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
          }}
        >
          <BackIcon />
        </button>

        <div style={styles.projectName}>
          <div style={styles.projectDot} />
          <span>{projectName}</span>
        </div>
      </div>

      {/* Center: logo / graph name (drag region) */}
      <div style={styles.center} />

      {/* Right: action buttons */}
      <div style={styles.right}>
        {/* Search */}
        <button
          style={styles.searchBtn}
          onClick={toggleSearch}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
          }}
          title="Search (Ctrl+K)"
        >
          <SearchIcon />
          <span>Search</span>
          <kbd>⌃K</kbd>
        </button>

        <div style={styles.separator} />

        {/* Filter toggle */}
        <button
          style={{
            ...styles.iconBtn,
            ...(isFilterOpen ? styles.iconBtnActive : {}),
          }}
          onClick={toggleFilter}
          title="Toggle filters (F)"
          onMouseEnter={e => {
            if (!isFilterOpen) {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel-hover)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)';
            }
          }}
          onMouseLeave={e => {
            if (!isFilterOpen) {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
            }
          }}
        >
          <FilterIcon />
        </button>

        {/* M4: Chat toggle */}
        <button
          style={{
            ...styles.iconBtn,
            ...(isChatOpen ? styles.iconBtnActive : {}),
          }}
          onClick={toggleChat}
          title="Ask Claude about this folder"
          onMouseEnter={e => {
            if (!isChatOpen) {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel-hover)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)';
            }
          }}
          onMouseLeave={e => {
            if (!isChatOpen) {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
            }
          }}
        >
          <ChatIcon />
        </button>

        {/* M8: Architecture view — "¿Cómo estoy hecho?" */}
        <button
          style={{
            ...styles.iconBtn,
            ...(isArchitectureOpen ? styles.iconBtnActive : {}),
            opacity: graph ? 1 : 0.4,
            cursor: graph ? 'pointer' : 'default',
          }}
          onClick={() => graph && toggleArchitecture()}
          disabled={!graph}
          title={graph ? 'How am I built? — ¿Cómo estoy hecho?' : 'Load a folder first'}
          onMouseEnter={e => {
            if (graph && !isArchitectureOpen) {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel-hover)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)';
            }
          }}
          onMouseLeave={e => {
            if (!isArchitectureOpen) {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
            }
          }}
        >
          <LayoutIcon />
        </button>

        {/* v2.2: NotebookLM wizard (2 clicks). Disabled when no graph is loaded. */}
        <button
          style={{
            ...styles.iconBtn,
            opacity: graph ? 1 : 0.4,
            cursor: graph ? 'pointer' : 'default',
          }}
          onClick={() => graph && setNbOpen(true)}
          disabled={!graph}
          title={graph ? 'Connect this folder to NotebookLM (2 clicks)' : 'Load a folder first'}
          onMouseEnter={e => {
            if (graph) {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel-hover)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)';
            }
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
          }}
        >
          <ExportIcon />
        </button>

      </div>

      {/* v2.2: NotebookLM setup wizard (2 clicks). */}
      {nbOpen && <NotebookLmWizard onClose={() => setNbOpen(false)} />}
    </div>
  );
};
