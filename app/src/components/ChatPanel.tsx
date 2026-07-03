import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppStore } from '../stores/appStore';

/**
 * M4 — Chat with Claude, NotebookLM-style. Right-side panel toggled from the
 * Toolbar. Sends the user's question + the CURRENTLY-VISIBLE graph JSON to the
 * `ask_claude` Tauri command (which builds a grounded context and calls the
 * Anthropic API using the user's key from Settings — never hardcoded).
 *
 * ★ Clickable citations: Claude is instructed to cite `entity_id`s in backticks.
 * We parse the answer, and any backtick token that matches a node id in the
 * current graph is rendered as a button that SELECTS + CENTERS that node via the
 * M1 machinery (setSelectedNode + setFocusNode → GraphCanvas camera.animate).
 *
 * Coherence with M2/M3: we send `graph` from the store, which is whatever is on
 * screen — live (M2) or a historical snapshot (M3). So in historical mode the
 * chat reasons about the snapshot you are viewing. Documented here + in the plan.
 */

interface ChatMessage {
  role: 'user' | 'assistant' | 'error';
  text: string;
}

interface ApiKeyStatus {
  configured: boolean;
  hint: string;
}

export const ChatPanel: React.FC = () => {
  const { isChatOpen, toggleChat, graph, setSelectedNode, setFocusNode } = useAppStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus>({ configured: false, hint: '' });
  const [showSettings, setShowSettings] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Set of node ids in the current graph — used to only linkify REAL entities.
  const nodeIds = useMemo(() => {
    const s = new Set<string>();
    for (const n of graph?.nodes ?? []) if (n.id) s.add(n.id);
    return s;
  }, [graph]);

  // Load API key status whenever the panel opens.
  const refreshKeyStatus = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const st = await invoke<ApiKeyStatus>('get_api_key_status');
      setKeyStatus(st);
      // If no key, surface Settings immediately.
      if (!st.configured) setShowSettings(true);
    } catch {
      setKeyStatus({ configured: false, hint: '' });
    }
  }, []);

  useEffect(() => {
    if (isChatOpen) void refreshKeyStatus();
  }, [isChatOpen, refreshKeyStatus]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const saveKey = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_api_key', { key: keyInput });
      setKeyInput('');
      await refreshKeyStatus();
      setShowSettings(false);
    } catch (err) {
      setMessages(m => [...m, { role: 'error', text: `Could not save key: ${err}` }]);
    }
  }, [keyInput, refreshKeyStatus]);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || busy) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', text: question }]);
    setBusy(true);

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // Send the currently-visible graph as context (live or historical snapshot).
      const graphJson = graph ? JSON.stringify(graph) : '{"nodes":[],"edges":[]}';
      const answer = await invoke<string>('ask_claude', { question, graphJson });
      setMessages(m => [...m, { role: 'assistant', text: answer }]);
    } catch (err) {
      const msg = String(err);
      if (msg.includes('NO_API_KEY')) {
        setMessages(m => [...m, {
          role: 'error',
          text: 'No Anthropic API key configured. Open Settings (gear icon) and paste your key to use chat.',
        }]);
        setShowSettings(true);
      } else {
        setMessages(m => [...m, { role: 'error', text: msg }]);
      }
    } finally {
      setBusy(false);
    }
  }, [input, busy, graph]);

  // Focus + select a cited node using the M1 machinery.
  const focusNode = useCallback((id: string) => {
    setSelectedNode(id);
    setFocusNode(id);
  }, [setSelectedNode, setFocusNode]);

  if (!isChatOpen) return null;

  const styles: Record<string, React.CSSProperties> = {
    panel: {
      position: 'fixed',
      top: 48,
      right: 0,
      bottom: 28,
      width: 380,
      background: 'var(--panel)',
      borderLeft: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 210,
      boxShadow: '-4px 0 24px rgba(0,0,0,0.06)',
    },
    header: {
      height: 44,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 12px',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
    },
    title: {
      display: 'flex', alignItems: 'center', gap: 7,
      fontSize: 13, fontWeight: 600, color: 'var(--text)',
    },
    headerBtns: { display: 'flex', alignItems: 'center', gap: 4 },
    iconBtn: {
      width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent',
      color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14,
    },
    body: { flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 },
    empty: { color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', marginTop: 40, lineHeight: 1.6 },
    msgUser: {
      alignSelf: 'flex-end', maxWidth: '85%', background: 'var(--accent)', color: '#fff',
      padding: '8px 12px', borderRadius: '12px 12px 2px 12px', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap',
    },
    msgAssistant: {
      alignSelf: 'flex-start', maxWidth: '92%', background: 'var(--bg)', color: 'var(--text)',
      border: '1px solid var(--border)', padding: '8px 12px', borderRadius: '12px 12px 12px 2px',
      fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap',
    },
    msgError: {
      alignSelf: 'stretch', background: 'var(--danger-dim)', color: 'var(--danger)',
      border: '1px solid rgba(220,38,38,0.3)', padding: '8px 12px', borderRadius: 8,
      fontSize: 12, lineHeight: 1.5,
    },
    citation: {
      display: 'inline', background: 'var(--accent-dim)', color: 'var(--accent)',
      border: 'none', padding: '1px 5px', borderRadius: 4, fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', cursor: 'pointer',
    },
    codeInline: {
      background: 'rgba(0,0,0,0.05)', padding: '1px 5px', borderRadius: 4,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12,
    },
    footer: { borderTop: '1px solid var(--border)', padding: 10, flexShrink: 0 },
    inputRow: { display: 'flex', gap: 6, alignItems: 'flex-end' },
    textarea: {
      flex: 1, resize: 'none', border: '1px solid var(--border)', borderRadius: 8,
      padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg)',
      color: 'var(--text)', outline: 'none', maxHeight: 120, minHeight: 38,
    },
    sendBtn: {
      height: 38, padding: '0 14px', borderRadius: 8, border: 'none',
      background: busy ? 'var(--text-dim)' : 'var(--accent)', color: '#fff',
      fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer', flexShrink: 0,
    },
    settings: { padding: 12, borderBottom: '1px solid var(--border)', background: 'var(--bg)', flexShrink: 0 },
    settingsLabel: { fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 6, display: 'block' },
    settingsHint: { fontSize: 11, color: 'var(--text-dim)', marginBottom: 8, lineHeight: 1.5 },
    keyInput: {
      width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px',
      fontSize: 12, fontFamily: 'ui-monospace, monospace', background: 'var(--panel)',
      color: 'var(--text)', outline: 'none', marginBottom: 8, boxSizing: 'border-box',
    },
    settingsBtns: { display: 'flex', gap: 6 },
    saveBtn: {
      padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--accent)',
      color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
    },
    statusPill: {
      fontSize: 10, padding: '2px 7px', borderRadius: 10,
      background: keyStatus.configured ? 'var(--success-dim)' : 'var(--danger-dim)',
      color: keyStatus.configured ? 'var(--success)' : 'var(--danger)',
    },
  };

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <div style={styles.title}>
          <span>💬</span>
          <span>Ask Claude</span>
          <span style={styles.statusPill}>
            {keyStatus.configured ? `key ${keyStatus.hint}` : 'no key'}
          </span>
        </div>
        <div style={styles.headerBtns}>
          <button style={styles.iconBtn} title="Settings" onClick={() => setShowSettings(s => !s)}>⚙</button>
          <button style={styles.iconBtn} title="Close" onClick={toggleChat}>✕</button>
        </div>
      </div>

      {showSettings && (
        <div style={styles.settings}>
          <label style={styles.settingsLabel}>Anthropic API key</label>
          <div style={styles.settingsHint}>
            Stored locally in your user settings (~/.registry-app/settings.json), never in the project or git.
            {keyStatus.configured && ` Currently set (${keyStatus.hint}).`}
          </div>
          <input
            style={styles.keyInput}
            type="password"
            placeholder="sk-ant-..."
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void saveKey(); }}
          />
          <div style={styles.settingsBtns}>
            <button style={styles.saveBtn} onClick={saveKey}>Save key</button>
            {keyStatus.configured && (
              <button
                style={{ ...styles.saveBtn, background: 'transparent', color: 'var(--danger)', border: '1px solid var(--border)' }}
                onClick={async () => {
                  const { invoke } = await import('@tauri-apps/api/core');
                  await invoke('set_api_key', { key: '' });
                  await refreshKeyStatus();
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      <div style={styles.body} ref={scrollRef}>
        {messages.length === 0 && (
          <div style={styles.empty}>
            Ask about this folder.<br />
            e.g. &ldquo;What are the main modules?&rdquo;,<br />
            &ldquo;What depends on the indexer?&rdquo;<br /><br />
            Claude cites <span style={styles.codeInline}>entity_id</span>s — click one to focus that node.
          </div>
        )}
        {messages.map((m, i) => {
          if (m.role === 'user') return <div key={i} style={styles.msgUser}>{m.text}</div>;
          if (m.role === 'error') return <div key={i} style={styles.msgError}>{m.text}</div>;
          return <div key={i} style={styles.msgAssistant}>{renderWithCitations(m.text, nodeIds, focusNode, styles)}</div>;
        })}
        {busy && <div style={styles.msgAssistant}><em style={{ color: 'var(--text-dim)' }}>Claude is thinking…</em></div>}
      </div>

      <div style={styles.footer}>
        <div style={styles.inputRow}>
          <textarea
            style={styles.textarea}
            placeholder="Ask about this folder…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
            }}
            rows={1}
          />
          <button style={styles.sendBtn} onClick={send} disabled={busy}>Send</button>
        </div>
      </div>
    </div>
  );
};

/**
 * Render assistant text, turning backtick-quoted tokens that are REAL node ids
 * into clickable citations (click → focus that node). Non-entity backtick tokens
 * render as plain inline code. This is the NotebookLM citation→node-centering link.
 */
function renderWithCitations(
  text: string,
  nodeIds: Set<string>,
  onCite: (id: string) => void,
  styles: Record<string, React.CSSProperties>,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Split on backtick-delimited spans, keeping the delimiters' content.
  const regex = /`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>);
    }
    const token = match[1];
    if (nodeIds.has(token)) {
      parts.push(
        <button
          key={key++}
          style={styles.citation}
          title={`Focus ${token}`}
          onClick={() => onCite(token)}
        >
          {token}
        </button>
      );
    } else {
      parts.push(<code key={key++} style={styles.codeInline}>{token}</code>);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  }
  return parts;
}
