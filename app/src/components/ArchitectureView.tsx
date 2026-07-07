import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAppStore } from '../stores/appStore';

/**
 * M8 — "¿Cómo estoy hecho?" Architecture View.
 *
 * Reads architecture.json from graphify-out/<project> via get_architecture(path).
 * If null, calls build_static_architecture(path, graphJson) to generate it (no LLM).
 * "Generar descripciones con IA" calls enrich_architecture(path, graphJson) — requires
 * API key or proxy configured in chat settings; on NO_API_KEY surfaces a clear message.
 *
 * File chips → setSelectedNode + setFocusNode (same pattern as ChatPanel citations).
 * Historical mode: shows a banner — v1 always shows current architecture.json (v-next).
 *
 * Theme: all light — #ffffff / #f8fafc / #e5e7eb / #111827 / #6b7280 / #2563eb.
 * ZERO dark backgrounds. Community colors only for left-border accents.
 */

// ── architecture.json contract ──────────────────────────────────────────────

interface ArchFile {
  path: string;
  node_id: string;
}

interface ArchLink {
  to: string;
  label: string;
}

interface ArchComponent {
  id: string;
  name: string;
  kind: 'hub' | 'entry' | 'manifest' | 'module';
  summary: string;
  description?: string | null;
  badges?: string[];
  files?: ArchFile[];
  links?: ArchLink[];
}

interface ArchGroup {
  id: string;
  title: string;
  color: string;
  summary: string;
  components: ArchComponent[];
}

interface ArchConnection {
  from: string;
  to: string;
  label: string;
}

interface Architecture {
  version: number;
  generated_at: string;
  source: 'static' | 'enriched';
  project_name: string;
  groups: ArchGroup[];
  connections?: ArchConnection[];
}

// ── helpers ──────────────────────────────────────────────────────────────────

function kindIcon(kind: ArchComponent['kind']): string {
  switch (kind) {
    case 'hub': return '⬡';
    case 'entry': return '▶';
    case 'manifest': return '📄';
    case 'module': return '◻';
    default: return '◻';
  }
}

// ── styles (light only) ──────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 400,
    background: 'rgba(255,255,255,0.6)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    flexDirection: 'column',
    animation: 'fadeIn 0.18s ease',
    overflow: 'hidden',
  },
  panel: {
    position: 'absolute',
    top: 48,           // below toolbar
    right: 0,
    bottom: 28,        // above statusbar
    left: 0,
    background: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    height: 52,
    borderBottom: '1px solid #e5e7eb',
    display: 'flex',
    alignItems: 'center',
    padding: '0 20px',
    gap: 12,
    flexShrink: 0,
    background: '#ffffff',
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: '#111827',
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  projectBadge: {
    fontSize: 11,
    fontWeight: 600,
    color: '#2563eb',
    background: 'rgba(37,99,235,0.1)',
    padding: '2px 8px',
    borderRadius: 100,
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  btn: {
    height: 30,
    padding: '0 12px',
    borderRadius: 6,
    border: '1px solid #e5e7eb',
    background: '#f8fafc',
    color: '#374151',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
  },
  btnAccent: {
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
  },
  btnDisabled: {
    opacity: 0.45,
    cursor: 'default',
  },
  closeBtn: {
    width: 30,
    height: 30,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    border: 'none',
    background: 'transparent',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: 16,
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 32,
  },
  // Loading / empty
  stateBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 12,
    color: '#6b7280',
    fontSize: 14,
  },
  stateIcon: {
    fontSize: 32,
    opacity: 0.4,
  },
  errorBox: {
    background: 'rgba(220,38,38,0.06)',
    border: '1px solid rgba(220,38,38,0.2)',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    color: '#dc2626',
    margin: '8px 0',
  },
  // Historical banner
  historicalBanner: {
    background: 'rgba(217,119,6,0.08)',
    border: '1px solid rgba(217,119,6,0.3)',
    borderRadius: 8,
    padding: '8px 14px',
    fontSize: 12,
    color: '#92400e',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  // Section label
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    color: '#9ca3af',
    marginBottom: 12,
  },
  // Group box
  groupBox: {
    borderRadius: 10,
    border: '1px solid #e5e7eb',
    borderLeft: '4px solid #2563eb', // overridden inline with community color
    background: '#f8fafc',
    padding: '14px 16px',
    marginBottom: 12,
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  groupColorDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
    marginTop: 4,
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: '#111827',
  },
  groupSummary: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
    lineHeight: 1.5,
  },
  // Mini-components inside group
  compRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
    marginTop: 10,
  },
  compChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid #e5e7eb',
    background: '#ffffff',
    fontSize: 12,
    color: '#374151',
    cursor: 'default',
  },
  compKindIcon: {
    fontSize: 11,
    color: '#9ca3af',
  },
  badge: {
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 10,
    background: 'rgba(37,99,235,0.08)',
    color: '#2563eb',
    fontWeight: 500,
  },
  // Connections between groups
  connectionsList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  connectionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: '#6b7280',
  },
  connectionLabel: {
    fontSize: 11,
    color: '#9ca3af',
    fontStyle: 'italic',
    minWidth: 60,
    textAlign: 'center' as const,
  },
  connectionArrow: {
    color: '#d1d5db',
    fontSize: 14,
  },
  connectionFrom: {
    fontWeight: 600,
    color: '#374151',
  },
  connectionTo: {
    fontWeight: 600,
    color: '#374151',
  },
  // Component cards grid
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 12,
  },
  card: {
    borderRadius: 10,
    border: '1px solid #e5e7eb',
    background: '#f8fafc',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  cardName: {
    fontSize: 13,
    fontWeight: 700,
    color: '#111827',
    flex: 1,
  },
  cardKind: {
    fontSize: 10,
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  cardSummary: {
    fontSize: 12,
    color: '#4b5563',
    lineHeight: 1.55,
  },
  cardDescription: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 1.55,
    fontStyle: 'italic',
  },
  badgeRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 4,
  },
  fileChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    padding: '2px 7px',
    borderRadius: 4,
    background: 'rgba(37,99,235,0.07)',
    color: '#2563eb',
    border: 'none',
    fontSize: 11,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  sourceTag: {
    fontSize: 10,
    padding: '2px 7px',
    borderRadius: 10,
    fontWeight: 600,
  },
};

