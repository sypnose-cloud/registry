import React, {
  useCallback, useEffect, useLayoutEffect,
  useRef, useState,
} from 'react';
import { useAppStore } from '../stores/appStore';

/**
 * M10 — Organigrama (vista inmersiva). Tema claro.
 *
 * Re-skin completo: tokens claros (orden directa Carlos "odio el negro").
 * Chips binarios → reveal_in_explorer (cursor default, atenuado, tooltip).
 * Sin relaciones → agrupación por tipo de contenido (Código/Datos/Documentación).
 */

// ── Design tokens (LIGHT theme — Carlos order: odio el negro) ──────────────
const T = {
  bg: '#ffffff',
  panel: '#f8fafc',
  card: '#ffffff',
  cardHover: '#f1f5f9',
  border: '#e2e8f0',
  borderSoft: '#e5e7eb',
  text: '#111827',
  muted: '#6b7280',
  dim: '#9ca3af',
  accent: '#2563eb',
  accentSoft: '#dbeafe',
  ok: '#059669',
  okSoft: '#d1fae5',
} as const;

// ── Binary file extensions → reveal in explorer instead of code viewer ──────
const BINARY_EXTS = new Set([
  'wav', 'mp3', 'ogg',
  'png', 'jpg', 'jpeg', 'gif', 'ico', 'svg',
  'pkl', 'bin', 'exe', 'dll',
  'zip', '7z', 'pdf',
  'onnx', 'pt', 'safetensors',
  'msix', 'db', 'sqlite',
]);

function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTS.has(ext);
}

// ── CodeBoarding contract types ─────────────────────────────────────────────
interface KeyEntity {
  reference_file: string;
  reference_start_line?: number;
  reference_end_line?: number;
}

interface AnalysisComponent {
  component_id: string | number;
  name: string;
  description: string;
  key_entities?: KeyEntity[];
}

interface AnalysisRelation {
  src_id: string | number;
  dst_id: string | number;
  src_name?: string;
  dst_name?: string;
  relation: string;
}

interface Analysis {
  components: AnalysisComponent[];
  components_relations: AnalysisRelation[];
}

// ── Level labels ─────────────────────────────────────────────────────────────
const LABELS = ['Entrada', 'Núcleo', 'Superficies', 'Nivel 4', 'Nivel 5', 'Nivel 6', 'Otros'];

// ── Content-type grouping labels (used when 0 relations) ─────────────────────
const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'cpp', 'h', 'cs', 'rb', 'php', 'vue', 'svelte', 'sh', 'bash', 'ps1', 'lua', 'r', 'scala', 'clj']);
const DATA_EXTS = new Set(['json', 'yaml', 'yml', 'toml', 'csv', 'xml', 'sql', 'env', 'ini', 'cfg', 'config', 'lock', 'pkl', 'db', 'sqlite', 'parquet', 'ndjson', 'jsonl']);
const DOC_EXTS = new Set(['md', 'mdx', 'txt', 'rst', 'tex', 'adoc', 'pdf', 'html', 'htm']);

type ContentGroup = 'Código' | 'Datos' | 'Documentación' | 'Otros';

function contentGroup(comp: AnalysisComponent): ContentGroup {
  const entities = comp.key_entities ?? [];
  if (!entities.length) return 'Otros';
  // Majority vote across entities
  const counts: Record<ContentGroup, number> = { 'Código': 0, 'Datos': 0, 'Documentación': 0, 'Otros': 0 };
  for (const e of entities) {
    const ext = e.reference_file.split('.').pop()?.toLowerCase() ?? '';
    if (CODE_EXTS.has(ext)) counts['Código']++;
    else if (DATA_EXTS.has(ext)) counts['Datos']++;
    else if (DOC_EXTS.has(ext)) counts['Documentación']++;
    else counts['Otros']++;
  }
  let best: ContentGroup = 'Otros';
  let max = -1;
  for (const [k, v] of Object.entries(counts) as [ContentGroup, number][]) {
    if (v > max) { max = v; best = k; }
  }
  return best;
}

function cid(c: AnalysisComponent): string {
  return String(c.component_id);
}

/** Kahn topological sort → level per component id */
function assignLevels(comps: AnalysisComponent[], rels: AnalysisRelation[]): Map<string, number> {
  const ids = comps.map(c => cid(c));
  const incoming = new Map<string, number>(ids.map(i => [i, 0]));
  const out = new Map<string, string[]>(ids.map(i => [i, []]));

  rels.forEach(r => {
    const s = String(r.src_id), d = String(r.dst_id);
    if (incoming.has(d)) incoming.set(d, (incoming.get(d) ?? 0) + 1);
    if (out.has(s)) out.get(s)!.push(d);
  });

  const level = new Map<string, number>();
  let frontier = ids.filter(i => (incoming.get(i) ?? 0) === 0);
  if (!frontier.length) frontier = ids.length ? [ids[0]] : [];
  let depth = 0;
  const seen = new Set<string>();

  while (frontier.length && depth < 6) {
    frontier.forEach(i => { if (!seen.has(i)) { level.set(i, depth); seen.add(i); } });
    const next = new Set<string>();
    frontier.forEach(i => (out.get(i) ?? []).forEach(d => { if (!seen.has(d)) next.add(d); }));
    frontier = [...next];
    depth++;
  }
  ids.forEach(i => { if (!level.has(i)) level.set(i, depth); });
  return level;
}

