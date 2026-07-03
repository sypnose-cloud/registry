import React, { useState, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';

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
  const { toggleSearch, toggleFilter, isFilterOpen, toggleChat, isChatOpen, graph, projectPath } = useAppStore();

  // M5: one-shot export state (no persistent panel — transient feedback only).
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string; path?: string } | null>(null);

  const handleExport = useCallback(async () => {
    if (exporting || !graph) return;
    setExporting(true);
    setExportMsg(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // Send the currently-visible graph (live or historical snapshot), same as chat.
      const graphJson = JSON.stringify(graph);
      const path = projectPath ?? graph.projectPath ?? '';
      const written = await invoke<string>('export_digest', { path, graphJson });
      setExportMsg({ ok: true, text: 'Digest exported', path: written });
    } catch (err) {
      setExportMsg({ ok: false, text: `Export failed: ${String(err)}` });
    } finally {
      setExporting(false);
    }
  }, [exporting, graph, projectPath]);

  const revealDigest = useCallback(async (p: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('reveal_in_explorer', { path: p });
    } catch {
      /* best-effort; ignore */
    }
  }, []);

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

        {/* M5: Export digest (one-shot). Disabled when no graph is loaded. */}
        <button
          style={{
            ...styles.iconBtn,
            ...(exporting ? styles.iconBtnActive : {}),
            opacity: graph ? 1 : 0.4,
            cursor: graph ? 'pointer' : 'default',
          }}
          onClick={handleExport}
          disabled={!graph || exporting}
          title={graph ? 'Export digest (Markdown for NotebookLM / Drive)' : 'Load a folder first'}
          onMouseEnter={e => {
            if (graph && !exporting) {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel-hover)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)';
            }
          }}
          onMouseLeave={e => {
            if (!exporting) {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
            }
          }}
        >
          <ExportIcon />
        </button>

      </div>

      {/* M5: transient export result toast (path + reveal), auto-shown after export. */}
      {exportMsg && (
        <div style={styles.toast}>
          <span style={{ color: exportMsg.ok ? 'var(--accent)' : 'var(--danger, #e5484d)' }}>
            {exportMsg.ok ? '✓' : '✕'}
          </span>
          <span style={styles.toastText} title={exportMsg.path ?? exportMsg.text}>
            {exportMsg.ok && exportMsg.path ? exportMsg.path : exportMsg.text}
          </span>
          {exportMsg.ok && exportMsg.path && (
            <button
              style={styles.toastBtn}
              onClick={() => revealDigest(exportMsg.path!)}
              title="Reveal in file explorer"
            >
              Reveal
            </button>
          )}
          <button style={styles.toastBtn} onClick={() => setExportMsg(null)} title="Dismiss">
            ✕
          </button>
        </div>
      )}
    </div>
  );
};