// ── main component ────────────────────────────────────────────────────────────

export const ArchitectureView: React.FC = () => {
  const {
    isArchitectureOpen,
    toggleArchitecture,
    graph,
    projectPath,
    viewMode,
    setSelectedNode,
    setFocusNode,
  } = useAppStore();

  const [arch, setArch] = useState<Architecture | null>(null);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // ── load or generate architecture when opened ──────────────────────────────
  const loadArchitecture = useCallback(async () => {
    if (!isArchitectureOpen || !graph || !projectPath) return;
    setLoading(true);
    setError(null);

    try {
      let invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
      try {
        const mod = await import('@tauri-apps/api/core');
        invoke = mod.invoke as typeof invoke;
      } catch {
        // Browser mode — show placeholder
        if (isMountedRef.current) {
          setArch(null);
          setError('Running in browser mode — Tauri commands unavailable. Open in the desktop app.');
          setLoading(false);
        }
        return;
      }

      // Try to read existing architecture.json
      let raw: string | null = null;
      try {
        raw = await invoke<string | null>('get_architecture', { path: projectPath });
      } catch {
        raw = null;
      }

      if (!raw) {
        // Generate static architecture (no LLM)
        try {
          const graphJson = JSON.stringify(graph);
          raw = await invoke<string>('build_static_architecture', { path: projectPath, graphJson });
        } catch (buildErr) {
          if (isMountedRef.current) {
            setError(`Could not generate architecture: ${buildErr}`);
            setLoading(false);
          }
          return;
        }
      }

      if (isMountedRef.current) {
        try {
          setArch(JSON.parse(raw) as Architecture);
        } catch {
          setError('Architecture file is malformed.');
        }
        setLoading(false);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(`Unexpected error: ${err}`);
        setLoading(false);
      }
    }
  }, [isArchitectureOpen, graph, projectPath]);

  useEffect(() => {
    if (isArchitectureOpen) {
      void loadArchitecture();
    } else {
      // Reset when closed so next open starts fresh
      setArch(null);
      setError(null);
      setEnrichError(null);
    }
  }, [isArchitectureOpen, loadArchitecture]);

  // ── keyboard handler (Esc closes) ─────────────────────────────────────────
  useEffect(() => {
    if (!isArchitectureOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleArchitecture();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isArchitectureOpen, toggleArchitecture]);

  if (!isArchitectureOpen) return null;

  // ── handlers ──────────────────────────────────────────────────────────────

  const handleRefresh = async () => {
    if (!graph || !projectPath) return;
    setLoading(true);
    setError(null);
    setEnrichError(null);
    setArch(null);
    try {
      let invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
      try {
        const mod = await import('@tauri-apps/api/core');
        invoke = mod.invoke as typeof invoke;
      } catch {
        setError('Running in browser mode — Tauri unavailable.');
        setLoading(false);
        return;
      }
      const graphJson = JSON.stringify(graph);
      const raw = await invoke<string>('build_static_architecture', { path: projectPath, graphJson });
      if (isMountedRef.current) {
        setArch(JSON.parse(raw) as Architecture);
        setLoading(false);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(`Rebuild failed: ${err}`);
        setLoading(false);
      }
    }
  };

  const handleEnrich = async () => {
    if (!graph || !projectPath || enriching) return;
    setEnriching(true);
    setEnrichError(null);
    try {
      let invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
      try {
        const mod = await import('@tauri-apps/api/core');
        invoke = mod.invoke as typeof invoke;
      } catch {
        setEnrichError('Running in browser mode — Tauri unavailable.');
        setEnriching(false);
        return;
      }
      const graphJson = JSON.stringify(graph);
      const raw = await invoke<string>('enrich_architecture', { path: projectPath, graphJson });
      if (isMountedRef.current) {
        setArch(JSON.parse(raw) as Architecture);
        setEnriching(false);
      }
    } catch (err) {
      const msg = String(err);
      if (isMountedRef.current) {
        if (msg.includes('NO_API_KEY')) {
          setEnrichError('No API key configured. Open the chat panel (💬) and configure your API key or proxy in Settings (⚙).');
        } else {
          setEnrichError(`Enrichment failed: ${msg}`);
        }
        setEnriching(false);
      }
    }
  };

  const handleFileChipClick = (nodeId: string) => {
    setSelectedNode(nodeId);
    setFocusNode(nodeId);
    toggleArchitecture();
  };

  // ── render ────────────────────────────────────────────────────────────────

  const projectName = arch?.project_name ?? graph?.projectName ?? projectPath?.split(/[\\/]/).filter(Boolean).pop() ?? 'Project';

  return (
    <div style={S.overlay}>
      <div style={S.panel}>
        {/* Header */}
        <div style={S.header}>
          <div style={S.headerTitle}>
            <span style={{ fontSize: 18 }}>⬡</span>
            <span>¿Cómo estoy hecho?</span>
            <span style={S.projectBadge}>{projectName}</span>
            {arch && (
              <span style={{
                ...S.sourceTag,
                background: arch.source === 'enriched' ? 'rgba(22,163,74,0.1)' : 'rgba(107,114,128,0.1)',
                color: arch.source === 'enriched' ? '#16a34a' : '#6b7280',
              }}>
                {arch.source === 'enriched' ? 'IA enriched' : 'static'}
              </span>
            )}
          </div>
          <div style={S.headerActions}>
            <button
              style={{ ...S.btn, ...(loading || !graph ? S.btnDisabled : {}) }}
              onClick={handleRefresh}
              disabled={loading || !graph}
              title="Rebuild static architecture (no LLM)"
            >
              ↺ Actualizar
            </button>
            <button
              style={{ ...S.btn, ...S.btnAccent, ...(enriching || !graph ? S.btnDisabled : {}) }}
              onClick={handleEnrich}
              disabled={enriching || !graph}
              title="Enrich with AI summaries — requires API key or proxy"
            >
              {enriching ? '⏳ Generando…' : '✦ Generar descripciones con IA'}
            </button>
            <button
              style={S.closeBtn}
              onClick={toggleArchitecture}
              title="Cerrar (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={S.body}>
          {/* Historical mode banner */}
          {viewMode === 'historical' && (
            <div style={S.historicalBanner}>
              <span>⚠</span>
              <span>Estás viendo el grafo histórico — la arquitectura mostrada refleja el <strong>estado actual</strong> del proyecto (v1 no reconstruye el pasado).</span>
            </div>
          )}

          {/* Enrich error */}
          {enrichError && (
            <div style={S.errorBox}>{enrichError}</div>
          )}

          {/* Loading state */}
          {loading && (
            <div style={S.stateBox}>
              <span style={S.stateIcon}>⬡</span>
              <span>Analizando arquitectura…</span>
              <span style={{ fontSize: 12, color: '#9ca3af' }}>Construyendo mapa estático sin LLM</span>
            </div>
          )}

          {/* General error */}
          {!loading && error && (
            <div style={S.stateBox}>
              <span style={{ ...S.stateIcon, fontSize: 28 }}>⚠</span>
              <div style={{ ...S.errorBox, alignSelf: 'stretch' }}>{error}</div>
            </div>
          )}

          {/* Empty state (no arch and no error) */}
          {!loading && !error && !arch && (
            <div style={S.stateBox}>
              <span style={S.stateIcon}>◻</span>
              <span>No hay datos de arquitectura todavía.</span>
            </div>
          )}

          {/* Architecture content */}
          {!loading && !error && arch && (
            <>
              {/* SECTION: Arquitectura — group boxes */}
              <div>
                <div style={S.sectionLabel}>Arquitectura</div>
                {arch.groups.map(group => (
                  <div
                    key={group.id}
                    style={{ ...S.groupBox, borderLeft: `4px solid ${group.color}` }}
                  >
                    <div style={S.groupHeader}>
                      <div style={{ ...S.groupColorDot, background: group.color }} />
                      <div style={{ flex: 1 }}>
                        <div style={S.groupTitle}>{group.title}</div>
                        {group.summary && (
                          <div style={S.groupSummary}>{group.summary}</div>
                        )}
                      </div>
                    </div>
                    {/* Mini component chips inside group */}
                    {group.components.length > 0 && (
                      <div style={S.compRow}>
                        {group.components.map(comp => (
                          <div key={comp.id} style={S.compChip}>
                            <span style={S.compKindIcon}>{kindIcon(comp.kind)}</span>
                            <span>{comp.name}</span>
                            {comp.badges && comp.badges.slice(0, 1).map((b, i) => (
                              <span key={i} style={S.badge}>{b}</span>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {/* Connections between groups */}
                {arch.connections && arch.connections.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ ...S.sectionLabel, fontSize: 10 }}>Conexiones entre grupos</div>
                    <div style={S.connectionsList}>
                      {arch.connections.map((conn, i) => (
                        <div key={i} style={S.connectionRow}>
                          <span style={S.connectionFrom}>{conn.from}</span>
                          <span style={S.connectionArrow}>→</span>
                          <span style={S.connectionLabel}>{conn.label}</span>
                          <span style={S.connectionArrow}>→</span>
                          <span style={S.connectionTo}>{conn.to}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION: Componentes — cards grid */}
              <div>
                <div style={S.sectionLabel}>Componentes</div>
                <div style={S.cardGrid}>
                  {arch.groups.flatMap(g => g.components).map(comp => (
                    <div key={comp.id} style={S.card}>
                      <div style={S.cardHeader}>
                        <span style={{ fontSize: 14 }}>{kindIcon(comp.kind)}</span>
                        <span style={S.cardName}>{comp.name}</span>
                        <span style={S.cardKind}>{comp.kind}</span>
                      </div>

                      {comp.summary && (
                        <div style={S.cardSummary}>{comp.summary}</div>
                      )}

                      {comp.description && (
                        <div style={S.cardDescription}>{comp.description}</div>
                      )}

                      {comp.badges && comp.badges.length > 0 && (
                        <div style={S.badgeRow}>
                          {comp.badges.map((b, i) => (
                            <span key={i} style={S.badge}>{b}</span>
                          ))}
                        </div>
                      )}

                      {comp.files && comp.files.length > 0 && (
                        <div style={S.badgeRow}>
                          {comp.files.map((f, i) => (
                            <button
                              key={i}
                              style={S.fileChip}
                              title={`Focus node: ${f.node_id}`}
                              onClick={() => handleFileChipClick(f.node_id)}
                              onMouseEnter={e => {
                                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(37,99,235,0.15)';
                              }}
                              onMouseLeave={e => {
                                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(37,99,235,0.07)';
                              }}
                            >
                              📄 {f.path.split(/[\\/]/).pop() ?? f.path}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Generated at footer */}
              <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', paddingBottom: 8 }}>
                Generado: {new Date(arch.generated_at).toLocaleString()}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
