import React, { useEffect, useRef } from 'react';
import Sigma from 'sigma';
import Graph from 'graphology';
import { EdgeArrowProgram } from 'sigma/rendering';
import { EdgeCurvedArrowProgram } from '@sigma/edge-curve';
import { createNodeBorderProgram } from '@sigma/node-border';
import { useAppStore } from '../stores/appStore';
import { buildGraphologyGraph, useGraphStats } from '../hooks/useGraph';
import type { PositionCache } from '../hooks/useGraph';
import type { UnifiedGraph } from '../types/graph';

const NodeBorderProgram = createNodeBorderProgram({
  borders: [
    { size: { value: 0.15, mode: 'relative' }, color: { attribute: 'borderColor' } },
    { size: { fill: true }, color: { attribute: 'color' } },
  ],
});

interface GraphCanvasProps {
  data?: UnifiedGraph;
  className?: string;
}

export const GraphCanvas: React.FC<GraphCanvasProps> = ({ data, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  // v2.3: nodes highlighted by an external AI through the AI Bridge (POST /highlight).
  const aiHighlightsRef = useRef<Map<string, { color: string; label: string }>>(new Map());
  // Persistent position cache — survives filter toggles and prevents node jumping
  const positionCacheRef = useRef<PositionCache>(new Map());

  const {
    isFilterOpen,
    selectedNodeId,
    setSelectedNode,
    setStats,
    focusNodeId,
    setFocusNode,
    fitRequestId,
    activeTypeFilters,
    activeCommunityFilters,
    activeLanguageFilters,
  } = useAppStore();

  useGraphStats();

  // Sigma instance lifecycle — only creates/destroys the renderer, never rebuilds graph data
  useEffect(() => {
    if (!containerRef.current) return;

    const graph = new Graph({ multi: false, type: 'directed' });

    const sigma: Sigma = new Sigma(graph, containerRef.current, {
      nodeProgramClasses: {
        border: NodeBorderProgram,
      },
      edgeProgramClasses: {
        curvedArrow: EdgeCurvedArrowProgram,
        arrow: EdgeArrowProgram,
      },
      defaultNodeType: 'border',
      defaultEdgeType: 'curvedArrow',
      defaultEdgeColor: 'rgba(160, 170, 190, 0.35)',
      defaultNodeColor: '#2563eb',
      labelRenderedSizeThreshold: 3,
      labelFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      labelWeight: '500',
      labelSize: 12,
      labelColor: { color: '#374151' },
      edgeLabelSize: 9,
      minCameraRatio: 0.02,
      maxCameraRatio: 20,
      enableEdgeEvents: false,
      renderEdgeLabels: false,
      allowInvalidContainer: true,
      zIndex: true,
      nodeReducer: (node: string, attrs: Record<string, unknown>) => {
        const hovered = hoveredRef.current;
        const selected = selectedRef.current;
        const baseSize = (attrs.size as number) || 6;

        if (selected && node === selected) {
          return {
            ...attrs,
            size: baseSize * 1.4,
            color: '#f59e0b',
            highlighted: true,
            zIndex: 2,
          };
        }

        const ai = aiHighlightsRef.current.get(node);
        if (ai) {
          return {
            ...attrs,
            size: baseSize * 1.5,
            color: ai.color || '#f59e0b',
            highlighted: true,
            forceLabel: true,
            zIndex: 3,
          };
        }

        if (!hovered) return attrs;
        const g = sigma.getGraph();
        if (!g.hasNode(hovered)) return attrs;
        if (node === hovered || g.neighbors(hovered).includes(node)) {
          return { ...attrs, highlighted: true, zIndex: 1 };
        }
        return { ...attrs, color: '#dfe2e8', label: null, zIndex: 0 };
      },
      edgeReducer: (edge: string, attrs: Record<string, unknown>) => {
        const hovered = hoveredRef.current;
        if (!hovered) return attrs;
        const g = sigma.getGraph();
        if (!g.hasNode(hovered)) return attrs;
        if (g.extremities(edge).includes(hovered)) {
          const hoveredColor: string = (g.getNodeAttribute(hovered, 'color') as string) || '#4da3ff';
          return { ...attrs, color: hoveredColor, size: 2.5 };
        }
        return { ...attrs, hidden: true };
      },
    });

    sigma.on('clickNode', ({ node }) => setSelectedNode(node));
    sigma.on('clickStage', () => setSelectedNode(null));
    sigma.on('doubleClickStage', ({ event }) => {
      event.preventSigmaDefault();
    });
    sigma.on('enterNode', ({ node }) => {
      hoveredRef.current = node;
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
      sigma.refresh();
    });
    sigma.on('leaveNode', () => {
      hoveredRef.current = null;
      if (containerRef.current) containerRef.current.style.cursor = 'default';
      sigma.refresh();
    });

    const camera = sigma.getCamera();
    camera.on('updated', () => {
      setStats({ zoom: camera.ratio });
    });

    sigmaRef.current = sigma;

    return () => {
      sigma.kill();
      sigmaRef.current = null;
    };
  }, []);

  // v2.3: poll the AI Bridge highlight list and paint marked nodes live. This is
  // what makes `POST /highlight` visible: an external AI marks a node and the
  // graph lights it up within ~1.5s (badge already counted them, canvas didn't).
  useEffect(() => {
    let cancelled = false;
    let lastSig = '';
    const tick = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const list = await invoke<Array<{ node_id: string; color: string; label: string }>>(
          'get_ai_highlights'
        );
        if (cancelled) return;
        const sig = JSON.stringify((list ?? []).map(h => [h.node_id, h.color]));
        if (sig === lastSig) return; // nothing changed — skip the refresh
        lastSig = sig;
        const map = new Map<string, { color: string; label: string }>();
        (list ?? []).forEach(h => map.set(h.node_id, { color: h.color, label: h.label }));
        aiHighlightsRef.current = map;
        sigmaRef.current?.refresh();
      } catch {
        // bridge not ready (welcome screen, dev reload) — silently retry next tick
      }
    };
    const id = window.setInterval(tick, 1500);
    tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // SINGLE graph build effect — replaces the two separate effects that caused double construction.
  // Runs whenever data OR filters change. Uses positionCacheRef so nodes keep their positions
  // across filter toggles (no more jumping on re-filter).
  useEffect(() => {
    if (!data || !sigmaRef.current) return;

    try {
      const hasTypeFilter = activeTypeFilters.size > 0;
      const hasCommunityFilter = activeCommunityFilters.size > 0;
      const hasLanguageFilter = activeLanguageFilters.size > 0;

      // Build the full graph once (with position cache)
      const { graph: full, updatedCache } = buildGraphologyGraph(data, positionCacheRef.current);
      positionCacheRef.current = updatedCache;

      if (!hasTypeFilter && !hasCommunityFilter && !hasLanguageFilter) {
        // No filters — use the full graph as-is
        sigmaRef.current.setGraph(full);
        sigmaRef.current.refresh();
        setTimeout(() => {
          sigmaRef.current?.getCamera().animatedReset({ duration: 600 });
        }, 100);
        return;
      }

      // Filters active — slice the full graph (nodes keep their cached positions)
      const filtered = new Graph({ multi: false, type: 'directed' });

      const visibleNodes = new Set<string>();
      full.forEachNode((nodeId, attrs) => {
        const typeOk = !hasTypeFilter || activeTypeFilters.has(attrs.nodeType as string);
        const communityOk = !hasCommunityFilter || activeCommunityFilters.has(attrs.community as number);
        const languageOk = !hasLanguageFilter || activeLanguageFilters.has(attrs.language as string);
        if (typeOk && communityOk && languageOk) {
          visibleNodes.add(nodeId);
        }
      });

      full.forEachNode((nodeId, attrs) => {
        if (visibleNodes.has(nodeId)) {
          filtered.addNode(nodeId, attrs);
        }
      });

      full.forEachEdge((_edgeId, attrs, source, target) => {
        if (visibleNodes.has(source) && visibleNodes.has(target)) {
          if (!filtered.hasEdge(source, target)) {
            filtered.addEdge(source, target, attrs);
          }
        }
      });

      sigmaRef.current.setGraph(filtered);
      sigmaRef.current.refresh();
    } catch (err) {
      console.error('[GraphCanvas] ERROR building/setting graph:', err);
    }
  }, [data, activeTypeFilters, activeCommunityFilters, activeLanguageFilters]);

  useEffect(() => {
    selectedRef.current = selectedNodeId ?? null;
    sigmaRef.current?.refresh();
  }, [selectedNodeId]);

  useEffect(() => {
    if (!fitRequestId || !sigmaRef.current) return;
    sigmaRef.current.getCamera().animatedReset({ duration: 500 });
  }, [fitRequestId]);

  useEffect(() => {
    if (!focusNodeId || !sigmaRef.current) return;
    try {
      const pos = sigmaRef.current.getNodeDisplayData(focusNodeId);
      if (pos) {
        sigmaRef.current.getCamera().animate(
          { x: pos.x, y: pos.y, ratio: 0.5 },
          { duration: 400 }
        );
      }
      setFocusNode(null);
    } catch {
      setFocusNode(null);
    }
  }, [focusNodeId]);

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    top: isFilterOpen ? 92 : 48,
    bottom: 28,
    left: 0,
    right: 0,
    background: '#fafbfc',
    transition: 'top 0.2s ease',
  };

  return (
    <div style={containerStyle} className={className}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', background: '#f5f6f8' }}
      />
    </div>
  );
};
