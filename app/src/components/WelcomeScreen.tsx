import React, { useEffect, useState } from 'react';

interface RecentProject {
  path: string;
  name: string;
  last_opened: string;
  file_count: number | null;
}

interface WelcomeScreenProps {
  onOpenFolder: () => void;
  onSelectProject: (path: string) => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onOpenFolder, onSelectProject }) => {
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [aiConnected, setAiConnected] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const projects = await invoke<RecentProject[]>('get_recent_projects');
        setRecents(projects ?? []);
      } catch {
        // Not running in Tauri — ignore
      }
    })();
  }, []);

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

  const copyUrl = () => {
    navigator.clipboard.writeText('http://localhost:44444').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const styles: Record<string, React.CSSProperties> = {
    container: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f5f6f8',
      gap: 28,
    },
    logo: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 12,
    },
    logoIcon: {
      width: 64,
      height: 64,
      borderRadius: 16,
      background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 28,
    },
    title: {
      fontSize: 24,
      fontWeight: 700,
      color: '#1a1d23',
      letterSpacing: '-0.02em',
    },
    subtitle: {
      fontSize: 13,
      color: '#6b7280',
      maxWidth: 360,
      textAlign: 'center' as const,
      lineHeight: 1.5,
    },
    openBtn: {
      padding: '12px 32px',
      borderRadius: 8,
      background: '#2563eb',
      color: '#fff',
      fontSize: 14,
      fontWeight: 600,
      border: 'none',
      cursor: 'pointer',
      transition: 'background 0.15s',
    },
    recentsSection: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      width: 360,
    },
    recentsLabel: {
      fontSize: 11,
      fontWeight: 600,
      color: '#6b7280',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.05em',
      marginBottom: 4,
    },
    recentItem: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 12px',
      borderRadius: 6,
      cursor: 'pointer',
      transition: 'background 0.15s',
      background: 'transparent',
      border: 'none',
      width: '100%',
      textAlign: 'left' as const,
    },
    recentDot: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: '#2563eb',
      flexShrink: 0,
    },
    recentName: {
      fontSize: 13,
      fontWeight: 500,
      color: '#1a1d23',
    },
    recentPath: {
      fontSize: 11,
      color: '#6b7280',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap' as const,
    },
    hint: {
      fontSize: 11,
      color: '#4b5563',
      marginTop: 4,
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.logo}>
        <div style={styles.logoIcon}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" />
            <circle cx="5" cy="6" r="2" />
            <circle cx="19" cy="6" r="2" />
            <circle cx="5" cy="18" r="2" />
            <circle cx="19" cy="18" r="2" />
            <line x1="9.5" y1="10.5" x2="6.5" y2="7.5" />
            <line x1="14.5" y1="10.5" x2="17.5" y2="7.5" />
            <line x1="9.5" y1="13.5" x2="6.5" y2="16.5" />
            <line x1="14.5" y1="13.5" x2="17.5" y2="16.5" />
          </svg>
        </div>
        <div style={styles.title}>Registry</div>
        <div style={styles.subtitle}>
          Where humans and AI meet to explore code together.
        </div>
      </div>

      <button
        style={styles.openBtn}
        onClick={onOpenFolder}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#1d4ed8'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#2563eb'; }}
      >
        Open Folder
      </button>

      {recents.length > 0 && (
        <div style={styles.recentsSection}>
          <div style={styles.recentsLabel}>Recent Projects</div>
          {recents.slice(0, 5).map((p, index) => (
            <button
              key={p.path ?? String(index)}
              style={styles.recentItem}
              onClick={() => p.path != null && onSelectProject(p.path)}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#e8eaee'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <div style={styles.recentDot} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.recentName}>{p.name ?? '(unnamed)'}</div>
                <div style={styles.recentPath}>{p.path ?? '(path unavailable)'}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* AI Bridge Connection Panel */}
      <div style={{
        width: 360,
        padding: '16px 20px',
        borderRadius: 12,
        background: aiConnected ? 'linear-gradient(135deg, rgba(22,163,106,0.08) 0%, rgba(37,99,235,0.06) 100%)' : '#ffffff',
        border: `1px solid ${aiConnected ? 'rgba(22,163,106,0.25)' : '#e5e7eb'}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        transition: 'all 0.3s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: aiConnected ? 'linear-gradient(135deg, #16a34a, #2563eb)' : 'linear-gradient(135deg, #6b7280, #9ca3af)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.3s',
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2L3 5.5v5L8 14l5-3.5v-5L8 2z" stroke="white" strokeWidth="1.2" strokeLinejoin="round"/>
              <circle cx="8" cy="8" r="2" fill="white"/>
              <line x1="8" y1="2" x2="8" y2="0.5" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
              <line x1="13" y1="5.5" x2="14.3" y2="4.8" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
              <line x1="13" y1="10.5" x2="14.3" y2="11.2" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
              <line x1="3" y1="5.5" x2="1.7" y2="4.8" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
              <line x1="3" y1="10.5" x2="1.7" y2="11.2" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1d23', display: 'flex', alignItems: 'center', gap: 6 }}>
              AI Bridge
              <span style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: aiConnected ? '#16a34a' : '#d1d5db',
                boxShadow: aiConnected ? '0 0 8px rgba(22,163,106,0.6)' : 'none',
                display: 'inline-block',
                transition: 'all 0.3s',
              }} />
              <span style={{
                fontSize: 10,
                fontWeight: 500,
                color: aiConnected ? '#16a34a' : '#9ca3af',
                transition: 'color 0.3s',
              }}>
                {aiConnected ? 'Connected' : 'Listening'}
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
              Any AI agent can connect to explore your graph
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderRadius: 8,
          background: '#f3f4f6',
          border: '1px solid #e5e7eb',
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}
          onClick={copyUrl}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#e8eaee'; (e.currentTarget as HTMLDivElement).style.borderColor = '#d1d5db'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = '#f3f4f6'; (e.currentTarget as HTMLDivElement).style.borderColor = '#e5e7eb'; }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="7" cy="7" r="2" fill="#2563eb"/>
            <circle cx="7" cy="7" r="5.5" stroke="#2563eb" strokeWidth="1" strokeDasharray="2 2" opacity="0.4"/>
          </svg>
          <code style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            color: '#2563eb',
            fontFamily: 'monospace',
            letterSpacing: '0.02em',
          }}>
            http://localhost:44444
          </code>
          <span style={{
            fontSize: 10,
            color: copied ? '#16a34a' : '#9ca3af',
            fontWeight: 500,
            transition: 'color 0.2s',
            flexShrink: 0,
          }}>
            {copied ? 'Copied!' : 'Click to copy'}
          </span>
        </div>

        <div style={{ fontSize: 10, color: '#9ca3af', lineHeight: 1.5 }}>
          Endpoints: <span style={{ color: '#6b7280' }}>/status</span>{' '}
          <span style={{ color: '#d1d5db' }}>|</span>{' '}
          <span style={{ color: '#6b7280' }}>/graph</span>{' '}
          <span style={{ color: '#d1d5db' }}>|</span>{' '}
          <span style={{ color: '#6b7280' }}>/search?q=</span>{' '}
          <span style={{ color: '#d1d5db' }}>|</span>{' '}
          <span style={{ color: '#6b7280' }}>/architecture</span>{' '}
          <span style={{ color: '#d1d5db' }}>|</span>{' '}
          <span style={{ color: '#6b7280' }}>/highlight</span>
        </div>
      </div>

      <div style={styles.hint}>
        Works with code, documents, data, images, configs, and more
      </div>
    </div>
  );
};
