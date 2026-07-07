// v2.2 — "NotebookLM in 2 clicks" wizard.
//
// Turns the previously engineer-only flow (understand digests, pick a Drive
// folder, know about auto-sync, add a source in NotebookLM) into a guided
// 3-step overlay. The app does the work; the user sees at most 2 clicks:
//   1. "Connect" (Drive folder is auto-detected and pre-shown)
//   2. after the guide screen, "Done" (they added the source once, forever)
// Reopening the button later just re-exports + shows the synced state.

import React, { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../stores/appStore';

type AnyStyle = React.CSSProperties;

interface NbState {
  drive_detected: string | null;
  digest_dir: string;
  connected: boolean;
  // v2.4 — Open Notebook (Vía C, self-hosted).
  on_url: string;
  on_notebook_id: string;
  on_connected: boolean;
  on_default_url: string;
}

interface NotebookInfo {
  id: string;
  name: string;
}

interface Props {
  onClose: () => void;
}

export const NotebookLmWizard: React.FC<Props> = ({ onClose }) => {
  const { graph, projectPath } = useAppStore();
  const [state, setState] = useState<NbState | null>(null);
  const [step, setStep] = useState<
    'loading' | 'connect' | 'guide' | 'done' | 'on-connect' | 'on-done' | 'error'
  >('loading');
  const [dir, setDir] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');
  // v2.4 — Open Notebook connection state.
  const [onUrl, setOnUrl] = useState<string>('');
  const [onNotebooks, setOnNotebooks] = useState<NotebookInfo[]>([]);
  const [onNotebookId, setOnNotebookId] = useState<string>('');
  const [onError, setOnError] = useState<string>('');

  // Load wizard state once (auto-detected Drive folder + prior completion).
  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const s = await invoke<NbState>('nb_get_state');
        setState(s);
        const initial = s.digest_dir || s.drive_detected || '';
        setDir(initial);
        setOnUrl(s.on_url || s.on_default_url || 'http://127.0.0.1:5055');
        setOnNotebookId(s.on_notebook_id || '');
        // Priority: an already-connected Open Notebook wins the "done" screen,
        // then the Google/Drive connection, then the choice screen.
        setStep(s.on_connected ? 'on-done' : s.connected ? 'done' : 'connect');
      } catch (e) {
        setError(String(e));
        setStep('error');
      }
    })();
  }, []);

  const pickFolder = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const chosen = await invoke<string | null>('pick_digest_dir');
      if (chosen) setDir(chosen);
    } catch {
      /* cancelled — ignore */
    }
  }, []);

  // Step 1 → export the digest into the (Drive) folder + open NotebookLM,
  // then show the one-time guide.
  const connect = useCallback(async () => {
    if (busy || !graph) return;
    setBusy(true);
    setError('');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const graphJson = JSON.stringify(graph);
      const path = projectPath ?? graph.projectPath ?? '';
      // Write the digest into the chosen Drive-synced folder.
      await invoke<string>('export_digest', { path, graphJson, destDir: dir });
      // Open NotebookLM so the user can add the source once.
      await invoke('open_notebooklm');
      setStep('guide');
    } catch (e) {
      setError(String(e));
      setStep('error');
    } finally {
      setBusy(false);
    }
  }, [busy, graph, projectPath, dir]);

  // Step 2 → user confirms they added the source. Persist "connected".
  const finish = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('nb_set_connected', { connected: true });
      setStep('done');
    } catch (e) {
      setError(String(e));
      setStep('error');
    }
  }, []);

  // Re-export on demand from the "done" screen (keeps the same file → auto-sync).
  const reExport = useCallback(async () => {
    if (busy || !graph) return;
    setBusy(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const graphJson = JSON.stringify(graph);
      const path = projectPath ?? graph.projectPath ?? '';
      await invoke<string>('export_digest', { path, graphJson, destDir: dir });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, graph, projectPath, dir]);

  // ── v2.4 — Open Notebook (Vía C) ──────────────────────────────

  // Probe the instance and list its notebooks. ON_UNREACHABLE → friendly hint.
  const onFind = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setOnError('');
    setOnNotebooks([]);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const list = await invoke<NotebookInfo[]>('on_list_notebooks', { url: onUrl });
      setOnNotebooks(list);
      if (list.length === 0) {
        setOnError('Instance found, but it has no notebooks yet — create one in Open Notebook first.');
      } else if (!list.some((n) => n.id === onNotebookId)) {
        setOnNotebookId(list[0].id);
      }
    } catch (e) {
      const msg = String(e);
      setOnError(
        msg.startsWith('ON_UNREACHABLE')
          ? `No Open Notebook instance answered at ${onUrl}. Make sure it is running (see github.com/lfnovo/open-notebook), then retry.`
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }, [busy, onUrl, onNotebookId]);

  // Push the digest into the chosen notebook and persist the connection.
  const onConnect = useCallback(async () => {
    if (busy || !graph || !onNotebookId) return;
    setBusy(true);
    setOnError('');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const graphJson = JSON.stringify(graph);
      const path = projectPath ?? graph.projectPath ?? '';
      await invoke<string>('on_connect', { url: onUrl, notebookId: onNotebookId, path, graphJson });
      setStep('on-done');
    } catch (e) {
      setOnError(String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, graph, projectPath, onUrl, onNotebookId]);

  // Re-push from the done screen (replaces the previous digest source).
  const onPush = useCallback(async () => {
    if (busy || !graph) return;
    setBusy(true);
    setOnError('');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const graphJson = JSON.stringify(graph);
      const path = projectPath ?? graph.projectPath ?? '';
      await invoke<string>('on_push', { path, graphJson });
    } catch (e) {
      setOnError(String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, graph, projectPath]);

  const s: Record<string, AnyStyle> = {
    overlay: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
    card: {
      width: 460, maxWidth: '90vw', background: 'var(--panel)',
      border: '1px solid var(--border)', borderRadius: 12, padding: 24,
      boxShadow: '0 12px 48px rgba(0,0,0,0.4)', color: 'var(--text)',
    },
    title: { fontSize: 18, fontWeight: 700, marginBottom: 6 },
    sub: { fontSize: 13, color: 'var(--text-dim)', marginBottom: 18, lineHeight: 1.5 },
    driveBox: {
      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
      background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
      fontSize: 13, marginBottom: 8, wordBreak: 'break-all',
    },
    row: { display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' },
    btn: {
      padding: '9px 18px', borderRadius: 8, border: '1px solid var(--border)',
      background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 13,
    },
    btnPrimary: {
      padding: '9px 20px', borderRadius: 8, border: 'none',
      background: '#2563eb', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    },
    link: { color: '#2563eb', cursor: 'pointer', textDecoration: 'underline' },
    steps: { fontSize: 13, lineHeight: 1.7, margin: '4px 0 8px', paddingLeft: 18 },
    ok: { color: '#16a34a', fontWeight: 600 },
    err: { color: '#dc2626', fontSize: 13, marginTop: 10 },
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.card} onClick={(e) => e.stopPropagation()}>
        {step === 'loading' && <div style={s.sub}>Loading…</div>}

        {step === 'connect' && (
          <>
            <div style={s.title}>🧠 Connect this folder to NotebookLM</div>
            <div style={s.sub}>
              The app saves a living summary of this folder into your Google Drive.
              NotebookLM keeps it up to date automatically — you can then chat with
              your project, get audio overviews, and more.
            </div>
            {state?.drive_detected ? (
              <div style={s.driveBox}>
                ✅ <span>Google Drive found:&nbsp;<b>{dir}</b></span>
              </div>
            ) : (
              <div style={{ ...s.sub, marginBottom: 8 }}>
                Couldn’t auto-detect Google Drive. Choose the folder Drive syncs:
              </div>
            )}
            <div style={{ fontSize: 12 }}>
              <span style={s.link} onClick={pickFolder}>Choose a different folder…</span>
            </div>
            <div style={{ fontSize: 12, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              Prefer a private, self-hosted alternative (no Google)?{' '}
              <span style={s.link} onClick={() => setStep('on-connect')}>
                Connect to Open Notebook →
              </span>
            </div>
            <div style={s.row}>
              <button style={s.btn} onClick={onClose}>Cancel</button>
              <button style={s.btnPrimary} onClick={connect} disabled={busy || !dir}>
                {busy ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </>
        )}

        {step === 'on-connect' && (
          <>
            <div style={s.title}>📓 Connect to Open Notebook</div>
            <div style={s.sub}>
              Open Notebook is a self-hosted NotebookLM alternative you run yourself
              (locally or on your server). The app pushes this folder’s living summary
              straight into one of your notebooks — no Google, no manual steps.
            </div>
            <input
              style={{
                width: '100%', boxSizing: 'border-box', padding: '9px 12px',
                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
                color: 'var(--text)', fontSize: 13, marginBottom: 8,
              }}
              value={onUrl}
              onChange={(e) => setOnUrl(e.target.value)}
              placeholder="http://127.0.0.1:5055"
              spellCheck={false}
            />
            {onNotebooks.length > 0 && (
              <select
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
                  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
                  color: 'var(--text)', fontSize: 13, marginBottom: 8,
                }}
                value={onNotebookId}
                onChange={(e) => setOnNotebookId(e.target.value)}
              >
                {onNotebooks.map((n) => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </select>
            )}
            {onError && <div style={s.err}>{onError}</div>}
            <div style={s.row}>
              <button style={s.btn} onClick={() => setStep('connect')}>Back</button>
              {onNotebooks.length === 0 ? (
                <button style={s.btnPrimary} onClick={onFind} disabled={busy || !onUrl.trim()}>
                  {busy ? 'Looking…' : 'Find notebooks'}
                </button>
              ) : (
                <button style={s.btnPrimary} onClick={onConnect} disabled={busy || !onNotebookId}>
                  {busy ? 'Connecting…' : 'Connect'}
                </button>
              )}
            </div>
          </>
        )}

        {step === 'on-done' && (
          <>
            <div style={s.title}>📓 Open Notebook <span style={s.ok}>connected</span></div>
            <div style={s.sub}>
              This folder’s summary was pushed into your notebook. Use “Update now”
              any time to replace it with the latest changes — the previous version
              is cleaned up automatically.
            </div>
            <div style={s.driveBox}>
              🔗 <span>{state?.on_url || onUrl}</span>
            </div>
            {onError && <div style={s.err}>{onError}</div>}
            <div style={{ fontSize: 12, marginTop: 6 }}>
              <span style={s.link} onClick={() => { setOnNotebooks([]); setStep('on-connect'); }}>
                Change instance or notebook…
              </span>
            </div>
            <div style={s.row}>
              <button style={s.btn} onClick={onClose}>Close</button>
              <button style={s.btnPrimary} onClick={onPush} disabled={busy}>
                {busy ? 'Updating…' : 'Update now'}
              </button>
            </div>
          </>
        )}

        {step === 'guide' && (
          <>
            <div style={s.title}>One last step — just this once</div>
            <div style={s.sub}>
              We opened <b>notebooklm.google.com</b> and saved your summary to Drive.
              In NotebookLM, add it as a source once — after that it updates itself
              forever:
            </div>
            <ol style={s.steps}>
              <li>Open (or create) a notebook</li>
              <li>Click <b>➕ Add source → Google Drive</b></li>
              <li>Pick the file <b>registry-digest-…md</b></li>
            </ol>
            <div style={s.row}>
              <button style={s.btn} onClick={() => setStep('connect')}>Back</button>
              <button style={s.btnPrimary} onClick={finish}>Done ✓</button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <div style={s.title}>🧠 NotebookLM <span style={s.ok}>connected</span></div>
            <div style={s.sub}>
              Your summary syncs to Drive automatically. Re-export any time to push
              the latest changes; NotebookLM re-indexes the same file on its own.
            </div>
            <div style={s.driveBox}>📄 <span>{dir}</span></div>
            <div style={s.row}>
              <button style={s.btn} onClick={onClose}>Close</button>
              <button style={s.btnPrimary} onClick={reExport} disabled={busy}>
                {busy ? 'Updating…' : 'Update now'}
              </button>
            </div>
          </>
        )}

        {step === 'error' && (
          <>
            <div style={s.title}>Something went wrong</div>
            <div style={s.err}>{error}</div>
            <div style={s.row}>
              <button style={s.btn} onClick={onClose}>Close</button>
              <button style={s.btnPrimary} onClick={() => setStep('connect')}>Try again</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
