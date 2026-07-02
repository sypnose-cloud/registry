import React, { useState, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';

const NodeCountIcon = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
    <circle cx="5.5" cy="5.5" r="2.5" fill="var(--accent)" opacity="0.7"/>
    <circle cx="1.5" cy="1.5" r="1.5" fill="var(--text-dim)"/>
    <circle cx="9.5" cy="9.5" r="1.5" fill="var(--text-dim)"/>
    <circle cx="9.5" cy="1.5" r="1.5" fill="var(--text-dim)"/>
  </svg>
);

const EdgeCountIcon = () => (
  <svg width="12" height="11" viewBox="0 0 12 11" fill="none">
    <path d="M1 5.5h10M7 2l4 3.5L7 9" stroke="var(--text-dim)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const CommunityIcon = () => (
  <svg width="12" height="11" viewBox="0 0 12 11" fill="none">
    <circle cx="3" cy="5.5" r="2.5" stroke="var(--community-0)" strokeWidth="1.2"/>
    <circle cx="9" cy="5.5" r="2.5" stroke="var(--community-1)" strokeWidth="1.2"/>
    <path d="M5 5.5h2" stroke="var(--text-dim)" strokeWidth="1.2"/>
  </svg>
);

const FitIcon = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
    <path d="M1 4V1h3M7 1h3v3M10 7v3H7M4 10H1V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const AiIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M6 1L2 4v4l4 3 4-3V4L6 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <circle cx="6" cy="6" r="1.5" fill="currentColor"/>
  </svg>
);

export const StatusBar: React.FC = () => {
  const { stats, requestFit } = useAppStore();
  const [aiConnected, setAiConnected] = useState(false);
  // M2: live watcher indicator — polls the backend for the watched path.
  const [liveWatching, setLiveWatching] = useState(false);

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const status = await invoke<{ connected: boolean }>('get_ai_status');
        if (active) setAiConnected(status.connected);
      } catch {
        if (active) setAiConnected(false);
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  // M2: poll the watched_path command every 2s to show live status.
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const path = await invoke<string | null>('watched_path');
        if (active) setLiveWatching(path != null);
      } catch {
        if (active) setLiveWatching(false);
      }
    };
    check();
    const interval = setInterval(check, 2000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  const zoomPercent = stats.zoom > 0 ? Math.round((1 / stats.zoom) * 100) : 100;

  const styles: Record<string, React.CSSProperties> = {
    statusBar: {
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      height: 28,
      background: 'var(--panel)',
      borderTop: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 12px',
      zIndex: 200,
      fontSize: 11,
      color: 'var(--text-muted)',
    },
    left: {
      display: 'flex',
      alignItems: 'center',
      gap: 14,
    },
    right: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    },
    statItem: {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
    },
    statValue: {
      color: 'var(--text)',
      fontWeight: 500,
      fontVariantNumeric: 'tabular-nums',
    },
    separator: {
      width: 1,
      height: 12,
      background: 'var(--border)',
    },
    fitBtn: {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 6px',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border)',
      background: 'transparent',
      color: 'var(--text-muted)',
      fontSize: 10,
      cursor: 'pointer',
      transition: 'background 0.12s, color 0.12s, border-color 0.12s',
    },
    zoomDisplay: {
      fontVariantNumeric: 'tabular-nums',
      minWidth: 36,
      textAlign: 'right',
    },
  };

  return (
    <div style={styles.statusBar}>
      {/* Left: Graph stats */}
      <div style={styles.left}>
        <div style={styles.statItem}>
          <NodeCountIcon />
          <span style={styles.statValue}>{(stats.nodeCount ?? 0).toLocaleString()}</span>
          <span>nodes</span>
        </div>

        <div style={styles.separator} />

        <div style={styles.statItem}>
          <EdgeCountIcon />
          <span style={styles.statValue}>{(stats.edgeCount ?? 0).toLocaleString()}</span>
          <span>edges</span>
        </div>

        <div style={styles.separator} />

        <div style={styles.statItem}>
          <CommunityIcon />
          <span style={styles.statValue}>{stats.communityCount ?? 0}</span>
          <span>{(stats.communityCount ?? 0) === 1 ? 'community' : 'communities'}</span>
        </div>
      </div>

      {/* Center: Live watcher + AI Bridge status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* M2: Live indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '2px 8px',
          borderRadius: 'var(--radius-sm)',
          background: liveWatching ? 'rgba(220, 38, 38, 0.1)' : 'transparent',
          border: `1px solid ${liveWatching ? 'rgba(220, 38, 38, 0.3)' : 'var(--border)'}`,
          color: liveWatching ? '#dc2626' : 'var(--text-dim)',
          fontSize: 10,
          fontWeight: 600,
          transition: 'all 0.3s',
        }}>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: liveWatching ? '#dc2626' : 'var(--text-dim)',
            boxShadow: liveWatching ? '0 0 5px rgba(220, 38, 38, 0.6)' : 'none',
            animation: liveWatching ? 'livePulse 1.8s ease-in-out infinite' : 'none',
            transition: 'all 0.3s',
          }} />
          <span>{liveWatching ? 'Live' : 'Live off'}</span>
        </div>

        {/* AI Bridge status */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 10px',
          borderRadius: 'var(--radius-sm)',
          background: aiConnected ? 'rgba(22, 163, 106, 0.1)' : 'transparent',
          border: `1px solid ${aiConnected ? 'rgba(22, 163, 106, 0.3)' : 'var(--border)'}`,
          color: aiConnected ? '#16a34a' : 'var(--text-dim)',
          fontSize: 10,
          fontWeight: 500,
          transition: 'all 0.3s',
        }}>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: aiConnected ? '#16a34a' : 'var(--text-dim)',
            boxShadow: aiConnected ? '0 0 6px rgba(22, 163, 106, 0.5)' : 'none',
            transition: 'all 0.3s',
          }} />
          <AiIcon />
          <span>{aiConnected ? 'AI Connected' : 'AI Bridge :44444'}</span>
        </div>
      </div>

      {/* Right: Zoom + Fit */}
      <div style={styles.right}>
        <span style={styles.zoomDisplay}>{zoomPercent}%</span>

        <div style={styles.separator} />

        <button
          style={styles.fitBtn}
          title="Fit graph to view"
          onClick={requestFit}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.background = 'var(--panel-hover)';
            el.style.color = 'var(--text)';
            el.style.borderColor = 'var(--border-light)';
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.background = 'transparent';
            el.style.color = 'var(--text-muted)';
            el.style.borderColor = 'var(--border)';
          }}
        >
          <FitIcon />
          <span>Fit</span>
        </button>
      </div>
    </div>
  );
};
