import React from 'react';
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
  const { toggleSearch, toggleFilter, isFilterOpen } = useAppStore();

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

      </div>
    </div>
  );
};
