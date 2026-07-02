import React, { useEffect, useRef } from 'react';
import Sigma from 'sigma';
import Graph from 'graphology';
import { EdgeArrowProgram } from 'sigma/rendering';
import { EdgeCurvedArrowProgram } from '@sigma/edge-curve';
import { createNodeBorderProgram } from '@sigma/node-border';
import { useAppStore } from '../stores/appStore';
import { buildGraphologyGraph, useGraphStats } from '../hooks/useGraph';
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
  const {
    isFilterOpen,
    selectedNodeId,
    setSelectedNode,
    setHoveredNode,
    setStats,
    focusNodeId,
    setFocusNode,
    fitRequestId,
    activeTypeFilters,
    activeCommunityFilters,
    activeLanguageFilters,
  } = useAppStore();

  useGraphStats();

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
      setHoveredNode(node);
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
      sigma.refresh();
    });
    sigma.on('leaveNode', () => {
      hoveredRef.current = null;
      setHoveredNode(null);
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

  useEffect(() => {
    if (!data || !sigmaRef.current) return;

    try {
      const g = buildGraphologyGraph(data);
      sigmaRef.current.setGraph(g);
      sigmaRef.current.refresh();

      setTimeout(() => {
        sigmaRef.current?.getCamera().animatedReset({ duration: 600 });
      }, 100);
    } catch (err) {
      console.error('[GraphCanvas] ERROR building/setting graph:', err);
    }
  }, [data]);

  useEffect(() => {
    if (!data || !sigmaRef.current) return;

    const hasTypeFilter = activeTypeFilters.size > 0;
    const hasCommunityFilter = activeCommunityFilters.size > 0;
    const hasLanguageFilter = activeLanguageFilters.size > 0;

    if (!hasTypeFilter && !hasCommunityFilter && !hasLanguageFilter) {
      if (data) {
        const full = buildGraphologyGraph(data);
        sigmaRef.current.setGraph(full);
        sigmaRef.current.refresh();
      }
      return;
    }

    const full = buildGraphologyGraph(data);
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