// ── Styles (light theme) ─────────────────────────────────────────────────────
const css = {
  overlay: {
    position: 'fixed' as const, inset: 0, zIndex: 400,
    background: T.bg, display: 'flex', flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 14, padding: '14px 22px',
    borderBottom: `1px solid ${T.borderSoft}`, background: T.panel,
    flexShrink: 0,
  },
  h1: { fontSize: 16, fontWeight: 600, color: T.text, margin: 0 },
  headerActions: { marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' },
  btn: {
    background: T.panel, border: `1px solid ${T.border}`, color: T.muted,
    borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12,
  },
  btnAccent: {
    background: T.accentSoft, border: `1px solid ${T.accent}`, color: T.accent,
    borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12,
  },
  wrap: { flex: 1, overflowY: 'auto' as const, padding: '26px 22px 60px', maxWidth: 1020, margin: '0 auto', width: '100%' },
  meta: { color: T.muted, fontSize: 13, marginBottom: 8 },
  hint: { color: T.dim, fontSize: 12, marginBottom: 20 },
  state: { textAlign: 'center' as const, color: T.muted, padding: '80px 20px', fontSize: 14 },
  errorBox: {
    background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.25)',
    borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626', margin: '8px 0',
  },
  noFlowNotice: {
    background: T.accentSoft, border: `1px solid ${T.border}`, borderRadius: 8,
    padding: '8px 14px', fontSize: 12, color: T.accent, marginBottom: 16,
  },
  flowbox: { position: 'relative' as const },
  wiresWrap: { position: 'absolute' as const, inset: 0, pointerEvents: 'none' as const, zIndex: 1, overflow: 'visible' as const },
  flow: { display: 'flex', flexDirection: 'column' as const, position: 'relative' as const, zIndex: 2 },
  level: {
    border: `1px solid ${T.border}`, borderRadius: 16, padding: 18,
    background: T.panel, position: 'relative' as const,
    marginTop: 8,
    boxShadow: '0 1px 3px rgba(0,0,0,.08)',
  },
  levelGap: { marginTop: 46 },
  levelLabel: {
    position: 'absolute' as const, top: -9, left: 16,
    background: T.bg, color: T.dim, fontSize: 11, letterSpacing: '0.08em',
    padding: '0 8px', textTransform: 'uppercase' as const,
  },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 },
  node: {
    background: T.card, border: `1px solid ${T.border}`, borderRadius: 12,
    padding: '13px 15px', cursor: 'pointer', transition: 'background 0.12s, border-color 0.12s',
    boxShadow: '0 1px 3px rgba(0,0,0,.08)',
  },
  nodeH3: { fontSize: 14.5, fontWeight: 600, color: T.text, marginBottom: 4 },
  nodeP: { fontSize: 12.5, color: T.muted },
  nodeFiles: { marginTop: 9, display: 'flex', flexWrap: 'wrap' as const, gap: 5 },
  nodeMore: { fontSize: 11, color: T.accent, marginTop: 7 },
  // Text chip: clickable, opens code viewer
  chip: {
    fontFamily: "ui-monospace, 'Cascadia Code', monospace", fontSize: 11, lineHeight: 1,
    color: T.accent, background: T.accentSoft, borderRadius: 6, padding: '4px 7px',
    border: 'none', cursor: 'pointer',
  },
  // Binary chip: NOT clickable directly — reveals in explorer via onclick, visually dimmed
  chipBinary: {
    fontFamily: "ui-monospace, 'Cascadia Code', monospace", fontSize: 11, lineHeight: 1,
    color: T.dim, background: '#f3f4f6', borderRadius: 6, padding: '4px 7px',
    border: `1px solid ${T.borderSoft}`, cursor: 'default',
  },
  rels: { marginTop: 34 },
  relsH2: { fontSize: 14, color: T.muted, fontWeight: 600, marginBottom: 12, letterSpacing: '0.05em', textTransform: 'uppercase' as const },
  rel: { display: 'flex', gap: 10, alignItems: 'baseline', padding: '9px 0', borderBottom: `1px solid ${T.borderSoft}`, fontSize: 13 },
  relPair: { whiteSpace: 'nowrap' as const, color: T.text },
  relArrow: { color: T.accent },
  relWhat: { color: T.muted },
  // Modal overlay: light semi-transparent
  modalOverlay: {
    position: 'fixed' as const, inset: 0, background: 'rgba(15,23,42,.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 30,
  },
  viewer: {
    width: 'min(960px, 100%)', height: 'min(80vh, 720px)', background: T.panel,
    border: `1px solid ${T.border}`, borderRadius: 14, display: 'flex', flexDirection: 'column' as const,
    overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,.12)',
  },
  viewerBar: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
    borderBottom: `1px solid ${T.borderSoft}`,
    fontFamily: "ui-monospace, monospace", fontSize: 12.5, color: T.accent,
    background: T.panel,
  },
  viewerClose: {
    marginLeft: 'auto', background: T.panel, border: `1px solid ${T.border}`, color: T.muted,
    borderRadius: 7, padding: '4px 10px', cursor: 'pointer', fontSize: 12,
  },
  // Code viewer pre: light background, dark text, highlighted line = accentSoft
  viewerPre: {
    flex: 1, overflow: 'auto', padding: '14px 0',
    fontFamily: "ui-monospace, 'Cascadia Code', monospace", fontSize: 12, lineHeight: 1.6,
    color: T.text, margin: 0, background: '#f8fafc',
  },
  detail: {
    width: 'min(680px, 100%)', maxHeight: 'min(82vh, 760px)', background: T.panel,
    border: `1px solid ${T.border}`, borderRadius: 14, display: 'flex', flexDirection: 'column' as const,
    overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,.12)',
  },
  detailBar: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px',
    borderBottom: `1px solid ${T.borderSoft}`, background: T.panel,
  },
  detailH2: { fontSize: 15.5, fontWeight: 600, color: T.text },
  detailClose: {
    marginLeft: 'auto', background: T.panel, border: `1px solid ${T.border}`, color: T.muted,
    borderRadius: 7, padding: '4px 10px', cursor: 'pointer', fontSize: 12,
  },
  detailBody: { overflow: 'auto', padding: '16px 18px 22px', background: T.card },
  detailDesc: { fontSize: 13.5, color: T.text, marginBottom: 16 },
  detailH4: { fontSize: 12, color: T.dim, textTransform: 'uppercase' as const, letterSpacing: '0.06em', margin: '16px 0 8px' },
  detailFiles: { display: 'flex', flexWrap: 'wrap' as const, gap: 6 },
  flowline: {
    display: 'flex', gap: 8, alignItems: 'baseline', padding: '7px 0',
    fontSize: 13, borderBottom: `1px solid ${T.borderSoft}`,
  },
  flowlineDir: { color: T.accent, fontWeight: 600, whiteSpace: 'nowrap' as const },
  flowlineWho: { color: T.text, whiteSpace: 'nowrap' as const },
  flowlineWhat: { color: T.muted },
  viewInGraph: {
    marginTop: 12, background: T.accentSoft, border: `1px solid ${T.accent}`, color: T.accent,
    borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontSize: 12,
  },
};

