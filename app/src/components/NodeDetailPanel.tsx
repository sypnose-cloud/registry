import React, { useEffect, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import type { GraphNode } from '../types/graph';

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const FileIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M2 1h6l2 2v8H2V1z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
    <path d="M7 1v3h3" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
  </svg>
);

const ArrowRightIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M2 5h6M6 3l2 2-2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const ArrowLeftIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M8 5H2M4 3L2 5l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const ConnectionsIcon = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
    <circle cx="5.5" cy="5.5" r="1.5" fill="currentColor"/>
    <circle cx="1.5" cy="1.5" r="1" fill="currentColor" opacity="0.6"/>
    <circle cx="9.5" cy="1.5" r="1" fill="currentColor" opacity="0.6"/>
    <circle cx="1.5" cy="9.5" r="1" fill="currentColor" opacity="0.6"/>
    <circle cx="9.5" cy="9.5" r="1" fill="currentColor" opacity="0.6"/>
    <path d="M2.2 2.2L4.5 4.5M8.8 2.2L6.5 4.5M2.2 8.8L4.5 6.5M8.8 8.8L6.5 6.5" stroke="currentColor" strokeWidth="0.8" opacity="0.5"/>
  </svg>
);

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const LANGUAGE_COLORS: Record<string, string> = {
  typescript: '#2563eb',
  javascript: '#ca8a04',
  rust: '#dc2626',
  python: '#2563eb',
  go: '#0891b2',
  css: '#2563eb',
  html: '#ea580c',
  json: '#6b7280',
};

interface ConnectionItemProps {
  nodeId: string;
  edgeType: string;
  direction: 'in' | 'out';
  onSelect: (nodeId: string) => void;
}

const ConnectionItem: React.FC<ConnectionItemProps> = ({ nodeId, edgeType, direction, onSelect }) => {
  const { graph } = useAppStore();
  const node = (graph?.nodes ?? []).find(n => n.id === nodeId);
  const label = node?.label ?? nodeId.split('/').pop() ?? nodeId;
  const type = node?.type ?? 'file';
  const color = NODE_TYPE_COLORS[type] ?? '#8890a0';

  const [hovered, setHovered] = React.useState(false);

  return (
    <button
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '6px 8px',
        borderRadius: 'var(--radius-sm)',
        background: hovered ? 'var(--panel-hover)' : 'transparent',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.12s',
      }}
      onClick={() => onSelect(nodeId)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ color: direction === 'out' ? 'var(--text-dim)' : 'var(--text-dim)', flexShrink: 0 }}>
        {direction === 'out' ? <ArrowRightIcon /> : <ArrowLeftIcon />}
      </span>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: color, flexShrink: 0,
      }} />
      <span style={{
        fontSize: 12, color: 'var(--text)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
      }}>{label}</span>
      <span style={{
        fontSize: 9, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0,
      }}>{edgeType}</span>
    </button>
  );
};

interface MetaRowProps {
  label: string;
  value: React.ReactNode;
}

const MetaRow: React.FC<MetaRowProps> = ({ label, value }) => (
  <div style={{
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
    borderBottom: '1px solid var(--border)',
  }}>
    <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {label}
    </span>
    <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>
      {value}
    </span>
  </div>
);

