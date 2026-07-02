import React, { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { adaptRawGraph } from '../utils/adaptGraph';

/**
 * M3 — Time-slider. Sits just above the StatusBar and is shown ONLY when there
 * is more than one recorded scan (history to travel through).
 *
 * Dragging the slider to a past scan reconstructs the graph from history.db
 * (via `get_snapshot` — NO disk re-index) and enters HISTORICAL mode, which
 * freezes the live watcher from stomping the view (see App.tsx / appStore).
 * The "HOY" (Now) button returns to LIVE mode and jumps to the latest scan.
 *
 * Reconstruction goes through the same `adaptRawGraph` → setGraph pipeline as
 * live indexing (M1), so buildGraphologyGraph + positionCache keep persisting
 * nodes in place — no jumping when traveling in time.
 */
export const TimeSlider: React.FC = () => {
  const {
    projectPath, historyScans, viewMode,
    setGraph, setStats, enterHistorical, returnToLive,
  } = useAppStore();

  // The index into historyScans the slider currently points at.
  const [sliderIdx, setSliderIdx] = useState<number>(historyScans.length - 1);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Keep the thumb pinned to the newest scan while in live mode (new scans arrive).
  useEffect(() => {
    if (viewMode === 'live') {
      setSliderIdx(historyScans.length - 1);
    }
  }, [historyScans.length, viewMode]);

  // Load a given scan index: reconstruct the graph from its stored snapshot.
  const loadScan = useCallback(async (idx: number) => {
    const scan = historyScans[idx];
    if (!scan || !projectPath) return;
    const isLatest = idx === historyScans.length - 1;

    try {
      const { invoke } = await import('@tauri-apps/api/core');

      // Reconstruct the exact graph JSON stored at this scan (no disk re-index).
      const snapshotJson = await invoke<string>('get_snapshot', {
        path: projectPath,
        scanId: scan.scan_id,
      });
      const raw = JSON.parse(snapshotJson) as Record<string, unknown>;
      const reconstructed = adaptRawGraph(raw, projectPath);

      setGraph(reconstructed);
      setStats({
        nodeCount: reconstructed.nodes?.length ?? 0,
        edgeCount: reconstructed.edges?.length ?? 0,
        communityCount: reconstructed.communities?.length ?? 0,
      });

      if (isLatest) {
        // Newest scan == present → live mode (watcher re-engages).
        returnToLive();
      } else {
        // Past scan → historical mode + load the change overlay for coloring.
        let overlay: import('../stores/appStore').ChangeEvent[] = [];
        try {
          overlay = await invoke<import('../stores/appStore').ChangeEvent[]>('get_changes', {
            path: projectPath,
            scanId: scan.scan_id,
          });
        } catch {
          overlay = [];
        }
        enterHistorical(scan.scan_id, overlay);
      }
    } catch (err) {
      console.error('[M3] failed to load snapshot:', err);
    }
  }, [historyScans, projectPath, setGraph, setStats, enterHistorical, returnToLive]);

  const onSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = Number(e.target.value);
    setSliderIdx(idx);
    void loadScan(idx);
  }, [loadScan]);

  const goToNow = useCallback(() => {
    const lastIdx = historyScans.length - 1;
    setSliderIdx(lastIdx);
    void loadScan(lastIdx);
  }, [historyScans.length, loadScan]);

  // Hidden until there is more than one scan to travel through.
  if (historyScans.length < 2) return null;

  const isHistorical = viewMode === 'historical';
  const displayScan = historyScans[hoverIdx ?? sliderIdx];
  const fmtTs = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const styles: Record<string, React.CSSProperties> = {
    bar: {
      position: 'fixed',
      bottom: 28, // sits directly on top of the 28px StatusBar
      left: 0,
      right: 0,
      height: 40,
      background: isHistorical ? 'rgba(217, 119, 6, 0.08)' : 'var(--panel)',
      borderTop: `1px solid ${isHistorical ? 'rgba(217, 119, 6, 0.4)' : 'var(--border)'}`,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '0 14px',
      zIndex: 190,
      fontSize: 11,
      color: 'var(--text-muted)',
      transition: 'background 0.25s, border-color 0.25s',
    },
    modeBadge: {
      display: 'flex',
      alignItems: 'center',
      gap: 5,
      padding: '2px 8px',
      borderRadius: 'var(--radius-sm)',
      fontWeight: 600,
      fontSize: 10,
      whiteSpace: 'nowrap',
      background: isHistorical ? 'rgba(217, 119, 6, 0.15)' : 'rgba(37, 99, 235, 0.1)',
      color: isHistorical ? '#b45309' : '#2563eb',
      border: `1px solid ${isHistorical ? 'rgba(217, 119, 6, 0.35)' : 'rgba(37, 99, 235, 0.25)'}`,
    },
    slider: {
      flex: 1,
      accentColor: isHistorical ? '#d97706' : '#2563eb',
      cursor: 'pointer',
    },
    tsLabel: {
      fontVariantNumeric: 'tabular-nums',
      minWidth: 150,
      textAlign: 'center',
      color: 'var(--text)',
      fontWeight: 500,
    },
    counts: {
      fontVariantNumeric: 'tabular-nums',
      minWidth: 96,
      fontSize: 10,
    },
    nowBtn: {
      padding: '3px 12px',
      borderRadius: 'var(--radius-sm)',
      border: `1px solid ${isHistorical ? '#d97706' : 'var(--border)'}`,
      background: isHistorical ? '#d97706' : 'transparent',
      color: isHistorical ? '#fff' : 'var(--text-dim)',
      fontSize: 10,
      fontWeight: 600,
      cursor: isHistorical ? 'pointer' : 'default',
      opacity: isHistorical ? 1 : 0.5,
      transition: 'all 0.15s',
    },
  };

  return (
    <div style={styles.bar}>
      <div style={styles.modeBadge}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: isHistorical ? '#d97706' : '#2563eb',
        }} />
        {isHistorical ? 'HISTÓRICO' : 'PRESENTE'}
      </div>

      <span style={styles.tsLabel}>
        {displayScan ? fmtTs(displayScan.ts) : '—'}
      </span>

      <input
        type="range"
        min={0}
        max={historyScans.length - 1}
        step={1}
        value={sliderIdx}
        onChange={onSliderChange}
        onMouseMove={(e) => {
          const el = e.currentTarget;
          const rect = el.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          const idx = Math.round(pct * (historyScans.length - 1));
          setHoverIdx(Math.max(0, Math.min(historyScans.length - 1, idx)));
        }}
        onMouseLeave={() => setHoverIdx(null)}
        style={styles.slider}
        title={displayScan ? `${fmtTs(displayScan.ts)}  +${displayScan.added} ~${displayScan.modified} -${displayScan.removed}` : ''}
      />

      <span style={styles.counts}>
        {displayScan
          ? <>
              <span style={{ color: '#16a34a' }}>+{displayScan.added}</span>{' '}
              <span style={{ color: '#d97706' }}>~{displayScan.modified}</span>{' '}
              <span style={{ color: '#dc2626' }}>-{displayScan.removed}</span>
            </>
          : null}
      </span>

      <button
        style={styles.nowBtn}
        onClick={goToNow}
        disabled={!isHistorical}
        title="Volver al presente (reactiva el watcher en vivo)"
      >
        HOY
      </button>
    </div>
  );
};
