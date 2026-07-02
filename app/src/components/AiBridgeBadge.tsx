import React, { useState, useEffect } from 'react';

export const AiBridgeBadge: React.FC = () => {
  const [aiConnected, setAiConnected] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [highlightCount, setHighlightCount] = useState(0);

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const status = await invoke<{ connected: boolean; highlight_count: number }>('get_ai_status');
        if (active) {
          setAiConnected(status.connected);
          setHighlightCount(status.highlight_count);
        }
      } catch {
        if (active) setAiConnected(false);
      }
    };
    check();
    const interval = setInterval(check, 3000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  const copyUrl = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText('http://localhost:44444').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: 36,
      left: 12,
      zIndex: 150,
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
    }}>
      {expanded && (
        <div style={{
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: '10px 10px 0 0',
          padding: '12px 14px',
          width: 260,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          borderBottom: 'none',
          boxShadow: '0 -4px 16px rgba(0,0,0,0.08)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', letterSpacing: '0.03em' }}>
            AI BRIDGE
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Connect any AI agent to explore this graph via REST API.
          </div>

          <div
            onClick={copyUrl}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              borderRadius: 6,
              background: 'var(--panel-hover, #f3f4f6)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <code style={{
              flex: 1,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--accent, #2563eb)',
              fontFamily: 'monospace',
            }}>
              localhost:44444
            </code>
            <span style={{
              fontSize: 9,
              color: copied ? '#16a34a' : 'var(--text-dim)',
              fontWeight: 500,
            }}>
              {copied ? 'Copied!' : 'Copy'}
            </span>
          </div>

          <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            <div><span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>GET /</span> &mdash; all endpoints</div>
            <div><span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>GET /graph</span> &mdash; full graph</div>
            <div><span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>GET /search?q=</span> &mdash; find nodes</div>
            <div><span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>POST /highlight</span> &mdash; mark nodes</div>
          </div>

          {highlightCount > 0 && (
            <div style={{
              fontSize: 10,
              color: '#f59e0b',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f59e0b' }} />
              {highlightCount} node{highlightCount !== 1 ? 's' : ''} highlighted by AI
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          borderRadius: expanded ? '0 0 8px 8px' : 8,
          background: aiConnected ? 'rgba(22, 163, 106, 0.12)' : 'var(--panel)',
          border: `1px solid ${aiConnected ? 'rgba(22, 163, 106, 0.3)' : 'var(--border)'}`,
          cursor: 'pointer',
          fontSize: 10,
          fontWeight: 500,
          color: aiConnected ? '#16a34a' : 'var(--text-dim)',
          transition: 'all 0.2s',
          boxShadow: expanded ? 'none' : '0 2px 8px rgba(0,0,0,0.06)',
          width: expanded ? 262 : 'auto',
        }}
      >
        <span style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: aiConnected ? '#16a34a' : 'var(--text-dim)',
          boxShadow: aiConnected ? '0 0 6px rgba(22,163,106,0.5)' : 'none',
          flexShrink: 0,
          transition: 'all 0.3s',
        }} />
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
          <path d="M6 1L2 4v4l4 3 4-3V4L6 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
          <circle cx="6" cy="6" r="1.5" fill="currentColor"/>
        </svg>
        <span>{aiConnected ? 'AI Connected' : 'AI Bridge :44444'}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ marginLeft: 'auto', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <path d="M1 3l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
};