// ── Main component ───────────────────────────────────────────────────────────

export const ArchitectureView: React.FC = () => {
  const {
    isArchitectureOpen,
    toggleArchitecture,
    graph,
    projectPath,
    setSelectedNode,
    setFocusNode,
  } = useAppStore();

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);

  // Viewer overlay state (code viewer)
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerPath, setViewerPath] = useState('');
  const [viewerCode, setViewerCode] = useState<string | null>(null);
  const [viewerStart, setViewerStart] = useState(1);
  const [viewerEnd, setViewerEnd] = useState(1);
  const [viewerLoading, setViewerLoading] = useState(false);

  // Detail overlay state (component ficha)
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailCid, setDetailCid] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const flowboxRef = useRef<HTMLDivElement>(null);
  const isMounted = useRef(true);

  // Keep line refs for scroll-to-highlight
  const lineRefs = useRef<Map<number, HTMLSpanElement>>(new Map());

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // ── Invoke helper (lazy import Tauri) ────────────────────────────────────
  const invoke = useCallback(async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    const mod = await import('@tauri-apps/api/core');
    return (mod.invoke as (cmd: string, args?: Record<string, unknown>) => Promise<T>)(cmd, args);
  }, []);

  // ── Reveal binary file in explorer ──────────────────────────────────────
  const revealBinary = useCallback(async (relPath: string) => {
    if (!projectPath) return;
    const sep = projectPath.includes('\\') ? '\\' : '/';
    const fullPath = (projectPath.replace(/[\\/]$/, '') + sep + relPath).replace(/\//g, '\\');
    try {
      await invoke('reveal_in_explorer', { path: fullPath });
    } catch (err) {
      console.error('[ArchitectureView] reveal_in_explorer failed:', err);
    }
  }, [projectPath, invoke]);

  // ── Check API key status ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isArchitectureOpen) return;
    invoke<{ configured: boolean; hint: string }>('get_api_key_status')
      .then(s => { if (isMounted.current) setHasApiKey(s.configured); })
      .catch(() => {});
  }, [isArchitectureOpen, invoke]);

  // ── Load or generate analysis on open ───────────────────────────────────
  const loadAnalysis = useCallback(async () => {
    if (!isArchitectureOpen || !projectPath) return;
    setLoading(true);
    setError(null);

    try {
      let raw: string | null = null;
      try {
        const graphJson = graph ? JSON.stringify(graph) : undefined;
        raw = await invoke<string | null>('get_analysis', { path: projectPath, graphJson });
      } catch { raw = null; }

      if (!raw) {
        if (!graph) {
          if (isMounted.current) {
            setError('El grafo no está cargado. Abre un proyecto primero.');
            setLoading(false);
          }
          return;
        }
        try {
          const graphJson = JSON.stringify(graph);
          raw = await invoke<string>('generate_analysis', { path: projectPath, graphJson });
        } catch (err) {
          if (isMounted.current) {
            setError(`No se pudo generar el organigrama: ${err}`);
            setLoading(false);
          }
          return;
        }
      }

      if (isMounted.current) {
        try {
          setAnalysis(JSON.parse(raw) as Analysis);
        } catch {
          setError('El archivo analysis.json está malformado.');
        }
        setLoading(false);
      }
    } catch (err) {
      if (isMounted.current) {
        setError(`Error inesperado: ${err}`);
        setLoading(false);
      }
    }
  }, [isArchitectureOpen, graph, projectPath, invoke]);

  useEffect(() => {
    if (isArchitectureOpen) {
      void loadAnalysis();
    } else {
      setAnalysis(null);
      setError(null);
      setEnrichError(null);
      setViewerOpen(false);
      setDetailOpen(false);
    }
  }, [isArchitectureOpen, loadAnalysis]);

  // ── ESC handler ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isArchitectureOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (viewerOpen) { setViewerOpen(false); return; }
        if (detailOpen) { setDetailOpen(false); return; }
        toggleArchitecture();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isArchitectureOpen, viewerOpen, detailOpen, toggleArchitecture]);

  // ── Draw SVG wires ───────────────────────────────────────────────────────
  const drawWires = useCallback(() => {
    const svg = svgRef.current;
    const box = flowboxRef.current;
    if (!svg || !box || !analysis) return;

    const boxRect = box.getBoundingClientRect();
    svg.setAttribute('width', String(boxRect.width));
    svg.setAttribute('height', String(boxRect.height));

    [...svg.querySelectorAll('path.wire')].forEach(p => p.remove());

    const boxLeft = boxRect.left;
    const boxTop = boxRect.top;

    analysis.components_relations.forEach(r => {
      const srcId = String(r.src_id);
      const dstId = String(r.dst_id);
      const a = box.querySelector<HTMLElement>(`.arch-node[data-cid="${CSS.escape(srcId)}"]`);
      const b = box.querySelector<HTMLElement>(`.arch-node[data-cid="${CSS.escape(dstId)}"]`);
      if (!a || !b) return;

      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const sameRow = Math.abs(ra.top - rb.top) < 30;
      let x1: number, y1: number, x2: number, y2: number;

      if (sameRow) {
        const leftFirst = ra.left < rb.left;
        x1 = (leftFirst ? ra.right : ra.left) - boxLeft;
        y1 = ra.top + ra.height / 2 - boxTop;
        x2 = (leftFirst ? rb.left : rb.right) - boxLeft;
        y2 = rb.top + rb.height / 2 - boxTop;
      } else {
        const down = rb.top > ra.top;
        x1 = ra.left + ra.width / 2 - boxLeft;
        y1 = (down ? ra.bottom : ra.top) - boxTop;
        x2 = rb.left + rb.width / 2 - boxLeft;
        y2 = (down ? rb.top : rb.bottom) - boxTop;
      }

      const midY = (y1 + y2) / 2;
      const d = sameRow
        ? `M${x1},${y1} C${(x1 + x2) / 2},${y1 - 26} ${(x1 + x2) / 2},${y2 - 26} ${x2},${y2}`
        : `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'wire');
      path.setAttribute('fill', 'none');
      // Light theme arrow: stroke #94a3b8, hover #2563eb
      path.setAttribute('stroke', '#94a3b8');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('marker-end', 'url(#arch-arr)');
      path.style.transition = 'stroke 0.15s, stroke-width 0.15s';
      path.dataset.src = srcId;
      path.dataset.dst = dstId;

      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = r.relation;
      path.appendChild(title);
      svg.appendChild(path);
    });
  }, [analysis]);

  useLayoutEffect(() => {
    if (!analysis || !isArchitectureOpen) return;
    const id = requestAnimationFrame(drawWires);
    return () => cancelAnimationFrame(id);
  }, [analysis, isArchitectureOpen, drawWires]);

  useEffect(() => {
    if (!analysis || !isArchitectureOpen) return;
    const handler = () => requestAnimationFrame(drawWires);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [analysis, isArchitectureOpen, drawWires]);

  // ── Highlight wires on hover ─────────────────────────────────────────────
  const highlightWires = useCallback((cidStr: string, on: boolean) => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.querySelectorAll<SVGPathElement>('path.wire').forEach(p => {
      if (p.dataset.src === cidStr || p.dataset.dst === cidStr) {
        // Light theme: normal #94a3b8, hover #2563eb
        p.setAttribute('stroke', on ? '#2563eb' : '#94a3b8');
        p.setAttribute('stroke-width', on ? '2.5' : '1.5');
      }
    });
  }, []);

  // ── Open file viewer (text files only) ──────────────────────────────────
  const openFile = useCallback(async (relPath: string, start: number, end: number) => {
    setViewerPath(relPath);
    setViewerStart(start || 1);
    setViewerEnd(end || 1);
    setViewerCode(null);
    setViewerLoading(true);
    setViewerOpen(true);
    lineRefs.current.clear();

    if (!projectPath) {
      setViewerCode(null);
      setViewerLoading(false);
      return;
    }

    try {
      const text = await invoke<string>('read_project_file', { path: projectPath, relPath });
      if (isMounted.current) {
        setViewerCode(text);
        setViewerLoading(false);
      }
    } catch (err) {
      if (isMounted.current) {
        setViewerCode(null);
        setViewerLoading(false);
        setError(`No se pudo cargar el archivo: ${err}`);
      }
    }
  }, [projectPath, invoke]);

  // ── Handle chip click: text → viewer, binary → reveal ───────────────────
  const handleChipClick = useCallback(async (relPath: string, start: number, end: number) => {
    if (isBinaryFile(relPath)) {
      await revealBinary(relPath);
    } else {
      await openFile(relPath, start, end);
    }
  }, [revealBinary, openFile]);

  // Scroll highlighted line into center after render
  useEffect(() => {
    if (!viewerOpen || viewerLoading || !viewerCode) return;
    const ref = lineRefs.current.get(viewerStart);
    if (ref) {
      setTimeout(() => ref.scrollIntoView({ block: 'center' }), 50);
    }
  }, [viewerOpen, viewerLoading, viewerCode, viewerStart]);

  // ── Open component detail ────────────────────────────────────────────────
  const openDetail = useCallback((cidStr: string) => {
    setDetailCid(cidStr);
    setDetailOpen(true);
  }, []);

  // ── "Ver en el grafo →" handler ──────────────────────────────────────────
  const viewInGraph = useCallback((comp: AnalysisComponent) => {
    if (!graph || !comp.key_entities?.length) return;
    for (const entity of (comp.key_entities ?? [])) {
      const refFile = entity.reference_file;
      const matchedNode = graph.nodes.find(n => {
        const nodePath = (n as unknown as { path?: string }).path ?? '';
        return nodePath === refFile || nodePath.endsWith(refFile) || refFile.endsWith(nodePath);
      });
      if (matchedNode) {
        setSelectedNode(matchedNode.id);
        setFocusNode(matchedNode.id);
        toggleArchitecture();
        return;
      }
    }
    toggleArchitecture();
  }, [graph, setSelectedNode, setFocusNode, toggleArchitecture]);

  // ── Enrich with AI ───────────────────────────────────────────────────────
  const handleEnrich = useCallback(async () => {
    if (!projectPath || !graph || enriching) return;
    setEnriching(true);
    setEnrichError(null);
    try {
      const graphJson = JSON.stringify(graph);
      const raw = await invoke<string>('generate_analysis', { path: projectPath, graphJson });
      if (isMounted.current) {
        setAnalysis(JSON.parse(raw) as Analysis);
        setEnriching(false);
      }
    } catch (err) {
      const msg = String(err);
      if (isMounted.current) {
        setEnrichError(msg.includes('NO_API_KEY')
          ? 'Sin clave API. Configura tu clave en el panel de chat (⚙).'
          : `Error al redactar: ${msg}`);
        setEnriching(false);
      }
    }
  }, [projectPath, graph, enriching, invoke]);

  // ── Refresh ──────────────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    if (!projectPath || !graph) return;
    setLoading(true);
    setError(null);
    setEnrichError(null);
    setAnalysis(null);
    try {
      const graphJson = JSON.stringify(graph);
      const raw = await invoke<string>('generate_analysis', { path: projectPath, graphJson });
      if (isMounted.current) {
        setAnalysis(JSON.parse(raw) as Analysis);
        setLoading(false);
      }
    } catch (err) {
      if (isMounted.current) {
        setError(`Error al actualizar: ${err}`);
        setLoading(false);
      }
    }
  }, [projectPath, graph, invoke]);

  if (!isArchitectureOpen) return null;

  // ── Build layout data ────────────────────────────────────────────────────
  const comps = analysis?.components ?? [];
  const rels = analysis?.components_relations ?? [];
  const BYID = new Map<string, AnalysisComponent>(comps.map(c => [cid(c), c]));
  const hasRelations = rels.length > 0;

  // Topo levels (used when relations exist)
  const levelMap = hasRelations ? assignLevels(comps, rels) : new Map<string, number>();
  const maxLevel = levelMap.size ? Math.max(...levelMap.values()) : 0;

  // Content-type groups (used when NO relations)
  const GROUP_ORDER: ContentGroup[] = ['Código', 'Datos', 'Documentación', 'Otros'];
  const contentGroups: Map<ContentGroup, AnalysisComponent[]> = new Map();
  if (!hasRelations && comps.length > 0) {
    for (const comp of comps) {
      const g = contentGroup(comp);
      if (!contentGroups.has(g)) contentGroups.set(g, []);
      contentGroups.get(g)!.push(comp);
    }
  }

  const projectName = projectPath?.split(/[\\/]/).filter(Boolean).pop() ?? 'Project';

  const detailComp = detailCid ? BYID.get(detailCid) : null;
  const detailOuts = detailCid ? rels.filter(r => String(r.src_id) === detailCid) : [];
  const detailIns  = detailCid ? rels.filter(r => String(r.dst_id) === detailCid) : [];

  // ── Chip renderer (text vs binary) ──────────────────────────────────────
  const renderChip = (e: KeyEntity, i: number, closeDetailFirst?: boolean) => {
    const binary = isBinaryFile(e.reference_file);
    if (binary) {
      // Binary: dimmed, cursor default, no pointer, tooltip "abrir en el explorador"
      return (
        <span
          key={i}
          className="arch-chip"
          data-f={e.reference_file}
          data-l={String(e.reference_start_line ?? 1)}
          data-e={String(e.reference_end_line ?? 1)}
          data-binary="1"
          style={css.chipBinary}
          title="abrir en el explorador"
          onClick={async (ev) => {
            ev.stopPropagation();
            if (closeDetailFirst) setDetailOpen(false);
            await revealBinary(e.reference_file);
          }}
        >
          {e.reference_file}
        </span>
      );
    }
    // Text: normal clickable chip
    return (
      <span
        key={i}
        className="arch-chip"
        data-f={e.reference_file}
        data-l={String(e.reference_start_line ?? 1)}
        data-e={String(e.reference_end_line ?? 1)}
        style={css.chip}
        title="ver código"
      >
        {e.reference_file}:{e.reference_start_line ?? 1}
      </span>
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* Main overlay */}
      <div style={css.overlay}>
        {/* Header */}
        <div style={css.header}>
          <h1 style={css.h1}>Organigrama — {projectName}</h1>
          <div style={css.headerActions}>
            {hasApiKey && (
              <button
                style={css.btnAccent}
                onClick={handleEnrich}
                disabled={enriching || loading || !graph}
                title="Re-generar con LLM (requiere clave API)"
              >
                {enriching ? '⏳ Redactando…' : '✦ Redactar con IA'}
              </button>
            )}
            <button
              style={css.btn}
              onClick={handleRefresh}
              disabled={loading || !graph}
              title="Regenerar organigrama (estático, sin LLM)"
            >
              ↺ Actualizar
            </button>
            <button
              style={{ ...css.btn, marginLeft: 6 }}
              onClick={toggleArchitecture}
              title="Cerrar (Esc)"
            >
              ✕ Cerrar
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={css.wrap}>
          {/* Meta / hint */}
          {analysis && (
            <>
              <div style={css.meta}>
                <b style={{ color: T.text }}>{comps.length}</b> componentes{' '}
                · <b style={{ color: T.text }}>{rels.length}</b> flujos{' '}
                · generado automáticamente por análisis estático + LLM
              </div>
              <div style={css.hint}>
                Clic en una tarjeta = ficha del componente y su flujo · clic en un archivo = código real · pasa el ratón para iluminar las flechas
              </div>
            </>
          )}

          {/* Enrich error */}
          {enrichError && <div style={css.errorBox}>{enrichError}</div>}

          {/* Loading */}
          {loading && (
            <div style={css.state}>
              <div>Analizando organigrama…</div>
              <div style={{ fontSize: 12, color: T.dim, marginTop: 8 }}>Construyendo mapa estático</div>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div style={css.state}>
              <div style={css.errorBox}>{error}</div>
            </div>
          )}

          {/* Empty */}
          {!loading && !error && !analysis && (
            <div style={css.state}>No hay datos de organigrama todavía.</div>
          )}

          {/* ── CASE A: Analysis with relations → topo levels + SVG wires ── */}
          {!loading && !error && analysis && hasRelations && (
            <div style={css.flowbox} ref={flowboxRef}>
              {/* SVG wires layer */}
              <svg
                ref={svgRef}
                style={css.wiresWrap}
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <marker
                    id="arch-arr"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path
                      d="M2 1L8 5L2 9"
                      fill="none"
                      stroke="#94a3b8"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </marker>
                </defs>
              </svg>

              {/* Flow levels */}
              <div style={css.flow}>
                {Array.from({ length: maxLevel + 1 }, (_, L) => {
                  const group = comps.filter(c => levelMap.get(cid(c)) === L);
                  if (!group.length) return null;
                  return (
                    <div
                      key={L}
                      style={{ ...css.level, ...(L > 0 ? css.levelGap : {}) }}
                    >
                      <span style={css.levelLabel}>
                        {LABELS[Math.min(L, LABELS.length - 1)]}
                      </span>
                      <div style={css.cards}>
                        {group.map(comp => {
                          const entities = comp.key_entities ?? [];
                          const cidStr = cid(comp);
                          return (
                            <div
                              key={cidStr}
                              className="arch-node"
                              data-cid={cidStr}
                              style={css.node}
                              onMouseEnter={e => {
                                (e.currentTarget as HTMLDivElement).style.background = T.cardHover;
                                (e.currentTarget as HTMLDivElement).style.borderColor = T.accent;
                                highlightWires(cidStr, true);
                              }}
                              onMouseLeave={e => {
                                (e.currentTarget as HTMLDivElement).style.background = T.card;
                                (e.currentTarget as HTMLDivElement).style.borderColor = T.border;
                                highlightWires(cidStr, false);
                              }}
                              onClick={async (e) => {
                                const chip = (e.target as HTMLElement).closest('.arch-chip') as HTMLElement | null;
                                if (chip) {
                                  e.stopPropagation();
                                  const isBin = chip.dataset.binary === '1';
                                  if (isBin) {
                                    await revealBinary(chip.dataset.f ?? '');
                                  } else {
                                    await handleChipClick(
                                      chip.dataset.f ?? '',
                                      parseInt(chip.dataset.l ?? '1', 10),
                                      parseInt(chip.dataset.e ?? '1', 10),
                                    );
                                  }
                                  return;
                                }
                                openDetail(cidStr);
                              }}
                            >
                              <div style={css.nodeH3}>{comp.name}</div>
                              <div style={css.nodeP}>
                                {(comp.description || '').slice(0, 140)}
                                {(comp.description || '').length > 140 ? '…' : ''}
                              </div>
                              <div style={css.nodeFiles}>
                                {entities.slice(0, 6).map((en, i) => renderChip(en, i))}
                              </div>
                              <div style={css.nodeMore}>ficha completa y flujo →</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── CASE B: Analysis with 0 relations → content-type grouping ── */}
          {!loading && !error && analysis && !hasRelations && comps.length > 0 && (
            <>
              <div style={css.noFlowNotice}>
                Sin flujos detectados — agrupación por tipo de contenido
              </div>
              <div style={css.flow}>
                {GROUP_ORDER.filter(g => contentGroups.has(g)).map((g, idx) => {
                  const group = contentGroups.get(g) ?? [];
                  return (
                    <div
                      key={g}
                      style={{ ...css.level, ...(idx > 0 ? css.levelGap : {}) }}
                    >
                      <span style={css.levelLabel}>{g}</span>
                      <div style={css.cards}>
                        {group.map(comp => {
                          const entities = comp.key_entities ?? [];
                          const cidStr = cid(comp);
                          return (
                            <div
                              key={cidStr}
                              className="arch-node"
                              data-cid={cidStr}
                              style={css.node}
                              onMouseEnter={e => {
                                (e.currentTarget as HTMLDivElement).style.background = T.cardHover;
                                (e.currentTarget as HTMLDivElement).style.borderColor = T.accent;
                              }}
                              onMouseLeave={e => {
                                (e.currentTarget as HTMLDivElement).style.background = T.card;
                                (e.currentTarget as HTMLDivElement).style.borderColor = T.border;
                              }}
                              onClick={async (e) => {
                                const chip = (e.target as HTMLElement).closest('.arch-chip') as HTMLElement | null;
                                if (chip) {
                                  e.stopPropagation();
                                  const isBin = chip.dataset.binary === '1';
                                  if (isBin) {
                                    await revealBinary(chip.dataset.f ?? '');
                                  } else {
                                    await handleChipClick(
                                      chip.dataset.f ?? '',
                                      parseInt(chip.dataset.l ?? '1', 10),
                                      parseInt(chip.dataset.e ?? '1', 10),
                                    );
                                  }
                                  return;
                                }
                                openDetail(cidStr);
                              }}
                            >
                              <div style={css.nodeH3}>{comp.name}</div>
                              <div style={css.nodeP}>
                                {(comp.description || '').slice(0, 140)}
                                {(comp.description || '').length > 140 ? '…' : ''}
                              </div>
                              <div style={css.nodeFiles}>
                                {entities.slice(0, 6).map((en, i) => renderChip(en, i))}
                              </div>
                              <div style={css.nodeMore}>ficha completa →</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* "El flujo, paso a paso" — only when relations exist */}
          {!loading && !error && analysis && rels.length > 0 && (
            <div style={css.rels}>
              <h2 style={css.relsH2}>El flujo, paso a paso</h2>
              {rels.map((r, i) => {
                const srcComp = BYID.get(String(r.src_id));
                const dstComp = BYID.get(String(r.dst_id));
                return (
                  <div key={i} style={css.rel}>
                    <span style={css.relPair}>
                      {srcComp?.name ?? r.src_name ?? String(r.src_id)}
                      <span style={css.relArrow}> → </span>
                      {dstComp?.name ?? r.dst_name ?? String(r.dst_id)}
                    </span>
                    <span style={css.relWhat}>{r.relation}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Code viewer overlay ──────────────────────────────────────────── */}
      {viewerOpen && (
        <div
          style={css.modalOverlay}
          onClick={e => { if (e.target === e.currentTarget) setViewerOpen(false); }}
        >
          <div style={css.viewer}>
            <div style={css.viewerBar}>
              <span>
                {viewerPath}
                {viewerStart > 0 ? `  ·  líneas ${viewerStart}–${viewerEnd}` : ''}
              </span>
              <button style={css.viewerClose} onClick={() => setViewerOpen(false)}>
                ✕ Cerrar
              </button>
            </div>
            <pre style={css.viewerPre}>
              {viewerLoading && (
                <span style={{ display: 'block', padding: '0 16px', color: T.muted }}>Cargando…</span>
              )}
              {!viewerLoading && !viewerCode && (
                <span style={{ display: 'block', padding: '0 16px', color: '#dc2626' }}>
                  No se pudo cargar el archivo.
                </span>
              )}
              {!viewerLoading && viewerCode && (() => {
                const lines = viewerCode.split('\n');
                return lines.map((line, i) => {
                  const n = i + 1;
                  const hl = viewerStart && n >= viewerStart && n <= viewerEnd;
                  return (
                    <span
                      key={n}
                      id={`arch-L${n}`}
                      ref={el => {
                        if (el) lineRefs.current.set(n, el);
                        else lineRefs.current.delete(n);
                      }}
                      style={{
                        display: 'block',
                        padding: '0 16px 0 0',
                        whiteSpace: 'pre',
                        // Highlighted line: #dbeafe (accentSoft), normal: transparent
                        background: hl ? '#dbeafe' : 'transparent',
                      }}
                    >
                      <span style={{
                        display: 'inline-block', width: 52, textAlign: 'right',
                        paddingRight: 14, color: T.dim, userSelect: 'none',
                      }}>
                        {n}
                      </span>
                      {line}
                    </span>
                  );
                });
              })()}
            </pre>
          </div>
        </div>
      )}

      {/* ── Component detail overlay ─────────────────────────────────────── */}
      {detailOpen && detailComp && (
        <div
          style={css.modalOverlay}
          onClick={e => { if (e.target === e.currentTarget) setDetailOpen(false); }}
        >
          <div style={css.detail}>
            <div style={css.detailBar}>
              <h2 style={css.detailH2}>{detailComp.name}</h2>
              <button style={css.detailClose} onClick={() => setDetailOpen(false)}>
                ✕ Cerrar
              </button>
            </div>
            <div style={css.detailBody}>
              <p style={css.detailDesc}>{detailComp.description}</p>

              {/* Files */}
              {(detailComp.key_entities ?? []).length > 0 && (
                <>
                  <div style={css.detailH4}>
                    Archivos ({(detailComp.key_entities ?? []).length})
                  </div>
                  <div style={css.detailFiles}>
                    {(detailComp.key_entities ?? []).map((e, i) => {
                      const binary = isBinaryFile(e.reference_file);
                      if (binary) {
                        return (
                          <span
                            key={i}
                            style={{ ...css.chipBinary, cursor: 'default' }}
                            title="abrir en el explorador"
                            onClick={async () => {
                              setDetailOpen(false);
                              await revealBinary(e.reference_file);
                            }}
                          >
                            {e.reference_file}
                          </span>
                        );
                      }
                      return (
                        <button
                          key={i}
                          style={css.chip}
                          title="ver código"
                          onClick={() => {
                            setDetailOpen(false);
                            void openFile(
                              e.reference_file,
                              e.reference_start_line ?? 1,
                              e.reference_end_line ?? 1,
                            );
                          }}
                        >
                          {e.reference_file}:{e.reference_start_line ?? 1}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Outgoing */}
              {detailOuts.length > 0 && (
                <>
                  <div style={css.detailH4}>Llama a / envía →</div>
                  {detailOuts.map((r, i) => {
                    const dst = BYID.get(String(r.dst_id));
                    return (
                      <div key={i} style={css.flowline}>
                        <span style={css.flowlineDir}>→</span>
                        <span style={css.flowlineWho}>{dst?.name ?? r.dst_name ?? String(r.dst_id)}</span>
                        <span style={css.flowlineWhat}>{r.relation}</span>
                      </div>
                    );
                  })}
                </>
              )}

              {/* Incoming */}
              {detailIns.length > 0 && (
                <>
                  <div style={css.detailH4}>Recibe de ←</div>
                  {detailIns.map((r, i) => {
                    const src = BYID.get(String(r.src_id));
                    return (
                      <div key={i} style={css.flowline}>
                        <span style={css.flowlineDir}>←</span>
                        <span style={css.flowlineWho}>{src?.name ?? r.src_name ?? String(r.src_id)}</span>
                        <span style={css.flowlineWhat}>{r.relation}</span>
                      </div>
                    );
                  })}
                </>
              )}

              {!detailOuts.length && !detailIns.length && (
                <div style={css.detailH4}>Sin flujos detectados</div>
              )}

              {/* Ver en el grafo */}
              {graph && (detailComp.key_entities ?? []).length > 0 && (
                <button
                  style={css.viewInGraph}
                  onClick={() => {
                    setDetailOpen(false);
                    viewInGraph(detailComp);
                  }}
                >
                  Ver en el grafo →
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