export const NodeDetailPanel: React.FC = () => {
  const { selectedNode, selectedNodeId, setSelectedNode, setFocusNode, graph } = useAppStore();

  // Close on Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSelectedNode(null);
    }
  }, [setSelectedNode]);

  useEffect(() => {
    if (selectedNodeId) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, handleKeyDown]);

  if (!selectedNode || !selectedNodeId) return null;

  const node = selectedNode as GraphNode;
  const typeColor = NODE_TYPE_COLORS[node.type] ?? '#8890a0';
  const langColor = node.language ? LANGUAGE_COLORS[node.language] ?? '#8890a0' : null;

  // Find connected edges
  const outEdges = (graph?.edges ?? []).filter(e => e.source === selectedNodeId);
  const inEdges = (graph?.edges ?? []).filter(e => e.target === selectedNodeId);

  const handleSelectConnection = (nodeId: string) => {
    setSelectedNode(nodeId);
    setFocusNode(nodeId);
  };

  const styles: Record<string, React.CSSProperties> = {
    panel: {
      position: 'fixed',
      top: 48,
      right: 0,
      bottom: 28,
      width: 360,
      background: 'var(--panel)',
      borderLeft: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 150,
      animation: 'slideInRight 0.2s ease',
    },
    header: {
      padding: '16px 16px 12px',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
    },
    headerTop: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 8,
    },
    nodeLabel: {
      fontSize: 15,
      fontWeight: 600,
      color: 'var(--text)',
      lineHeight: 1.3,
      wordBreak: 'break-word',
      flex: 1,
    },
    closeBtn: {
      width: 24,
      height: 24,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--text-muted)',
      cursor: 'pointer',
      flexShrink: 0,
      transition: 'background 0.12s, color 0.12s',
    },
    badges: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flexWrap: 'wrap',
    },
    typeBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      borderRadius: 100,
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.04em',
      textTransform: 'uppercase' as const,
      background: `${typeColor}22`,
      color: typeColor,
    },
    langBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      borderRadius: 100,
      fontSize: 10,
      fontWeight: 500,
      background: 'var(--bg)',
      color: 'var(--text-muted)',
      border: '1px solid var(--border)',
    },
    langDot: {
      width: 6, height: 6, borderRadius: '50%',
      background: langColor ?? 'var(--text-dim)',
    },
    content: {
      flex: 1,
      overflowY: 'auto',
      padding: '0 16px 16px',
    },
    section: {
      marginTop: 16,
    },
    sectionLabel: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 10,
      fontWeight: 600,
      color: 'var(--text-muted)',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.06em',
      marginBottom: 8,
    },
    sectionCount: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 18,
      height: 16,
      padding: '0 4px',
      borderRadius: 100,
      background: 'var(--border)',
      color: 'var(--text-muted)',
      fontSize: 9,
      fontWeight: 600,
    },
    pathBox: {
      padding: '8px 10px',
      background: 'var(--bg)',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border)',
      fontSize: 11,
      color: 'var(--text-muted)',
      fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", monospace',
      wordBreak: 'break-all',
      lineHeight: 1.5,
    },
    metaGrid: {
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
    },
    communityBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '2px 8px',
      borderRadius: 100,
      fontSize: 11,
      color: 'var(--text)',
    },
    communityDot: {
      width: 8, height: 8, borderRadius: '50%',
    },
    connectionsList: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      maxHeight: 200,
      overflowY: 'auto',
    },
    emptyConnections: {
      fontSize: 11,
      color: 'var(--text-dim)',
      padding: '8px 8px',
      fontStyle: 'italic',
    },
  };

  // Community color
  const communityColors = [
    '#2563eb', '#16a34a', '#d97706', '#dc2626',
    '#9333ea', '#ea580c', '#0d9488', '#db2777',
    '#0284c7', '#65a30d',
  ];
  const communityColor = node.community != null && Number.isInteger(node.community)
    ? communityColors[node.community % communityColors.length] ?? '#8890a0'
    : '#8890a0';

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerTop}>
          <div style={styles.nodeLabel}>{node.label ?? '(unnamed)'}</div>
          <button
            style={styles.closeBtn}
            onClick={() => setSelectedNode(null)}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel-hover)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
            }}
            title="Close panel (Esc)"
          >
            <CloseIcon />
          </button>
        </div>

        <div style={styles.badges}>
          <span style={styles.typeBadge}>{node.type ?? 'unknown'}</span>
          {node.language && (
            <span style={styles.langBadge}>
              <span style={styles.langDot} />
              {node.language}
            </span>
          )}
          {node.exported === true && (
            <span style={{ ...styles.langBadge, color: 'var(--success)', borderColor: 'rgba(81,207,102,0.3)' }}>
              exported
            </span>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={styles.content}>

        {/* File path */}
        {node.path && (
          <div style={styles.section}>
            <div style={styles.sectionLabel}>
              <FileIcon />
              Path
            </div>
            <div style={styles.pathBox}>{node.path}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button
                style={{
                  height: 28,
                  padding: '0 10px',
                  fontSize: 12,
                  fontWeight: 500,
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  cursor: 'pointer',
                  background: '#2563eb',
                  color: '#fff',
                  transition: 'opacity 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                onClick={async () => {
                  try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    const projectPath = graph?.projectPath?.replace(/[\\/]$/, '') ?? '';
                    const fullPath = projectPath ? projectPath + '/' + node.path : node.path!;
                    await invoke('open_file_in_os', { path: fullPath.replace(/\//g, '\\') });
                  } catch (err) { console.error('[NodeDetailPanel] open_file_in_os failed:', err); }
                }}
                title="Open file"
              >
                Open
              </button>
              <button
                style={{
                  height: 28,
                  padding: '0 10px',
                  fontSize: 12,
                  fontWeight: 500,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: 'var(--bg)',
                  color: 'var(--text-muted)',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg)')}
                onClick={async () => {
                  try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    const projectPath = graph?.projectPath?.replace(/[\\/]$/, '') ?? '';
                    const fullPath = projectPath ? projectPath + '/' + node.path : node.path!;
                    await invoke('reveal_in_explorer', { path: fullPath.replace(/\//g, '\\') });
                  } catch (err) { console.error('[NodeDetailPanel] reveal_in_explorer failed:', err); }
                }}
                title="Reveal in Explorer"
              >
                Reveal
              </button>
            </div>
          </div>
        )}

        {/* Metadata */}
        <div style={styles.section}>
          <div style={styles.sectionLabel}>
            <ConnectionsIcon />
            Metadata
          </div>
          <div style={styles.metaGrid}>
            <MetaRow label="Type" value={<span style={{ color: typeColor, textTransform: 'capitalize' }}>{node.type ?? 'unknown'}</span>} />
            {node.language && <MetaRow label="Language" value={node.language} />}
            {node.lines != null && <MetaRow label={(node.id?.startsWith('dir:') ?? false) || (node.path && !node.language) ? 'Files' : 'Lines'} value={typeof node.lines === 'number' ? node.lines.toLocaleString() : String(node.lines)} />}
            {typeof (node as GraphNode & { size_bytes?: number }).size_bytes === 'number' && isFinite((node as GraphNode & { size_bytes?: number }).size_bytes!) && (
              <MetaRow label="Size" value={formatBytes((node as GraphNode & { size_bytes?: number }).size_bytes!)} />
            )}
            <MetaRow label="Connections" value={`${inEdges.length} in · ${outEdges.length} out`} />
            {(node.communityName != null || node.community != null) && (
              <MetaRow label="Community" value={
                <span style={styles.communityBadge}>
                  <span style={{ ...styles.communityDot, background: communityColor }} />
                  {node.communityName ?? `#${node.community}`}
                </span>
              } />
            )}
          </div>
        </div>

        {/* Connections Out */}
        <div style={styles.section}>
          <div style={styles.sectionLabel}>
            <ArrowRightIcon />
            Connections Out
            <span style={styles.sectionCount}>{outEdges.length}</span>
          </div>
          <div style={styles.connectionsList}>
            {outEdges.length === 0 ? (
              <span style={styles.emptyConnections}>No outgoing connections</span>
            ) : (
              outEdges.slice(0, 50).map((edge, idx) => (
                <ConnectionItem
                  key={edge.id != null ? edge.id : `out-${idx}`}
                  nodeId={edge.target}
                  edgeType={edge.type}
                  direction="out"
                  onSelect={handleSelectConnection}
                />
              ))
            )}
          </div>
        </div>

        {/* Connections In */}
        <div style={styles.section}>
          <div style={styles.sectionLabel}>
            <ArrowLeftIcon />
            Connections In
            <span style={styles.sectionCount}>{inEdges.length}</span>
          </div>
          <div style={styles.connectionsList}>
            {inEdges.length === 0 ? (
              <span style={styles.emptyConnections}>No incoming connections</span>
            ) : (
              inEdges.slice(0, 50).map((edge, idx) => (
                <ConnectionItem
                  key={edge.id != null ? edge.id : `in-${idx}`}
                  nodeId={edge.source}
                  edgeType={edge.type}
                  direction="in"
                  onSelect={handleSelectConnection}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
