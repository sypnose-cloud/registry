#!/usr/bin/env bash
# =============================================================================
# Sypnose Registry — Portable Installer
# =============================================================================
#
# MIT License
# Copyright (c) 2026 Sypnose Cloud (https://sypnose.cloud)
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.
#
# =============================================================================
#
# What this does:
#   Installs the Sypnose Registry system on any Linux server (Ubuntu 20+/22+/24+,
#   Debian 11+). The Registry scans all code projects on the server, builds
#   SQLite databases of files/symbols/functions/edges/routes/env_vars, and serves:
#     - A REST API with per-project and cross-project graph data
#     - An HTML dashboard with 5 tabs (Projects, Services, CodeGraph, Topology, Gaps)
#     - Auto-refresh every 15 minutes via systemd timer
#
# Usage:
#   curl -fsSL https://registry.sypnose.cloud/install.sh | bash
#   # or
#   bash tmp_registry-install.sh
#
# Safe to run multiple times (idempotent).
#
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Colors & output helpers
# ---------------------------------------------------------------------------
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ -n "${TERM:-}" ] && [ "${TERM:-}" != "dumb" ]; then
  C_RESET="$(tput sgr0)"
  C_GREEN="$(tput setaf 2)"
  C_YELLOW="$(tput setaf 3)"
  C_RED="$(tput setaf 1)"
  C_BLUE="$(tput setaf 4)"
  C_CYAN="$(tput setaf 6)"
  C_BOLD="$(tput bold)"
  C_DIM="$(tput dim 2>/dev/null || true)"
else
  C_RESET="" ; C_GREEN="" ; C_YELLOW="" ; C_RED="" ; C_BLUE="" ; C_CYAN="" ; C_BOLD="" ; C_DIM=""
fi

ok()   { printf '  %s[OK]%s      %s\n' "$C_GREEN"  "$C_RESET" "$*"; }
info() { printf '  %s[INFO]%s    %s\n' "$C_BLUE"   "$C_RESET" "$*"; }
warn() { printf '  %s[WARN]%s    %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
fail() { printf '  %s[FAIL]%s    %s\n' "$C_RED"    "$C_RESET" "$*"; }
step() { printf '\n%s==> %s%s\n'       "$C_BOLD$C_CYAN" "$*" "$C_RESET"; }
die()  { fail "$*"; exit 1; }

banner() {
  printf '\n'
  printf '%s' "$C_BOLD$C_CYAN"
  cat <<'BANNER'
  ____            _     _
 |  _ \ ___  __ _(_)___| |_ _ __ _   _
 | |_) / _ \/ _` | / __| __| '__| | | |
 |  _ <  __/ (_| | \__ \ |_| |  | |_| |
 |_| \_\___|\__, |_|___/\__|_|   \__, |
             |___/                |___/
BANNER
  printf '%s' "$C_RESET"
  printf '  %sSypnose Registry — Universal Code Intelligence%s\n' "$C_DIM" "$C_RESET"
  printf '  %sv1.0.0 — Portable Installer%s\n\n' "$C_DIM" "$C_RESET"
}

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REGISTRY_DIR="${HOME}/.registry"
BACKSTAGE_DIR="${REGISTRY_DIR}/backstage-api"
DATA_DIR="${HOME}/.registry-data"
TRACE_INDEX="${HOME}/.trace-mcp/index"
API_PORT="${REGISTRY_PORT:-7009}"

# ---------------------------------------------------------------------------
# Step 1: System checks
# ---------------------------------------------------------------------------
banner

step "Step 1/8: System checks"

# OS detection
if [ -f /etc/os-release ]; then
  . /etc/os-release
  ok "OS: ${PRETTY_NAME:-${NAME:-Linux} ${VERSION_ID:-?}}"
else
  warn "Cannot detect OS (/etc/os-release missing). Proceeding anyway."
fi

# Architecture
ARCH="$(uname -m)"
ok "Architecture: ${ARCH}"

# User
if [ "$(id -u)" -eq 0 ]; then
  warn "Running as root. Systemd user services require --user (will use loginctl enable-linger)."
  IS_ROOT=1
else
  IS_ROOT=0
fi
ok "User: $(id -un) (uid=$(id -u))"

# ---------------------------------------------------------------------------
# Step 2: Install Node.js 20+ if missing
# ---------------------------------------------------------------------------
step "Step 2/8: Node.js 20+"

install_node() {
  info "Installing Node.js 20 via NodeSource..."

  if command -v curl >/dev/null 2>&1; then
    FETCH="curl -fsSL"
  elif command -v wget >/dev/null 2>&1; then
    FETCH="wget -qO-"
  else
    die "Neither curl nor wget found. Install one and retry."
  fi

  # Ensure prerequisites for NodeSource setup
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    if [ "$IS_ROOT" -eq 1 ]; then
      apt-get update -qq >/dev/null 2>&1 || true
      apt-get install -y -qq ca-certificates gnupg >/dev/null 2>&1 || true
    else
      sudo apt-get update -qq >/dev/null 2>&1 || true
      sudo apt-get install -y -qq ca-certificates gnupg >/dev/null 2>&1 || true
    fi
  fi

  # NodeSource setup script
  local setup_url="https://deb.nodesource.com/setup_20.x"
  if [ "$IS_ROOT" -eq 1 ]; then
    $FETCH "$setup_url" | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs >/dev/null 2>&1 || dnf install -y nodejs >/dev/null 2>&1
  else
    $FETCH "$setup_url" | sudo -E bash - >/dev/null 2>&1
    sudo apt-get install -y -qq nodejs >/dev/null 2>&1 || sudo dnf install -y nodejs >/dev/null 2>&1
  fi

  # Also install build tools for native modules (better-sqlite3)
  if command -v apt-get >/dev/null 2>&1; then
    if [ "$IS_ROOT" -eq 1 ]; then
      apt-get install -y -qq build-essential python3 >/dev/null 2>&1 || true
    else
      sudo apt-get install -y -qq build-essential python3 >/dev/null 2>&1 || true
    fi
  fi
}

NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node --version 2>/dev/null | sed 's/^v//')"
  NODE_MAJOR="${NODE_VER%%.*}"
  if [ "${NODE_MAJOR:-0}" -ge 20 ]; then
    ok "Node.js v${NODE_VER} (>= 20, good)"
    NODE_OK=1
  else
    warn "Node.js v${NODE_VER} is below 20. Upgrading..."
    install_node
  fi
else
  info "Node.js not found. Installing..."
  install_node
fi

# Verify after install
if [ "$NODE_OK" -eq 0 ]; then
  hash -r 2>/dev/null || true
  if command -v node >/dev/null 2>&1; then
    NODE_VER="$(node --version 2>/dev/null | sed 's/^v//')"
    ok "Node.js v${NODE_VER} installed"
    NODE_OK=1
  else
    die "Failed to install Node.js. Install manually: https://nodejs.org/en/download"
  fi
fi

if ! command -v npm >/dev/null 2>&1; then
  die "npm not found. It should come with Node.js. Reinstall Node.js."
fi
ok "npm v$(npm --version 2>/dev/null)"

# ---------------------------------------------------------------------------
# Step 3: npm global prefix (avoid EACCES)
# ---------------------------------------------------------------------------
step "Step 3/8: npm prefix & global tools"

NPM_GLOBAL_DIR="${HOME}/.npm-global"
if [ "$IS_ROOT" -eq 0 ]; then
  CURRENT_PREFIX="$(npm config get prefix 2>/dev/null)"
  case "$CURRENT_PREFIX" in
    /usr|/usr/local)
      info "Setting npm prefix to ${NPM_GLOBAL_DIR} (avoid EACCES)"
      mkdir -p "${NPM_GLOBAL_DIR}/bin" "${NPM_GLOBAL_DIR}/lib"
      npm config set prefix "${NPM_GLOBAL_DIR}" >/dev/null 2>&1 || true
      ;;
    *)
      NPM_GLOBAL_DIR="$CURRENT_PREFIX"
      ok "npm prefix: ${CURRENT_PREFIX} (OK)"
      ;;
  esac

  NPM_BIN="${NPM_GLOBAL_DIR}/bin"
  case ":${PATH}:" in
    *":${NPM_BIN}:"*) ;;
    *)
      export PATH="${NPM_BIN}:${PATH}"
      RC_FILE="${HOME}/.bashrc"
      [ -f "${HOME}/.zshrc" ] && RC_FILE="${HOME}/.zshrc"
      PATH_LINE='export PATH="'"${NPM_BIN}"':$PATH"'
      if ! grep -Fq "$NPM_BIN" "$RC_FILE" 2>/dev/null; then
        printf '\n# Sypnose Registry — npm global bin\n%s\n' "$PATH_LINE" >> "$RC_FILE" 2>/dev/null || true
        info "Added ${NPM_BIN} to PATH in ${RC_FILE}"
      fi
      ;;
  esac
fi

# Install trace-mcp globally
if command -v trace-mcp >/dev/null 2>&1; then
  ok "trace-mcp already installed ($(command -v trace-mcp))"
else
  info "Installing trace-mcp globally..."
  npm install -g trace-mcp >/dev/null 2>&1 || npm install -g trace-mcp 2>&1
  hash -r 2>/dev/null || true
  if command -v trace-mcp >/dev/null 2>&1; then
    ok "trace-mcp installed"
  else
    warn "trace-mcp install failed. The API will work but project indexing won't."
  fi
fi

# Rebuild better-sqlite3 if needed (for trace-mcp)
NPM_ROOT_G="$(npm root -g 2>/dev/null || true)"
if [ -n "$NPM_ROOT_G" ] && [ -d "${NPM_ROOT_G}/trace-mcp/node_modules/better-sqlite3" ]; then
  if ! node -e "require('${NPM_ROOT_G}/trace-mcp/node_modules/better-sqlite3')" >/dev/null 2>&1; then
    info "Rebuilding better-sqlite3 native bindings..."
    (cd "${NPM_ROOT_G}/trace-mcp" && npm rebuild better-sqlite3) >/dev/null 2>&1 || true
  fi
fi

# Install python3 + jq if needed (for scanner/classifier)
if ! command -v python3 >/dev/null 2>&1; then
  info "Installing python3..."
  if command -v apt-get >/dev/null 2>&1; then
    if [ "$IS_ROOT" -eq 1 ]; then
      apt-get install -y -qq python3 >/dev/null 2>&1
    else
      sudo apt-get install -y -qq python3 >/dev/null 2>&1
    fi
  fi
fi
if command -v python3 >/dev/null 2>&1; then
  ok "python3 $(python3 --version 2>&1 | awk '{print $2}')"
else
  warn "python3 not available. Scanner/classifier will not work."
fi

if ! command -v jq >/dev/null 2>&1; then
  info "Installing jq..."
  if command -v apt-get >/dev/null 2>&1; then
    if [ "$IS_ROOT" -eq 1 ]; then
      apt-get install -y -qq jq >/dev/null 2>&1
    else
      sudo apt-get install -y -qq jq >/dev/null 2>&1
    fi
  fi
fi
if command -v jq >/dev/null 2>&1; then
  ok "jq $(jq --version 2>/dev/null)"
fi

# ---------------------------------------------------------------------------
# Step 4: Create directory structure
# ---------------------------------------------------------------------------
step "Step 4/8: Directory structure"

mkdir -p "${BACKSTAGE_DIR}/routes"
mkdir -p "${BACKSTAGE_DIR}/public"
mkdir -p "${DATA_DIR}/graphs"
mkdir -p "${DATA_DIR}/logs"
mkdir -p "${TRACE_INDEX}"

ok "~/.registry/backstage-api/{routes,public}"
ok "~/.registry-data/{graphs,logs}"
ok "~/.trace-mcp/index"

# ---------------------------------------------------------------------------
# Step 5: Embed application files
# ---------------------------------------------------------------------------
step "Step 5/8: Writing application files"

# ---- package.json ----
cat > "${BACKSTAGE_DIR}/package.json" <<'PKGJSON'
{
  "name": "sypnose-registry-api",
  "version": "1.0.0",
  "description": "Sypnose Registry — Universal Code Intelligence API",
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "refresh": "node topology-builder.mjs"
  },
  "dependencies": {
    "express": "^4.21.0",
    "better-sqlite3": "^11.6.0",
    "cors": "^2.8.5"
  },
  "license": "MIT",
  "author": "Sypnose Cloud"
}
PKGJSON
ok "package.json"

# ---- server.js ----
cat > "${BACKSTAGE_DIR}/server.js" <<'SERVERJS'
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRegistryRouter } from './routes/registry.js';
import { createCodeGraphMultiRouter } from './routes/codegraph-multi.js';
import { createCodeGraphRouter } from './routes/codegraph.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.PORT || process.env.REGISTRY_PORT || '7009', 10);
const app = express();

app.use(cors());
app.use(express.json());

// --- Routes ---
app.use('/registry', createRegistryRouter());
app.use('/multi', createCodeGraphMultiRouter());
app.use('/codegraph', createCodeGraphRouter());

// --- Static files (dashboard) ---
app.use(express.static(join(__dirname, 'public')));

// --- Health check ---
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), port: PORT });
});

// --- Root redirect ---
app.get('/', (_req, res) => {
  res.redirect('/index.html');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Registry API] listening on http://0.0.0.0:${PORT}`);
  console.log(`[Registry API] dashboard: http://localhost:${PORT}/`);
  console.log(`[Registry API] routes: /registry /multi /codegraph /health`);
});
SERVERJS
ok "server.js"

# ---- routes/registry.js ----
cat > "${BACKSTAGE_DIR}/routes/registry.js" <<'REGISTRYJS'
import { Router } from 'express';
import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DATA_DIR = process.env.REGISTRY_DATA || join(homedir(), '.registry-data');

const SERVER_SCAN = 'server-scan.json';
const PROJECTS = 'projects.json';

function readJson(filename) {
  const filePath = join(DATA_DIR, filename);
  if (!existsSync(filePath)) {
    return { ok: false, missing: true, error: `no scan yet, run scanner (${filename} not found in ${DATA_DIR})` };
  }
  try {
    const raw = readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const mtimeMs = statSync(filePath).mtimeMs;
    return { ok: true, data, mtimeMs };
  } catch (e) {
    return { ok: false, error: `failed to read/parse ${filename}: ${e.message}` };
  }
}

function asProjectArray(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.projects)) return data.projects;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

export function createRegistryRouter() {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      service: 'registry',
      data_dir: DATA_DIR,
      endpoints: ['/', '/server', '/projects', '/saas', '/project/:name', '/summary'],
    });
  });

  router.get('/server', (_req, res) => {
    const r = readJson(SERVER_SCAN);
    if (!r.ok) return res.status(r.missing ? 404 : 500).json({ error: r.missing ? 'no scan yet, run scanner' : r.error });
    res.json(r.data);
  });

  router.get('/projects', (_req, res) => {
    const r = readJson(PROJECTS);
    if (!r.ok) return res.status(r.missing ? 404 : 500).json({ error: r.error });
    const projects = asProjectArray(r.data);
    res.json({ count: projects.length, projects });
  });

  router.get('/saas', (_req, res) => {
    const r = readJson(PROJECTS);
    if (!r.ok) return res.status(r.missing ? 404 : 500).json({ error: r.error });
    const saas = asProjectArray(r.data).filter(p => p && typeof p.type === 'string' && p.type.toLowerCase() === 'saas');
    res.json({ count: saas.length, projects: saas });
  });

  router.get('/project/:name', (req, res) => {
    const r = readJson(PROJECTS);
    if (!r.ok) return res.status(r.missing ? 404 : 500).json({ error: r.error });
    const wanted = String(req.params.name || '').toLowerCase();
    const project = asProjectArray(r.data).find(p => p && typeof p.name === 'string' && p.name.toLowerCase() === wanted);
    if (!project) return res.status(404).json({ error: `project not found: ${req.params.name}` });
    res.json(project);
  });

  router.get('/summary', (_req, res) => {
    const server = readJson(SERVER_SCAN);
    const projects = readJson(PROJECTS);
    if (!server.ok && !projects.ok) return res.status(404).json({ error: 'no scan yet, run scanner' });

    const projArr = projects.ok ? asProjectArray(projects.data) : [];
    const by_type = {};
    for (const p of projArr) {
      const t = p && typeof p.type === 'string' ? p.type.toLowerCase() : 'unknown';
      by_type[t] = (by_type[t] || 0) + 1;
    }
    for (const k of ['saas', 'api', 'bot', 'scraper', 'web']) {
      if (!(k in by_type)) by_type[k] = 0;
    }

    const sd = server.ok ? server.data : {};
    const services = sd.services ?? sd.processes ?? [];
    const repos = sd.repos ?? sd.repositories ?? [];
    const scanned_at = sd.scanned_at ?? sd.timestamp ?? sd.scannedAt ?? null;
    let data_age_seconds = null;
    if (server.ok && typeof server.mtimeMs === 'number') {
      data_age_seconds = Math.max(0, Math.round((Date.now() - server.mtimeMs) / 1000));
    }

    res.json({
      hostname: sd.hostname ?? null,
      n_services: Array.isArray(services) ? services.length : 0,
      n_repos: Array.isArray(repos) ? repos.length : 0,
      by_type, scanned_at, data_age_seconds,
      sources: {
        server_scan: server.ok ? 'ok' : (server.missing ? 'missing' : 'error'),
        projects: projects.ok ? 'ok' : (projects.missing ? 'missing' : 'error'),
      },
    });
  });

  return router;
}

export default createRegistryRouter;
REGISTRYJS
ok "routes/registry.js"

# ---- routes/codegraph-multi.js ----
cat > "${BACKSTAGE_DIR}/routes/codegraph-multi.js" <<'MULTIGRAPHJS'
import { Router } from 'express';
import Database from 'better-sqlite3';
import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

const INDEX_DIR = join(homedir(), '.trace-mcp', 'index');
const DATA_DIR = process.env.REGISTRY_DATA || join(homedir(), '.registry-data');

function listDbs() {
  try {
    return readdirSync(INDEX_DIR)
      .filter(f => f.endsWith('.db') && !f.endsWith('-shm') && !f.endsWith('-wal') && f !== 'topology.db')
      .map(f => {
        const name = f.replace(/-[a-f0-9]{12}\.db$/, '');
        return { name, db_path: join(INDEX_DIR, f), filename: f };
      });
  } catch { return []; }
}

function safeQueryDb(dbPath, sql, params = []) {
  try {
    const db = new Database(dbPath, { readonly: true });
    try { return db.prepare(sql).all(...params); }
    finally { db.close(); }
  } catch { return []; }
}

export function createCodeGraphMultiRouter() {
  const router = Router();

  router.get('/projects', (_req, res) => {
    try {
      const dbs = listDbs();
      const projects = dbs.map(d => {
        const files = safeQueryDb(d.db_path, 'SELECT count(*) as cnt FROM files')[0]?.cnt || 0;
        const symbols = safeQueryDb(d.db_path, 'SELECT count(*) as cnt FROM symbols')[0]?.cnt || 0;
        const edges = safeQueryDb(d.db_path, 'SELECT count(*) as cnt FROM edges')[0]?.cnt || 0;
        const routes = safeQueryDb(d.db_path, 'SELECT count(*) as cnt FROM routes')[0]?.cnt || 0;
        const mtime = statSync(d.db_path).mtimeMs;
        return { name: d.name, db: d.filename, stats: { files, symbols, edges, routes }, indexed_at: new Date(mtime).toISOString() };
      });
      res.json({ count: projects.length, projects });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/project/:name', (req, res) => {
    try {
      const dbs = listDbs();
      const wanted = req.params.name.toLowerCase();
      const d = dbs.find(x => x.name.toLowerCase() === wanted);
      if (!d) return res.status(404).json({ error: 'project not found: ' + req.params.name });

      const files = safeQueryDb(d.db_path, 'SELECT id, path, language FROM files ORDER BY path');
      const symbols = safeQueryDb(d.db_path, 'SELECT s.id, s.name, s.kind, s.fqn, f.path as file_path FROM symbols s LEFT JOIN files f ON s.file_id = f.id ORDER BY f.path, s.name');
      const edgeTypes = safeQueryDb(d.db_path, 'SELECT et.name, count(*) as cnt FROM edges e JOIN edge_types et ON e.edge_type_id = et.id GROUP BY et.name ORDER BY cnt DESC');
      const routes = safeQueryDb(d.db_path, 'SELECT method, uri, name, handler FROM routes ORDER BY uri');
      const envVars = safeQueryDb(d.db_path, 'SELECT key, value_type FROM env_vars ORDER BY key');

      res.json({
        name: d.name, db: d.filename,
        stats: { files: files.length, symbols: symbols.length, edge_types: edgeTypes, routes: routes.length, env_vars: envVars.length },
        files, symbols: symbols.slice(0, 500), edge_types: edgeTypes, routes, env_vars: envVars
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/graph', (_req, res) => {
    try {
      const dbs = listDbs();
      const nodes = [];
      const edges = [];

      for (const d of dbs) {
        const syms = safeQueryDb(d.db_path, `
          SELECT s.id, s.name, s.kind, f.path as file_path
          FROM symbols s LEFT JOIN files f ON s.file_id = f.id
          WHERE s.kind IN ('function','class','method','variable','constant','interface','type')
        `);
        for (const s of syms) {
          nodes.push({ id: d.name + '::' + (s.file_path || '') + '::' + s.name, label: s.name, kind: s.kind, project: d.name, file: s.file_path });
        }

        const edgeRows = safeQueryDb(d.db_path, `
          SELECT s_src.name as src_name, f_src.path as src_file,
                 s_tgt.name as tgt_name, f_tgt.path as tgt_file,
                 et.name as edge_type
          FROM edges e
          JOIN edge_types et ON e.edge_type_id = et.id
          JOIN nodes n_src ON e.source_node_id = n_src.id
          JOIN symbols s_src ON n_src.ref_id = s_src.id
          JOIN files f_src ON s_src.file_id = f_src.id
          JOIN nodes n_tgt ON e.target_node_id = n_tgt.id
          JOIN symbols s_tgt ON n_tgt.ref_id = s_tgt.id
          LEFT JOIN files f_tgt ON s_tgt.file_id = f_tgt.id
          WHERE et.name IN ('calls','imports','py_imports','py_inherits','fastapi_route','next_entry_point','next_renders_page','express_route','supabase_query')
        `);
        for (const e of edgeRows) {
          edges.push({
            source: d.name + '::' + (e.src_file || '') + '::' + e.src_name,
            target: d.name + '::' + (e.tgt_file || '') + '::' + e.tgt_name,
            type: e.edge_type, project: d.name
          });
        }
      }

      res.json({ nodes_count: nodes.length, edges_count: edges.length, nodes, edges });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/search', (req, res) => {
    try {
      const q = req.query.q;
      if (!q) return res.status(400).json({ error: 'query parameter q required' });
      const dbs = listDbs();
      const results = [];
      for (const d of dbs) {
        const matches = safeQueryDb(d.db_path, `
          SELECT s.name, s.kind, s.fqn, f.path as file_path
          FROM symbols s LEFT JOIN files f ON s.file_id = f.id
          WHERE s.name LIKE ? OR s.fqn LIKE ? LIMIT 20
        `, ['%' + q + '%', '%' + q + '%']);
        for (const m of matches) results.push({ ...m, project: d.name });
      }
      res.json({ query: q, count: results.length, results });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/topology', (_req, res) => {
    const topoPath = join(DATA_DIR, 'topology.json');
    if (!existsSync(topoPath)) return res.status(404).json({ error: 'topology.json not found. Run topology-builder first.' });
    try {
      const data = JSON.parse(readFileSync(topoPath, 'utf8'));
      res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/topology/project/:name', (req, res) => {
    const graphPath = join(DATA_DIR, 'graphs', req.params.name + '-graph.json');
    if (!existsSync(graphPath)) return res.status(404).json({ error: 'graph not found for: ' + req.params.name });
    try {
      const data = JSON.parse(readFileSync(graphPath, 'utf8'));
      res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/deep/:project', (req, res) => {
    try {
      const dbs = listDbs();
      const wanted = req.params.project.toLowerCase();
      const d = dbs.find(x => x.name.toLowerCase() === wanted);
      if (!d) return res.status(404).json({ error: 'project not found: ' + req.params.project });

      const nodes = [];
      const edges = [];

      const files = safeQueryDb(d.db_path, 'SELECT id, path, language FROM files ORDER BY path');
      for (const f of files) {
        nodes.push({ id: 'file::' + f.path, label: basename(f.path), group: 'file', meta: { path: f.path, language: f.language } });
      }

      const syms = safeQueryDb(d.db_path, `
        SELECT s.id, s.name, s.kind, f.path as file_path
        FROM symbols s LEFT JOIN files f ON s.file_id = f.id
        WHERE s.kind IN ('function','class','method')
      `);
      for (const s of syms) {
        nodes.push({ id: 'sym::' + s.name, label: s.name + (s.kind === 'function' ? '()' : ''), group: s.kind, parent_file: s.file_path });
        if (s.file_path) edges.push({ source: 'file::' + s.file_path, target: 'sym::' + s.name, type: 'contains' });
      }

      const callEdges = safeQueryDb(d.db_path, `
        SELECT s_src.name as src, s_tgt.name as tgt, et.name as etype
        FROM edges e
        JOIN edge_types et ON e.edge_type_id = et.id
        JOIN nodes n_src ON e.source_node_id = n_src.id
        JOIN symbols s_src ON n_src.ref_id = s_src.id
        JOIN nodes n_tgt ON e.target_node_id = n_tgt.id
        JOIN symbols s_tgt ON n_tgt.ref_id = s_tgt.id
        WHERE et.name IN ('calls','py_imports','imports')
        AND s_src.kind IN ('function','class','method')
        AND s_tgt.kind IN ('function','class','method')
      `);
      for (const e of callEdges) edges.push({ source: 'sym::' + e.src, target: 'sym::' + e.tgt, type: e.etype });

      const envVars = safeQueryDb(d.db_path, 'SELECT key, value_type FROM env_vars');
      for (const ev of envVars) {
        const k = ev.key.toUpperCase();
        if (k.includes('URL') || k.includes('HOST') || k.includes('ENDPOINT') || k.includes('API')) {
          nodes.push({ id: 'ext::' + ev.key, label: ev.key, group: 'external_service' });
        }
      }

      const topoPath = join(DATA_DIR, 'topology.json');
      if (existsSync(topoPath)) {
        try {
          const topo = JSON.parse(readFileSync(topoPath, 'utf8'));
          const projEdges = (topo.cross_service_edges || []).filter(e =>
            e.source.toLowerCase() === wanted || e.target.toLowerCase() === wanted
          );
          for (const pe of projEdges) {
            const other = pe.source.toLowerCase() === wanted ? pe.target : pe.source;
            if (!nodes.find(n => n.id === 'ext::' + other)) {
              nodes.push({ id: 'ext::' + other, label: other, group: 'external_project' });
            }
            edges.push({
              source: pe.source.toLowerCase() === wanted ? 'sym::' + (pe.evidence || wanted) : 'ext::' + other,
              target: pe.source.toLowerCase() === wanted ? 'ext::' + other : 'sym::' + (pe.evidence || wanted),
              type: pe.type || 'calls', inferred: true, confidence: pe.confidence || 0.7
            });
          }
        } catch {}
      }

      res.json({ project: d.name, nodes_count: nodes.length, edges_count: edges.length, nodes, edges });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/deep/:project/:file(*)', (req, res) => {
    try {
      const dbs = listDbs();
      const wanted = req.params.project.toLowerCase();
      const d = dbs.find(x => x.name.toLowerCase() === wanted);
      if (!d) return res.status(404).json({ error: 'project not found' });

      const filePath = decodeURIComponent(req.params.file);
      const nodes = [{ id: 'file::' + filePath, label: basename(filePath), group: 'file' }];
      const edges = [];

      const syms = safeQueryDb(d.db_path, `
        SELECT s.id, s.name, s.kind
        FROM symbols s JOIN files f ON s.file_id = f.id
        WHERE f.path LIKE ? AND s.kind IN ('function','class','method','variable')
      `, ['%' + filePath + '%']);

      for (const s of syms) {
        nodes.push({ id: 'sym::' + s.name, label: s.name, group: s.kind });
        edges.push({ source: 'file::' + filePath, target: 'sym::' + s.name, type: 'contains' });
      }

      const symNames = syms.map(s => s.name);
      if (symNames.length > 0) {
        const ph = symNames.map(() => '?').join(',');
        const callEdges = safeQueryDb(d.db_path, `
          SELECT s_src.name as src, s_tgt.name as tgt, et.name as etype
          FROM edges e
          JOIN edge_types et ON e.edge_type_id = et.id
          JOIN nodes n_src ON e.source_node_id = n_src.id
          JOIN symbols s_src ON n_src.ref_id = s_src.id
          JOIN nodes n_tgt ON e.target_node_id = n_tgt.id
          JOIN symbols s_tgt ON n_tgt.ref_id = s_tgt.id
          WHERE et.name IN ('calls','imports','py_imports')
          AND (s_src.name IN (${ph}) OR s_tgt.name IN (${ph}))
        `, [...symNames, ...symNames]);

        for (const e of callEdges) {
          if (!nodes.find(n => n.id === 'sym::' + e.tgt)) nodes.push({ id: 'sym::' + e.tgt, label: e.tgt, group: 'external_symbol' });
          if (!nodes.find(n => n.id === 'sym::' + e.src)) nodes.push({ id: 'sym::' + e.src, label: e.src, group: 'external_symbol' });
          edges.push({ source: 'sym::' + e.src, target: 'sym::' + e.tgt, type: e.etype });
        }
      }

      res.json({ project: d.name, file: filePath, nodes_count: nodes.length, edges_count: edges.length, nodes, edges });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/data', (_req, res) => {
    const summaryPath = join(DATA_DIR, 'build-summary.json');
    if (!existsSync(summaryPath)) return res.json({ summary: null, last_scan: null });
    try {
      const data = JSON.parse(readFileSync(summaryPath, 'utf8'));
      const mtime = statSync(summaryPath).mtimeMs;
      res.json({ summary: data, last_scan: new Date(mtime).toISOString() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}
MULTIGRAPHJS
ok "routes/codegraph-multi.js"

# ---- routes/codegraph.js (single project — backward compat) ----
cat > "${BACKSTAGE_DIR}/routes/codegraph.js" <<'CODEGRAPHJS'
import { Router } from 'express';
import Database from 'better-sqlite3';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const INDEX_DIR = join(homedir(), '.trace-mcp', 'index');

function findMostRecentDb() {
  try {
    const files = readdirSync(INDEX_DIR)
      .filter(f => f.endsWith('.db') && !f.endsWith('-shm') && !f.endsWith('-wal') && f !== 'topology.db');
    if (!files.length) return null;
    let best = null;
    let bestMtime = 0;
    for (const f of files) {
      const fp = join(INDEX_DIR, f);
      const mt = statSync(fp).mtimeMs;
      if (mt > bestMtime) { bestMtime = mt; best = fp; }
    }
    return best;
  } catch { return null; }
}

function safeQuery(dbPath, sql, params = []) {
  try {
    const db = new Database(dbPath, { readonly: true });
    try { return db.prepare(sql).all(...params); }
    finally { db.close(); }
  } catch { return []; }
}

export function createCodeGraphRouter() {
  const router = Router();

  router.get('/routes', (_req, res) => {
    const dbPath = findMostRecentDb();
    if (!dbPath) return res.status(404).json({ error: 'no trace-mcp databases found' });
    const rows = safeQuery(dbPath, 'SELECT method, uri, name, handler FROM routes ORDER BY uri');
    res.json({ count: rows.length, routes: rows, db: dbPath });
  });

  router.get('/routes-with-tables', (_req, res) => {
    const dbPath = findMostRecentDb();
    if (!dbPath) return res.status(404).json({ error: 'no trace-mcp databases found' });

    const routes = safeQuery(dbPath, 'SELECT method, uri, name, handler FROM routes ORDER BY uri');

    const routesWithTables = routes.map(route => {
      const handlerSymbols = safeQuery(dbPath, `
        SELECT DISTINCT s_tgt.name as table_name, et.name as edge_type
        FROM symbols s
        JOIN nodes n ON n.ref_id = s.id
        JOIN edges e ON e.source_node_id = n.id
        JOIN edge_types et ON e.edge_type_id = et.id
        JOIN nodes n_tgt ON e.target_node_id = n_tgt.id
        JOIN symbols s_tgt ON n_tgt.ref_id = s_tgt.id
        WHERE (s.name = ? OR s.fqn LIKE ?)
        AND et.name IN ('supabase_query', 'references')
      `, [route.handler || route.name, '%' + (route.handler || route.name) + '%']);

      return { ...route, tables: handlerSymbols };
    });

    res.json({ count: routesWithTables.length, routes: routesWithTables });
  });

  router.get('/route/:path(*)', (req, res) => {
    const dbPath = findMostRecentDb();
    if (!dbPath) return res.status(404).json({ error: 'no trace-mcp databases found' });

    const routePath = '/' + req.params.path;
    const routes = safeQuery(dbPath, 'SELECT method, uri, name, handler FROM routes WHERE uri = ? OR uri LIKE ?',
      [routePath, routePath + '%']);

    if (!routes.length) return res.status(404).json({ error: 'route not found: ' + routePath });

    const detail = routes.map(route => {
      const symbols = safeQuery(dbPath, `
        SELECT s.name, s.kind, s.fqn, f.path as file_path
        FROM symbols s LEFT JOIN files f ON s.file_id = f.id
        WHERE s.name = ? OR s.fqn LIKE ?
      `, [route.handler || route.name, '%' + (route.handler || route.name) + '%']);

      return { ...route, symbols };
    });

    res.json({ path: routePath, matches: detail });
  });

  router.get('/summary', (_req, res) => {
    const dbPath = findMostRecentDb();
    if (!dbPath) return res.status(404).json({ error: 'no trace-mcp databases found' });

    const files = safeQuery(dbPath, 'SELECT count(*) as cnt FROM files')[0]?.cnt || 0;
    const symbols = safeQuery(dbPath, 'SELECT count(*) as cnt FROM symbols')[0]?.cnt || 0;
    const edges = safeQuery(dbPath, 'SELECT count(*) as cnt FROM edges')[0]?.cnt || 0;
    const routes = safeQuery(dbPath, 'SELECT count(*) as cnt FROM routes')[0]?.cnt || 0;
    const envVars = safeQuery(dbPath, 'SELECT count(*) as cnt FROM env_vars')[0]?.cnt || 0;
    const edgeTypes = safeQuery(dbPath, 'SELECT et.name, count(*) as cnt FROM edges e JOIN edge_types et ON e.edge_type_id = et.id GROUP BY et.name ORDER BY cnt DESC');

    res.json({ db: dbPath, stats: { files, symbols, edges, routes, env_vars: envVars }, edge_types: edgeTypes });
  });

  return router;
}
CODEGRAPHJS
ok "routes/codegraph.js"

# ---- topology-builder.mjs ----
cat > "${BACKSTAGE_DIR}/topology-builder.mjs" <<'TOPOMJS'
#!/usr/bin/env node
import Database from 'better-sqlite3';
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

const INDEX_DIR = process.argv.includes('--index') ? process.argv[process.argv.indexOf('--index') + 1] : join(homedir(), '.trace-mcp', 'index');
const PROJECTS_JSON = process.argv.includes('--projects-json') ? process.argv[process.argv.indexOf('--projects-json') + 1] : join(homedir(), '.registry-data', 'projects.json');
const OUT_FILE = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : join(homedir(), '.registry-data', 'topology.json');
const OUT_GRAPHS = process.argv.includes('--out-graphs') ? process.argv[process.argv.indexOf('--out-graphs') + 1] : join(homedir(), '.registry-data', 'graphs');

function listDbs() {
  try {
    return readdirSync(INDEX_DIR)
      .filter(f => f.endsWith('.db') && !f.endsWith('-shm') && !f.endsWith('-wal') && f !== 'topology.db')
      .map(f => {
        const name = f.replace(/-[a-f0-9]{12}\.db$/, '');
        return { name, db_path: join(INDEX_DIR, f), filename: f };
      });
  } catch { return []; }
}

function safeQuery(dbPath, sql, params = []) {
  try {
    const db = new Database(dbPath, { readonly: true });
    try { return db.prepare(sql).all(...params); }
    finally { db.close(); }
  } catch { return []; }
}

function loadClassifiedProjects() {
  if (!existsSync(PROJECTS_JSON)) return {};
  try {
    const raw = JSON.parse(readFileSync(PROJECTS_JSON, 'utf8'));
    const arr = Array.isArray(raw) ? raw : (raw.projects || raw.data || []);
    const map = {};
    for (const p of arr) {
      if (p && p.name) map[p.name.toLowerCase()] = p;
    }
    return map;
  } catch { return {}; }
}

console.log('Topology Builder starting...');
console.log('  INDEX_DIR:', INDEX_DIR);
console.log('  PROJECTS_JSON:', PROJECTS_JSON);
console.log('  OUT:', OUT_FILE);

const dbs = listDbs();
console.log(`  Found ${dbs.length} project databases`);

const classified = loadClassifiedProjects();

// Phase 1: Load all symbols per project
const projectData = {};
for (const d of dbs) {
  const symbols = safeQuery(d.db_path, 'SELECT s.name, s.kind, s.fqn, f.path as file_path FROM symbols s LEFT JOIN files f ON s.file_id = f.id');
  const files = safeQuery(d.db_path, 'SELECT path, language FROM files');
  const envVars = safeQuery(d.db_path, 'SELECT key, value_type FROM env_vars');
  const edges = safeQuery(d.db_path, `
    SELECT s_src.name as src_name, s_src.kind as src_kind, f_src.path as src_file,
           s_tgt.name as tgt_name, s_tgt.kind as tgt_kind, f_tgt.path as tgt_file,
           et.name as edge_type
    FROM edges e
    JOIN edge_types et ON e.edge_type_id = et.id
    JOIN nodes n_src ON e.source_node_id = n_src.id
    JOIN symbols s_src ON n_src.ref_id = s_src.id
    LEFT JOIN files f_src ON s_src.file_id = f_src.id
    JOIN nodes n_tgt ON e.target_node_id = n_tgt.id
    JOIN symbols s_tgt ON n_tgt.ref_id = s_tgt.id
    LEFT JOIN files f_tgt ON s_tgt.file_id = f_tgt.id
    WHERE et.name IN ('calls','imports','py_imports','references')
  `);
  const symbolSet = new Set(symbols.map(s => s.name.toLowerCase()));
  projectData[d.name] = { symbols, files, envVars, edges, symbolSet, db: d };
  console.log(`  ${d.name}: ${symbols.length} symbols, ${files.length} files, ${edges.length} edges, ${envVars.length} env_vars`);
}

// Phase 2: Detect cross-project symbol references
const crossEdges = [];
const projectNames = Object.keys(projectData);

for (const srcName of projectNames) {
  const src = projectData[srcName];
  for (const edge of src.edges) {
    if (edge.edge_type !== 'calls' && edge.edge_type !== 'references') continue;
    const tgtLower = edge.tgt_name.toLowerCase();
    for (const otherName of projectNames) {
      if (otherName === srcName) continue;
      const other = projectData[otherName];
      if (other.symbolSet.has(tgtLower)) {
        const existing = crossEdges.find(e => e.source === srcName && e.target === otherName && e.evidence === edge.tgt_name);
        if (!existing) {
          crossEdges.push({
            source: srcName, target: otherName, type: edge.edge_type,
            evidence: edge.tgt_name, source_file: edge.src_file,
            confidence: edge.tgt_name.length > 8 ? 0.85 : 0.6
          });
        }
      }
    }
  }
}

// Phase 3: Detect external services from env vars
const externalServices = [];
const seenExternal = new Set();
const KNOWN_EXTERNALS = {
  'gemini-proxy': /gemini.proxy|gemini.*run\.app/i,
  'openai': /openai\.com|OPENAI_API/i,
  'anthropic': /anthropic\.com|ANTHROPIC_API/i,
  'ctrader': /ctraderapi\.com/i,
  'supabase': /supabase/i,
  'cloudflare': /cloudflare/i,
  'rithmic': /rithmic/i,
  'perplexity': /perplexity/i,
};

for (const [projName, data] of Object.entries(projectData)) {
  for (const ev of data.envVars) {
    const k = ev.key.toUpperCase();
    if (!k.includes('URL') && !k.includes('HOST') && !k.includes('ENDPOINT') && !k.includes('API_KEY') && !k.includes('BASE')) continue;
    for (const [svcName, pattern] of Object.entries(KNOWN_EXTERNALS)) {
      if (pattern.test(ev.key)) {
        if (!seenExternal.has(svcName + ':' + projName)) {
          seenExternal.add(svcName + ':' + projName);
          let svc = externalServices.find(s => s.name === svcName);
          if (!svc) { svc = { name: svcName, env_var_pattern: ev.key, referenced_by: [] }; externalServices.push(svc); }
          if (!svc.referenced_by.includes(projName)) svc.referenced_by.push(projName);
        }
      }
    }
  }
}

// Phase 4: Build per-project topology entries
const projects = dbs.map(d => {
  const data = projectData[d.name];
  const cls = classified[d.name.toLowerCase()] || {};
  const outgoing = crossEdges.filter(e => e.source === d.name);
  const incoming = crossEdges.filter(e => e.target === d.name);
  return {
    name: d.name, type: cls.type || 'unknown',
    language: cls.language || (data.files[0]?.language || 'unknown'),
    path: cls.path || null, symbol_count: data.symbols.length,
    file_count: data.files.length, edge_count: data.edges.length,
    calls_out: outgoing.map(e => ({ target: e.target, evidence: e.evidence, confidence: e.confidence })),
    calls_in: incoming.map(e => ({ source: e.source, evidence: e.evidence, confidence: e.confidence }))
  };
});

// Deduplicate cross edges
const edgeMap = {};
for (const e of crossEdges) {
  const key = e.source + '→' + e.target;
  if (!edgeMap[key] || e.confidence > edgeMap[key].confidence) edgeMap[key] = e;
}
const dedupedEdges = Object.values(edgeMap);

// Phase 5: Write topology.json
const topology = {
  generated_at: new Date().toISOString(),
  server: process.env.HOSTNAME || 'unknown',
  projects,
  cross_service_edges: dedupedEdges.map(e => ({
    source: e.source, target: e.target, type: e.type,
    evidence: e.evidence, confidence: e.confidence, source_file: e.source_file
  })),
  external_services: externalServices
};

mkdirSync(join(OUT_FILE, '..'), { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(topology, null, 2));
console.log(`\nTopology written to ${OUT_FILE}`);
console.log(`  ${projects.length} projects`);
console.log(`  ${dedupedEdges.length} cross-service edges (${crossEdges.length} raw)`);
console.log(`  ${externalServices.length} external services`);

// Phase 6: Write per-project graphs
mkdirSync(OUT_GRAPHS, { recursive: true });
for (const d of dbs) {
  const data = projectData[d.name];
  const graph = {
    project: d.name,
    files: data.files.map(f => ({ path: f.path, language: f.language })),
    symbols: data.symbols.slice(0, 1000).map(s => ({
      id: d.name + '::' + (s.file_path || '') + '::' + s.name,
      name: s.name, kind: s.kind, file: s.file_path
    })),
    edges: data.edges.slice(0, 2000).map(e => ({
      source: d.name + '::' + (e.src_file || '') + '::' + e.src_name,
      target: d.name + '::' + (e.tgt_file || '') + '::' + e.tgt_name,
      type: e.edge_type
    }))
  };
  writeFileSync(join(OUT_GRAPHS, d.name + '-graph.json'), JSON.stringify(graph, null, 2));
}
console.log(`  Per-project graphs written to ${OUT_GRAPHS}/`);
console.log('Done.');
TOPOMJS
ok "topology-builder.mjs"

# ---- classifier.py (embedded) ----
cat > "${REGISTRY_DIR}/classifier.py" <<'CLASSIFIERPY'
#!/usr/bin/env python3
"""
Registry Universal - Project Classifier (L2)
Classifies repos into: saas, api, bot, scraper, web, library, unknown
"""
from __future__ import annotations
import json, os, re, sys
from collections import Counter
from pathlib import Path

IGNORE_DIRS = {
    ".git", ".hg", ".svn", "node_modules", ".next", ".nuxt", "dist", "build",
    "out", "target", "__pycache__", ".venv", "venv", "env", ".env",
    ".idea", ".vscode", ".pytest_cache", ".mypy_cache", ".cache",
    "coverage", ".turbo", ".parcel-cache", "vendor", ".gradle",
    "__snapshots__", ".terraform", "bin", "obj",
}
EXT_LANG = {
    ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
    ".mjs": "JavaScript", ".cjs": "JavaScript", ".py": "Python", ".rs": "Rust",
    ".go": "Go", ".java": "Java", ".kt": "Kotlin", ".rb": "Ruby", ".php": "PHP",
    ".cs": "C#", ".c": "C", ".h": "C", ".cpp": "C++", ".cc": "C++", ".hpp": "C++",
    ".swift": "Swift", ".dart": "Dart", ".scala": "Scala", ".ex": "Elixir", ".exs": "Elixir",
    ".vue": "Vue", ".svelte": "Svelte", ".astro": "Astro",
}
NEXT_LIKE = ("next", "nuxt", "@remix-run", "remix")
EXPRESS_LIKE = ("express", "fastify", "@nestjs", "koa", "hapi", "@hapi", "restify")
PY_WEB = ("flask", "fastapi", "django", "starlette", "sanic", "tornado", "aiohttp", "bottle", "falcon")
DB_DEPS = ("@supabase", "supabase", "pg", "postgres", "prisma", "drizzle", "drizzle-orm",
           "mongoose", "mongodb", "typeorm", "sequelize", "knex", "mysql", "mysql2",
           "sqlalchemy", "psycopg2", "psycopg", "asyncpg", "pymongo", "redis")
AUTH_DEPS = ("next-auth", "@clerk", "@auth0", "@supabase/auth-helpers", "lucia",
             "passport", "@auth/core", "firebase-auth", "@firebase/auth")
FRONTEND_DEPS = ("tailwindcss", "@chakra-ui", "@mui/material", "styled-components",
                 "@emotion", "antd", "bootstrap", "@shadcn", "shadcn")
FRONTEND_FRAMEWORKS = ("react", "react-dom", "vue", "svelte", "@sveltejs/kit",
                       "astro", "solid-js", "preact", "@angular/core", "lit")
BOT_DEPS = ("ccxt", "metaapi", "metaapi.cloud-sdk", "metatrader5", "metatrader",
            "python-telegram-bot", "telethon", "pyrogram", "discord.py", "discord.js",
            "telegraf", "rpyc", "ib_insync", "alpaca", "alpaca-trade-api", "binance",
            "python-binance", "backtrader", "freqtrade")
SCRAPER_DEPS = ("playwright", "puppeteer", "puppeteer-core", "selenium",
                "scrapy", "beautifulsoup4", "bs4", "cheerio", "playwright-core",
                "undetected-chromedriver", "requests-html", "lxml", "parsel",
                "crawlee", "@crawlee")
BOT_NAME_HINTS = ("bot", "trader", "trading", "agent")
SCRAPER_NAME_HINTS = ("scraper", "crawler", "etl", "spider", "scrape")
UI_DIR_NAMES = ("app", "pages", "views", "templates", "components", "src/app", "src/pages", "src/components")

def _read_json(path):
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh: return json.load(fh)
    except (OSError, ValueError): return {}

def _read_text(path):
    try: return path.read_text(encoding="utf-8", errors="replace")
    except OSError: return ""

def _pkg_deps(pkg):
    deps = {}
    for field in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        block = pkg.get(field)
        if isinstance(block, dict): deps.update(block)
    return deps

def _parse_py_requirements(text):
    names = set()
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("-"): continue
        line = line.split(";", 1)[0].strip()
        m = re.match(r"^([A-Za-z0-9_.\-]+)", line)
        if m: names.add(m.group(1).lower().replace("_", "-"))
    return names

def _parse_pyproject_deps(text):
    names = set()
    for block_match in re.finditer(r"dependencies\s*=\s*\[(.*?)\]", text, re.DOTALL | re.IGNORECASE):
        for item in re.findall(r"""['"]([^'"]+)['"]""", block_match.group(1)):
            m = re.match(r"^([A-Za-z0-9_.\-]+)", item.strip())
            if m: names.add(m.group(1).lower().replace("_", "-"))
    poetry = re.search(r"\[tool\.poetry\.dependencies\](.*?)(?:\n\[|\Z)", text, re.DOTALL)
    if poetry:
        for line in poetry.group(1).splitlines():
            m = re.match(r"^\s*([A-Za-z0-9_.\-]+)\s*=", line)
            if m: names.add(m.group(1).lower().replace("_", "-"))
    return names

def _scan_tree(root):
    ext_counter, file_count, dir_set = Counter(), 0, set()
    ui_component_files, route_files, server_listen_hits, http_route_decorators = 0, 0, 0, 0
    root_str = str(root)
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS and not d.startswith(".git")]
        rel_dir = os.path.relpath(dirpath, root_str)
        if rel_dir == ".": rel_dir = ""
        rel_norm = rel_dir.replace(os.sep, "/").lower()
        if rel_norm: dir_set.add(rel_norm)
        in_ui_dir = any(seg in UI_DIR_NAMES for seg in rel_norm.split("/")) or rel_norm.startswith(("app/", "pages/", "src/app/", "src/pages/"))
        in_api_dir = ("/api" in ("/" + rel_norm) and ("app" in rel_norm or "pages" in rel_norm)) or rel_norm.endswith("routes") or "/routes/" in ("/" + rel_norm + "/")
        for fname in filenames:
            file_count += 1
            ext = os.path.splitext(fname)[1].lower()
            if ext: ext_counter[ext] += 1
            low = fname.lower()
            if low in ("route.ts", "route.js", "route.tsx", "route.jsx", "+server.ts", "+server.js"): route_files += 1
            elif in_api_dir and ext in (".ts", ".js", ".tsx", ".jsx", ".py"): route_files += 1
            if in_ui_dir and ext in (".tsx", ".jsx", ".vue", ".svelte"): ui_component_files += 1
            if ext in (".py", ".js", ".ts", ".go"):
                full = Path(dirpath) / fname
                try:
                    if full.stat().st_size <= 200_000:
                        txt = _read_text(full)
                        if txt:
                            if re.search(r"app\.listen\(|uvicorn\.run|http\.createServer|createServer\(|\.run_server\(|gunicorn", txt): server_listen_hits += 1
                            http_route_decorators += len(re.findall(r"@app\.(get|post|put|delete|patch)\b|@router\.(get|post|put|delete|patch)\b|\b(app|router)\.(get|post|put|delete|patch)\s*\(", txt))
                except OSError: pass
    return {"ext_counter": ext_counter, "file_count": file_count, "dir_set": dir_set,
            "ui_component_files": ui_component_files, "route_files": route_files,
            "server_listen_hits": server_listen_hits, "http_route_decorators": http_route_decorators}

def _detect_language(ext_counter):
    lang_counter = Counter()
    for ext, n in ext_counter.items():
        lang = EXT_LANG.get(ext)
        if lang: lang_counter[lang] += n
    return lang_counter.most_common(1)[0][0] if lang_counter else "unknown"

def _any_dep(deps_lower, needles):
    hits = []
    for needle in needles:
        for dep in deps_lower:
            if dep == needle or dep.startswith(needle):
                hits.append(needle); break
    return hits

def _toml_version(text):
    if not text: return None
    m = re.search(r'(?m)^\s*version\s*=\s*["\']([^"\']+)["\']', text)
    return m.group(1) if m else None

def _principal_stack(js_deps, deps_lower):
    important_groups = NEXT_LIKE + EXPRESS_LIKE + PY_WEB + DB_DEPS + AUTH_DEPS + FRONTEND_FRAMEWORKS + FRONTEND_DEPS + BOT_DEPS + SCRAPER_DEPS
    picked, seen = [], set()
    for needle in important_groups:
        for dep in sorted(deps_lower):
            if dep in seen: continue
            if dep == needle or dep.startswith(needle): picked.append(dep); seen.add(dep); break
        if len(picked) >= 12: return picked[:12]
    for dep in sorted(deps_lower):
        if dep not in seen: picked.append(dep); seen.add(dep)
        if len(picked) >= 12: break
    return picked[:12]

def classify_repo(path):
    root = Path(path).expanduser().resolve()
    base = {"name": root.name or str(root), "type": "unknown", "language": "unknown", "framework": None,
            "stack": [], "file_count": 0, "top_dirs": [], "endpoints_approx": 0, "markers_found": [], "path": str(root)}
    if not root.exists() or not root.is_dir():
        base["markers_found"].append(f"error: path does not exist or is not a directory ({root})")
        return base
    pkg = _read_json(root / "package.json")
    req_txt = _read_text(root / "requirements.txt")
    pyproject_txt = _read_text(root / "pyproject.toml")
    cargo = (root / "Cargo.toml").exists()
    gomod = (root / "go.mod").exists()
    has_setup_py = (root / "setup.py").exists()
    js_deps = _pkg_deps(pkg)
    deps_lower = set(d.lower() for d in js_deps.keys())
    if req_txt: deps_lower |= _parse_py_requirements(req_txt)
    if pyproject_txt: deps_lower |= _parse_pyproject_deps(pyproject_txt)
    scan = _scan_tree(root)
    base["file_count"] = scan["file_count"]
    base["language"] = _detect_language(scan["ext_counter"])
    top_dirs = sorted({d.split("/")[0] for d in scan["dir_set"] if d and "/" not in d})
    base["top_dirs"] = top_dirs
    top_set = set(top_dirs)
    next_hits = _any_dep(deps_lower, NEXT_LIKE)
    express_hits = _any_dep(deps_lower, EXPRESS_LIKE)
    pyweb_hits = _any_dep(deps_lower, PY_WEB)
    db_hits = _any_dep(deps_lower, DB_DEPS)
    auth_hits = _any_dep(deps_lower, AUTH_DEPS)
    fe_style_hits = _any_dep(deps_lower, FRONTEND_DEPS)
    fe_fw_hits = _any_dep(deps_lower, FRONTEND_FRAMEWORKS)
    bot_dep_hits = _any_dep(deps_lower, BOT_DEPS)
    scraper_dep_hits = _any_dep(deps_lower, SCRAPER_DEPS)
    name_lower = base["name"].lower()
    bot_name_hit = [h for h in BOT_NAME_HINTS if h in name_lower]
    scraper_name_hit = [h for h in SCRAPER_NAME_HINTS if h in name_lower]
    has_app_or_pages = bool({"app", "pages"} & top_set) or any(d in ("src/app", "src/pages") for d in scan["dir_set"])
    has_api_dir = any(seg == "api" for d in scan["dir_set"] for seg in d.split("/")) and has_app_or_pages
    has_middleware = (root / "middleware.ts").exists() or (root / "middleware.js").exists() or (root / "src" / "middleware.ts").exists()
    has_ui_components = scan["ui_component_files"] > 0
    has_http_server = scan["server_listen_hits"] > 0 or scan["http_route_decorators"] > 0 or bool(express_hits) or bool(pyweb_hits) or "django" in deps_lower
    has_any_manifest = bool(pkg) or bool(req_txt) or bool(pyproject_txt) or cargo or gomod or has_setup_py
    endpoints = max(scan["route_files"], scan["http_route_decorators"])
    markers, scores = [], {"saas": 0, "api": 0, "bot": 0, "scraper": 0, "web": 0, "library": 0}
    if next_hits:
        markers.append(f"dep:{next_hits[0]} (meta-framework SSR)"); scores["saas"] += 3
        if has_app_or_pages: scores["saas"] += 2; markers.append("dir:app/|pages/")
        if has_api_dir: scores["saas"] += 3; markers.append("dir:app/api|pages/api")
        if has_middleware: scores["saas"] += 1; markers.append("file:middleware.ts")
        if db_hits: scores["saas"] += 2; markers.append(f"BD:{','.join(db_hits)}")
        if auth_hits: scores["saas"] += 2; markers.append(f"auth:{','.join(auth_hits)}")
        if fe_style_hits: scores["saas"] += 1; markers.append(f"frontend:{','.join(fe_style_hits)}")
    if express_hits or pyweb_hits:
        if express_hits: markers.append(f"dep:{','.join(express_hits)} (HTTP server JS)")
        if pyweb_hits: markers.append(f"dep:{','.join(pyweb_hits)} (HTTP server Python)")
        scores["api"] += 4
        if not has_ui_components: scores["api"] += 3; markers.append("no UI components -> backend")
        else: scores["api"] -= 1
        if db_hits: scores["api"] += 1; markers.append(f"BD:{','.join(db_hits)}")
        if endpoints: scores["api"] += 1
    if bot_dep_hits: markers.append(f"dep:{','.join(bot_dep_hits)} (bot)"); scores["bot"] += 4
    if bot_name_hit and (bot_dep_hits or not has_http_server): markers.append(f"name:{bot_name_hit}"); scores["bot"] += 2
    if (bot_dep_hits or bot_name_hit) and not has_http_server: scores["bot"] += 2; markers.append("no HTTP server -> process")
    if scraper_dep_hits: markers.append(f"dep:{','.join(scraper_dep_hits)} (scraping)"); scores["scraper"] += 4
    if scraper_name_hit: markers.append(f"name:{scraper_name_hit}"); scores["scraper"] += 2
    if scraper_dep_hits and not has_http_server: scores["scraper"] += 1
    if fe_fw_hits and not next_hits:
        markers.append(f"frontend-fw:{','.join(fe_fw_hits)}"); scores["web"] += 3
        if not has_api_dir and not has_http_server: scores["web"] += 3; markers.append("no api/server -> frontend")
        else: scores["web"] -= 1
        if fe_style_hits: scores["web"] += 1
    exposes_entry = bool(pkg.get("main") or pkg.get("module") or pkg.get("exports") or pkg.get("bin") or pkg.get("types"))
    py_lib_signal = has_setup_py or (bool(pyproject_txt) and re.search(r"\[build-system\]|\[tool\.(setuptools|hatch|flit|poetry)\]", pyproject_txt) is not None)
    rust_lib = cargo and (root / "src" / "lib.rs").exists()
    go_lib = gomod and not (root / "main.go").exists() and not any(d in ("cmd",) for d in top_set)
    strong_app_signal = bool(next_hits) or bool(express_hits) or bool(pyweb_hits) or bool(bot_dep_hits) or bool(scraper_dep_hits) or has_http_server or has_ui_components
    if has_any_manifest and not strong_app_signal:
        if exposes_entry: scores["library"] += 3; markers.append("exports main/module/bin -> library")
        if py_lib_signal: scores["library"] += 2; markers.append("build-system -> package")
        if rust_lib: scores["library"] += 3; markers.append("Cargo + src/lib.rs -> crate")
        if go_lib: scores["library"] += 2; markers.append("go.mod no main.go -> module")
        if scores["library"] == 0: scores["library"] += 1; markers.append("manifest without app -> library")
    priority = ["saas", "api", "bot", "scraper", "web", "library"]
    best_type, best_score = "unknown", 0
    for t in priority:
        if scores[t] > best_score: best_score = scores[t]; best_type = t
    if best_score == 0:
        best_type = "unknown"
        if not has_any_manifest: markers.append("no manifest found")
        else: markers.append("manifest present but no type markers")
    base["type"] = best_type
    framework = None
    if next_hits: framework = {"next": "Next.js", "nuxt": "Nuxt", "remix": "Remix", "@remix-run": "Remix"}.get(next_hits[0], next_hits[0])
    elif express_hits: framework = {"express": "Express", "fastify": "Fastify", "@nestjs": "NestJS", "koa": "Koa"}.get(express_hits[0], express_hits[0])
    elif pyweb_hits: framework = {"fastapi": "FastAPI", "flask": "Flask", "django": "Django"}.get(pyweb_hits[0], pyweb_hits[0])
    elif fe_fw_hits: framework = {"react": "React", "react-dom": "React", "vue": "Vue", "svelte": "Svelte"}.get(fe_fw_hits[0], fe_fw_hits[0])
    elif scraper_dep_hits: framework = scraper_dep_hits[0]
    elif bot_dep_hits: framework = bot_dep_hits[0]
    elif cargo: framework = "Cargo"
    elif gomod: framework = "Go modules"
    base["framework"] = framework
    base["stack"] = _principal_stack(js_deps, deps_lower)
    base["endpoints_approx"] = int(endpoints)
    if pkg.get("name"): base["name"] = pkg["name"]
    base["version"] = pkg.get("version") or _toml_version(pyproject_txt) or _toml_version(_read_text(root / "Cargo.toml")) or None
    scripts = pkg.get("scripts")
    base["scripts"] = list(scripts.keys()) if isinstance(scripts, dict) else []
    seen = set(); deduped = []
    for m in markers:
        if m not in seen: seen.add(m); deduped.append(m)
    base["markers_found"] = deduped
    return base

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    if not args or "--help" in flags or "-h" in flags:
        print("Usage: python3 classifier.py <repo-path> [--compact|--pretty]", file=sys.stderr); raise SystemExit(0 if ("--help" in flags or "-h" in flags) else 2)
    result = classify_repo(args[0])
    if "--compact" in flags: print(json.dumps(result, ensure_ascii=False))
    else: print(json.dumps(result, ensure_ascii=False, indent=2))
CLASSIFIERPY
ok "classifier.py"

# ---- scanner.py (discovers repos on the server) ----
cat > "${REGISTRY_DIR}/scanner.py" <<'SCANNERPY'
#!/usr/bin/env python3
"""
Registry Universal - Server Scanner (L1)
Discovers repositories and running services on the server.
"""
import json, os, subprocess, sys, socket
from pathlib import Path
from datetime import datetime, timezone

MANIFEST_FILES = ("package.json", "Cargo.toml", "pyproject.toml", "go.mod", "setup.py", "requirements.txt")

def find_repos(roots):
    """Find directories that look like code projects."""
    repos = []
    seen = set()
    for root_str in roots:
        root = Path(root_str)
        if not root.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(str(root), topdown=True):
            # Prune deep traversal
            dirnames[:] = [d for d in dirnames if d not in {
                "node_modules", ".git", ".next", "dist", "build", "target",
                "__pycache__", ".venv", "venv", ".cache", "vendor"
            } and not d.startswith(".")]

            # Check if this directory is a project root
            has_git = ".git" in os.listdir(dirpath) if os.path.isdir(dirpath) else False
            has_manifest = any(f in filenames for f in MANIFEST_FILES)

            if has_git or has_manifest:
                real = os.path.realpath(dirpath)
                if real not in seen:
                    seen.add(real)
                    repos.append({"path": real, "name": os.path.basename(real)})
                    # Don't descend into found repos
                    dirnames.clear()
    return repos

def scan_services():
    """Scan running services via systemctl."""
    services = []
    try:
        out = subprocess.check_output(
            ["systemctl", "list-units", "--type=service", "--state=running", "--no-pager", "--plain"],
            text=True, timeout=10, stderr=subprocess.DEVNULL
        )
        for line in out.strip().splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 4:
                services.append({"name": parts[0], "status": parts[3] if len(parts) > 3 else "running"})
    except Exception:
        pass
    return services

def scan_ports():
    """Scan listening ports via ss."""
    ports = []
    try:
        out = subprocess.check_output(
            ["ss", "-tlnp"],
            text=True, timeout=10, stderr=subprocess.DEVNULL
        )
        for line in out.strip().splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 4:
                local = parts[3]
                port_str = local.rsplit(":", 1)[-1] if ":" in local else None
                if port_str and port_str.isdigit():
                    proc = parts[5] if len(parts) > 5 else ""
                    # Extract process name from ss output
                    proc_name = ""
                    if "users:" in proc:
                        import re
                        m = re.search(r'\("([^"]+)"', proc)
                        if m:
                            proc_name = m.group(1)
                    ports.append({"port": int(port_str), "process": proc_name or "unknown"})
    except Exception:
        pass
    return ports

def scan_containers():
    """Scan Docker containers if available."""
    containers = []
    try:
        out = subprocess.check_output(
            ["docker", "ps", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}"],
            text=True, timeout=10, stderr=subprocess.DEVNULL
        )
        for line in out.strip().splitlines():
            parts = line.split("\t")
            if len(parts) >= 3:
                containers.append({"name": parts[0], "image": parts[1], "status": parts[2]})
    except Exception:
        pass
    return containers

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Registry Universal Scanner")
    parser.add_argument("--roots", default="/home,/opt,/srv", help="Comma-separated root directories")
    parser.add_argument("--out", default=None, help="Output file path")
    args = parser.parse_args()

    roots = [r.strip() for r in args.roots.split(",") if r.strip()]
    repos = find_repos(roots)
    services = scan_services()
    ports = scan_ports()
    containers = scan_containers()

    hostname = socket.gethostname()
    scan = {
        "hostname": hostname,
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "repos": repos,
        "services": services,
        "ports": ports,
        "containers": containers,
    }

    output = json.dumps(scan, indent=2, ensure_ascii=False)
    if args.out:
        with open(args.out, "w") as f:
            f.write(output)
        print(f"Scan written to {args.out}: {len(repos)} repos, {len(services)} services, {len(ports)} ports, {len(containers)} containers", file=sys.stderr)
    else:
        print(output)

if __name__ == "__main__":
    main()
SCANNERPY
ok "scanner.py"

# ---- registry-build.sh (the build orchestrator) ----
cat > "${REGISTRY_DIR}/registry-build.sh" <<'BUILDSH'
#!/usr/bin/env bash
# Registry Universal - Build Orchestrator
# Runs scanner -> classifier -> trace-mcp -> topology-builder
set -o errexit -o nounset -o pipefail

REGISTRY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGISTRY_DATA="${REGISTRY_DATA:-$HOME/.registry-data}"
ROOTS="${ROOTS:-/home,/opt,/srv}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
RUN_TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="$REGISTRY_DATA/logs"
RUN_LOG="$LOG_DIR/build-$RUN_TS.log"

mkdir -p "$REGISTRY_DATA/graphs" "$LOG_DIR"

log()  { printf '%s [%s] %s\n' "$(date -u +%H:%M:%S)" "$1" "${*:2}" | tee -a "$RUN_LOG" >&2; }
info() { log INFO "$@"; }
warn() { log WARN "$@"; }

REPOS_FOUND=0
REPOS_CLASSIFIED=0
TRACE_OK=0

info "Registry build $RUN_TS"
info "ROOTS=$ROOTS REGISTRY_DATA=$REGISTRY_DATA"

# Phase 1: Scanner
info "PHASE 1/4 -- Scanning repos in: $ROOTS"
SCAN_TMP="$REGISTRY_DATA/server-scan.json.tmp.$$"
if "$PYTHON_BIN" "$REGISTRY_DIR/scanner.py" --roots "$ROOTS" --out "$SCAN_TMP" >>"$RUN_LOG" 2>&1; then
  mv -f "$SCAN_TMP" "$REGISTRY_DATA/server-scan.json"
  REPOS_FOUND="$(command -v jq >/dev/null && jq '.repos | length' "$REGISTRY_DATA/server-scan.json" 2>/dev/null || echo '?')"
  info "Scanner OK -- $REPOS_FOUND repos found"
else
  rm -f "$SCAN_TMP"
  warn "Scanner failed"
  REPOS_FOUND=0
fi

# Phase 2: Classifier
info "PHASE 2/4 -- Classifying repos"
PARTS_FILE="$(mktemp)"
trap "rm -f '$PARTS_FILE'" EXIT

if command -v jq >/dev/null 2>&1 && [ -f "$REGISTRY_DATA/server-scan.json" ]; then
  while IFS= read -r repo; do
    [ -z "$repo" ] && continue
    [ ! -d "$repo" ] && continue
    if out="$("$PYTHON_BIN" "$REGISTRY_DIR/classifier.py" "$repo" --compact 2>>"$RUN_LOG")"; then
      printf '%s\n' "$out" >> "$PARTS_FILE"
      REPOS_CLASSIFIED=$((REPOS_CLASSIFIED + 1))
    else
      warn "Classifier failed for: $repo"
    fi
  done < <(jq -r '.repos[].path // empty' "$REGISTRY_DATA/server-scan.json")

  jq -s '.' "$PARTS_FILE" > "$REGISTRY_DATA/projects.json" 2>>"$RUN_LOG" || true
  info "Classification OK -- $REPOS_CLASSIFIED classified"
fi

# Phase 3: trace-mcp index
info "PHASE 3/4 -- trace-mcp indexing"
if command -v trace-mcp >/dev/null 2>&1 && [ -f "$REGISTRY_DATA/projects.json" ] && command -v jq >/dev/null 2>&1; then
  while IFS= read -r repo; do
    [ -z "$repo" ] || [ ! -d "$repo" ] && continue
    info "  trace-mcp index $repo"
    if timeout 600 trace-mcp index "$repo" >>"$RUN_LOG" 2>&1; then
      TRACE_OK=$((TRACE_OK + 1))
    else
      warn "  trace-mcp failed for: $repo"
    fi
  done < <(jq -r '[.[] | select(.type == "saas" or .type == "api")] | .[].path // empty' "$REGISTRY_DATA/projects.json")
  info "trace-mcp OK -- $TRACE_OK indexed"
else
  warn "trace-mcp not available or no projects.json, skipping"
fi

# Phase 4: Topology builder
info "PHASE 4/4 -- Building topology"
BACKSTAGE="$REGISTRY_DIR/backstage-api"
if [ -f "$BACKSTAGE/topology-builder.mjs" ]; then
  if node "$BACKSTAGE/topology-builder.mjs" >>"$RUN_LOG" 2>&1; then
    info "Topology build OK"
  else
    warn "Topology builder failed"
  fi
fi

# Summary
ENDED="$(date -u +%Y%m%dT%H%M%SZ)"
if command -v jq >/dev/null 2>&1; then
  jq -n \
    --arg status "ok" --arg started "$RUN_TS" --arg ended "$ENDED" \
    --argjson found "$REPOS_FOUND" --argjson classified "$REPOS_CLASSIFIED" \
    --argjson traced "$TRACE_OK" \
    '{status:$status, started:$started, ended:$ended,
      repos:{found:$found, classified:$classified, traced:$traced}}' \
    > "$REGISTRY_DATA/build-summary.json"
fi

info "Build complete: $REPOS_FOUND found, $REPOS_CLASSIFIED classified, $TRACE_OK indexed"
BUILDSH
chmod +x "${REGISTRY_DIR}/registry-build.sh"
ok "registry-build.sh"

# ---- public/index.html (5-tab dashboard) ----
# This is the largest embedded file
info "Writing dashboard (public/index.html)..."

cat > "${BACKSTAGE_DIR}/public/index.html" <<'DASHHTML'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Registry Universal — Sypnose</title>
<style>
:root {
  --bg:#0c0f14; --bg-2:#11151c; --panel:#161b24; --panel-2:#1c2230;
  --border:#232b38; --border-2:#2d3b4d; --text:#d7dde7; --text-dim:#8a95a6;
  --text-faint:#5b6577; --accent:#4da3ff; --accent-2:#2563eb;
  --ok:#36d399; --warn:#fbbf24; --err:#f87171;
  --shadow:0 1px 3px rgba(0,0,0,.45), 0 8px 24px rgba(0,0,0,.25);
  --radius:10px;
  --mono:ui-monospace,"SF Mono","JetBrains Mono","Cascadia Code",Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --t-saas:#a855f7; --t-api:#4da3ff; --t-bot:#f59e0b; --t-worker:#14b8a6;
  --t-scraper:#ec4899; --t-web:#34d399; --t-library:#94a3b8; --t-unknown:#64748b;
}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{background:radial-gradient(1200px 600px at 80% -10%,#131a26 0%,var(--bg) 55%) fixed;
  color:var(--text);font-family:var(--sans);font-size:14px;line-height:1.5;
  -webkit-font-smoothing:antialiased;padding:0 0 64px}
a{color:var(--accent);text-decoration:none}.wrap{max-width:1240px;margin:0 auto;padding:0 20px}
header{position:sticky;top:0;z-index:50;backdrop-filter:blur(10px);
  background:rgba(12,15,20,.82);border-bottom:1px solid var(--border)}
.head-row{display:flex;align-items:center;gap:18px;padding:14px 0;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:11px;min-width:0}
.logo{width:34px;height:34px;border-radius:9px;flex:0 0 auto;
  background:linear-gradient(135deg,var(--accent) 0%,var(--t-saas) 100%);
  display:grid;place-items:center;font-weight:800;color:#061018;box-shadow:var(--shadow);font-size:17px}
.brand h1{font-size:16px;margin:0;font-weight:700;letter-spacing:.2px}
.brand .sub{font-size:11.5px;color:var(--text-faint)}
.head-stats{display:flex;gap:22px;margin-left:auto;flex-wrap:wrap}
.hstat{text-align:right}.hstat .v{font-size:17px;font-weight:700;font-variant-numeric:tabular-nums}
.hstat .l{font-size:10.5px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.6px}
.hstat .v.mono{font-family:var(--mono);font-size:14px}
.tabs{display:flex;gap:2px;margin-top:12px;border-bottom:2px solid var(--border)}
.tab{padding:9px 18px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;
  margin-bottom:-2px;color:var(--text-dim);transition:all .15s}
.tab:hover{color:var(--text)}.tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.tab-content{display:none}.tab-content.active{display:block}
.section{margin-top:30px}
.section>h2{font-size:12.5px;text-transform:uppercase;letter-spacing:1.1px;color:var(--text-dim);
  margin:0 0 13px;font-weight:700;display:flex;align-items:center;gap:9px}
.section>h2 .count{font-family:var(--mono);font-size:11px;color:var(--text-faint);
  background:var(--panel);border:1px solid var(--border);padding:1px 8px;border-radius:999px;font-weight:600}
.type-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
.type-card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);
  padding:15px 16px;position:relative;overflow:hidden;box-shadow:var(--shadow)}
.type-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--tc,var(--accent))}
.type-card .num{font-size:30px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums}
.type-card .lbl{margin-top:7px;font-size:12px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.7px;
  display:flex;align-items:center;gap:7px}
.type-card .lbl::before{content:"";width:8px;height:8px;border-radius:2px;background:var(--tc,var(--accent))}
.panel{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);
  box-shadow:var(--shadow);overflow:hidden}
.panel+.panel{margin-top:14px}
.panel-head{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--border);background:var(--bg-2)}
.panel-head h3{margin:0;font-size:13.5px;font-weight:700}
.panel-head .meta{margin-left:auto;font-size:11.5px;color:var(--text-faint);font-family:var(--mono)}
.panel-body{padding:4px 0}
.grid-2{display:grid;gap:14px;grid-template-columns:1fr 1fr}
@media(max-width:860px){.grid-2{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.7px;color:var(--text-faint);
  font-weight:700;padding:9px 16px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg-2)}
td{padding:9px 16px;border-bottom:1px solid rgba(35,43,56,.5);vertical-align:middle}
tr:last-child td{border-bottom:none}tbody tr{transition:background .12s}tbody tr:hover{background:var(--panel-2)}
.mono{font-family:var(--mono)}.scroll-y{max-height:360px;overflow-y:auto}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;
  padding:2px 9px;border-radius:999px;border:1px solid var(--border);background:var(--panel-2);white-space:nowrap}
.pill .d{width:7px;height:7px;border-radius:50%;background:var(--text-faint)}
.pill.s-ok{color:var(--ok);border-color:rgba(54,211,153,.35);background:rgba(54,211,153,.08)}
.pill.s-ok .d{background:var(--ok)}
.badge{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;
  padding:2px 8px;border-radius:6px;color:#08101c;background:var(--tc,var(--accent))}
.proj{border-bottom:1px solid rgba(35,43,56,.5)}.proj:last-child{border-bottom:none}
.proj-row{display:grid;grid-template-columns:20px 1.6fr 92px 1fr auto;gap:12px;align-items:center;
  padding:11px 16px;cursor:pointer;transition:background .12s}
.proj-row:hover{background:var(--panel-2)}
.proj-row .caret{color:var(--text-faint);transition:transform .18s;font-size:12px}
.proj.open .proj-row .caret{transform:rotate(90deg);color:var(--accent)}
.proj-name{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.proj-detail{display:none;padding:4px 16px 18px 48px;background:var(--bg-2);border-top:1px dashed var(--border)}
.proj.open .proj-detail{display:block}
.kv{display:grid;grid-template-columns:130px 1fr;gap:4px 14px;font-size:12.5px;margin-top:12px}
.kv dt{color:var(--text-faint)}.kv dd{margin:0;color:var(--text)}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font-family:var(--mono);font-size:11px;padding:2px 8px;border-radius:6px;
  background:var(--panel-2);border:1px solid var(--border);color:var(--text-dim)}
.state{padding:26px 16px;text-align:center;color:var(--text-faint);font-size:13px}
.state.err{color:var(--err)}.state .ico{font-size:22px;display:block;margin-bottom:6px;opacity:.8}
.skel{height:14px;border-radius:6px;margin:10px 16px;
  background:linear-gradient(90deg,var(--panel-2) 25%,var(--border) 37%,var(--panel-2) 63%);
  background-size:400% 100%;animation:shimmer 1.4s ease infinite}
@keyframes shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}
.topo-wrap{min-height:400px;position:relative;overflow:hidden}
.topo-wrap svg{width:100%;height:auto}
.topo-node{cursor:pointer}.topo-node:hover rect{stroke:var(--accent);stroke-width:2}
.topo-edge{stroke:var(--border-2);stroke-width:1.5;fill:none;opacity:.6}
.topo-edge.highlight{stroke:var(--accent);opacity:1;stroke-width:2.5}
.cg-wrap{display:grid;grid-template-columns:240px 1fr 300px;gap:1px;min-height:500px;
  background:var(--border);border-radius:var(--radius);overflow:hidden}
.cg-panel{background:var(--panel);padding:12px;overflow-y:auto;max-height:600px}
.cg-panel h4{margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--text-dim)}
.cg-item{padding:6px 8px;font-size:12px;cursor:pointer;border-radius:6px;transition:background .1s;
  font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cg-item:hover,.cg-item.active{background:var(--panel-2);color:var(--accent)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 8px var(--ok)}
.dot.stale{background:var(--warn);box-shadow:0 0 8px var(--warn)}
.dot.dead{background:var(--err);box-shadow:0 0 8px var(--err)}
.refresh-pill{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;color:var(--text-dim);
  border:1px solid var(--border);border-radius:999px;padding:5px 11px;background:var(--panel);
  cursor:pointer;user-select:none;transition:border-color .15s}
.refresh-pill:hover{border-color:var(--accent)}
footer{margin-top:36px;text-align:center;color:var(--text-faint);font-size:11.5px}
</style>
</head>
<body>
<header>
<div class="wrap head-row">
  <div class="brand">
    <div class="logo">R</div>
    <div><h1>Registry Universal</h1><div class="sub" id="hostline">loading...</div></div>
  </div>
  <div class="head-stats">
    <div class="hstat"><div class="v" id="st-proj">--</div><div class="l">Projects</div></div>
    <div class="hstat"><div class="v" id="st-syms">--</div><div class="l">Symbols</div></div>
    <div class="hstat"><div class="v mono" id="st-age">--</div><div class="l">Scan</div></div>
    <div class="hstat">
      <div class="refresh-pill" id="refreshBtn" title="Refresh now">
        <span class="dot" id="liveDot"></span><span id="refreshLbl">auto 30s</span>
      </div>
    </div>
  </div>
</div>
<div class="wrap">
  <div class="tabs" id="tabBar">
    <div class="tab active" data-tab="projects">Projects</div>
    <div class="tab" data-tab="services">Services</div>
    <div class="tab" data-tab="codegraph">CodeGraph</div>
    <div class="tab" data-tab="topology">Topology Map</div>
    <div class="tab" data-tab="gaps">Gaps</div>
  </div>
</div>
</header>
<main class="wrap">
  <!-- TAB: Projects -->
  <div class="tab-content active" id="tab-projects">
    <section class="section"><h2>Inventory by type <span class="count" id="types-total"></span></h2>
      <div class="type-grid" id="typeGrid"><div class="type-card"><div class="skel" style="margin:0;width:50%"></div></div></div>
    </section>
    <section class="section"><h2>Projects <span class="count" id="proj-count"></span></h2>
      <div class="panel"><div class="panel-head"><h3>Classified repos</h3><span class="meta">click to expand</span></div>
        <div class="panel-body" id="projList"><div class="skel"></div></div>
      </div>
    </section>
  </div>
  <!-- TAB: Services -->
  <div class="tab-content" id="tab-services">
    <section class="section"><h2>Server</h2>
      <div class="grid-2">
        <div class="panel"><div class="panel-head"><h3>Services</h3><span class="meta" id="srv-svc-n"></span></div>
          <div class="panel-body scroll-y" id="srvServices"><div class="skel"></div></div></div>
        <div class="panel"><div class="panel-head"><h3>Ports</h3><span class="meta" id="srv-port-n"></span></div>
          <div class="panel-body scroll-y" id="srvPorts"><div class="skel"></div></div></div>
      </div>
      <div class="panel" style="margin-top:14px"><div class="panel-head"><h3>Containers</h3><span class="meta" id="srv-cont-n"></span></div>
        <div class="panel-body scroll-y" id="srvContainers"><div class="skel"></div></div></div>
    </section>
  </div>
  <!-- TAB: CodeGraph -->
  <div class="tab-content" id="tab-codegraph">
    <section class="section"><h2>Code Graph Browser</h2>
      <div class="cg-wrap">
        <div class="cg-panel" id="cgProjects"><h4>Projects</h4><div class="skel"></div></div>
        <div class="cg-panel" id="cgSymbols"><h4>Symbols</h4><div class="state">Select a project</div></div>
        <div class="cg-panel" id="cgDetail"><h4>Detail</h4><div class="state">Select a symbol</div></div>
      </div>
    </section>
  </div>
  <!-- TAB: Topology Map -->
  <div class="tab-content" id="tab-topology">
    <section class="section"><h2>Cross-Project Topology</h2>
      <div class="panel"><div class="panel-head"><h3>Topology Map</h3><span class="meta" id="topo-meta"></span></div>
        <div class="panel-body topo-wrap" id="topoWrap"><div class="state">Loading topology...</div></div>
      </div>
    </section>
  </div>
  <!-- TAB: Gaps -->
  <div class="tab-content" id="tab-gaps">
    <section class="section"><h2>Gap Analysis</h2>
      <div class="panel"><div class="panel-body">
        <div class="state"><span class="ico">--</span>Gap analysis coming soon.<br>Will detect: missing tests, undocumented endpoints, orphan symbols, broken cross-project references.</div>
      </div></div>
    </section>
  </div>
  <footer>Registry Universal -- Sypnose &middot; auto-refresh 30s</footer>
</main>
<script>
"use strict";
(function(){
var TYPE_COLOR={saas:"var(--t-saas)",api:"var(--t-api)",bot:"var(--t-bot)",worker:"var(--t-worker)",
  scraper:"var(--t-scraper)",web:"var(--t-web)",library:"var(--t-library)",unknown:"var(--t-unknown)"};
var TYPE_ORDER=["saas","api","bot","worker","scraper","web","library","unknown"];
function $(id){return document.getElementById(id)}
function esc(v){if(v==null)return"";return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
function toArr(x){if(Array.isArray(x))return x;if(x&&Array.isArray(x.projects))return x.projects;if(x&&Array.isArray(x.data))return x.data;return[]}
function getJSON(p){return fetch(p,{cache:"no-store"}).then(function(r){return r.json().then(function(d){return{ok:r.ok,data:d}}).catch(function(){return{ok:false,data:null}})}).catch(function(){return{ok:false,data:null}})}
function humanAge(s){if(s==null||isNaN(s))return"--";s=Math.max(0,Math.round(s));if(s<60)return s+"s";var m=Math.floor(s/60);if(m<60)return m+"m";var h=Math.floor(m/60);return h+"h "+m%60+"m"}
function statusClass(s){s=String(s||"").toLowerCase();if(/(running|active|up|ok|listen)/.test(s))return"s-ok";return""}

// Tabs
document.querySelectorAll(".tab").forEach(function(t){t.addEventListener("click",function(){
  document.querySelectorAll(".tab").forEach(function(x){x.classList.remove("active")});
  document.querySelectorAll(".tab-content").forEach(function(x){x.classList.remove("active")});
  t.classList.add("active");$("tab-"+t.dataset.tab).classList.add("active");
  if(t.dataset.tab==="codegraph"&&!cgLoaded)loadCodeGraph();
  if(t.dataset.tab==="topology"&&!topoLoaded)loadTopology();
})});

// Projects tab
function loadProjects(){
  getJSON("/registry/summary").then(function(r){
    if(!r.ok||!r.data){$("hostline").textContent="no data";return}
    var d=r.data;$("hostline").textContent=d.hostname||"unknown";
    $("st-age").textContent="ago "+humanAge(d.data_age_seconds);
    $("liveDot").className="dot"+(d.data_age_seconds>3600?" stale":"");
    if(d.by_type){
      var keys=Object.keys(d.by_type),ordered=TYPE_ORDER.filter(function(k){return k in d.by_type});
      keys.forEach(function(k){if(ordered.indexOf(k)===-1)ordered.push(k)});
      var total=0;ordered.forEach(function(k){total+=(d.by_type[k]||0)});
      $("types-total").textContent=total+" repos";
      $("typeGrid").innerHTML=ordered.map(function(k){
        var c=TYPE_COLOR[k]||"var(--accent)";
        return'<div class="type-card" style="--tc:'+c+'"><div class="num">'+esc(d.by_type[k]||0)+'</div><div class="lbl">'+esc(k)+'</div></div>';
      }).join("");
    }
  });
  getJSON("/registry/projects").then(function(r){
    if(!r.ok){$("projList").innerHTML='<div class="state err">No data</div>';return}
    var list=toArr(r.data);$("proj-count").textContent=list.length;
    list.sort(function(a,b){return(a.type==="saas"?0:1)-(b.type==="saas"?0:1)||String(a.name||"").localeCompare(String(b.name||""))});
    $("projList").innerHTML=list.map(function(p,i){
      var t=String(p.type||"unknown").toLowerCase(),c=TYPE_COLOR[t]||"var(--accent)";
      var stack=Array.isArray(p.stack)?p.stack:[];
      return'<div class="proj" id="proj-'+i+'"><div class="proj-row"><span class="caret">&#9654;</span>'+
        '<span class="proj-name">'+esc(p.name)+'</span><span><span class="badge" style="--tc:'+c+'">'+esc(t)+'</span></span>'+
        '<span style="color:var(--text-dim);font-size:12px">'+esc(p.framework||"--")+'</span>'+
        '<span class="mono" style="font-size:12px;color:var(--text-dim);text-align:right">'+esc(p.endpoints_approx||0)+' ep</span></div>'+
        '<div class="proj-detail"><dl class="kv"><dt>Type</dt><dd><span class="badge" style="--tc:'+c+'">'+esc(t)+'</span></dd>'+
        '<dt>Language</dt><dd>'+esc(p.language||"unknown")+'</dd>'+
        (p.framework?'<dt>Framework</dt><dd>'+esc(p.framework)+'</dd>':'')+
        '<dt>Files</dt><dd class="mono">'+esc(p.file_count||0)+'</dd>'+
        (stack.length?'<dt>Stack</dt><dd><div class="chips">'+stack.map(function(s){return'<span class="chip">'+esc(s)+'</span>'}).join("")+'</div></dd>':'')+
        '</dl></div></div>';
    }).join("");
    $("projList").querySelectorAll(".proj-row").forEach(function(r){r.addEventListener("click",function(){this.parentNode.classList.toggle("open")})});
  });
}

// Services tab
function loadServices(){
  getJSON("/registry/server").then(function(r){
    if(!r.ok||!r.data){return}
    var d=r.data;
    var svcs=d.services||d.processes||[];$("srv-svc-n").textContent=svcs.length;
    $("srvServices").innerHTML=svcs.length?'<table><thead><tr><th>Service</th><th>Status</th></tr></thead><tbody>'+
      svcs.map(function(s){var n=typeof s==="string"?s:(s.name||"--"),st=typeof s==="string"?"":(s.status||"");
        return'<tr><td>'+esc(n)+'</td><td><span class="pill '+statusClass(st)+'"><span class="d"></span>'+esc(st||"--")+'</span></td></tr>'}).join("")+
      '</tbody></table>':'<div class="state">No services data</div>';
    var ports=d.ports||d.listening||[];$("srv-port-n").textContent=ports.length;
    $("srvPorts").innerHTML=ports.length?'<table><thead><tr><th>Port</th><th>Process</th></tr></thead><tbody>'+
      ports.map(function(p){var port=typeof p==="object"?(p.port||"--"):p,proc=typeof p==="object"?(p.process||"--"):"";
        return'<tr><td class="mono" style="color:var(--accent)">'+esc(port)+'</td><td class="mono">'+esc(proc)+'</td></tr>'}).join("")+
      '</tbody></table>':'<div class="state">No ports data</div>';
    var conts=d.containers||d.docker||[];$("srv-cont-n").textContent=conts.length;
    $("srvContainers").innerHTML=conts.length?'<table><thead><tr><th>Name</th><th>Image</th><th>Status</th></tr></thead><tbody>'+
      conts.map(function(c){return'<tr><td>'+esc(c.name||"--")+'</td><td class="mono" style="font-size:11.5px;color:var(--text-dim)">'+esc(c.image||"--")+
        '</td><td><span class="pill '+statusClass(c.status)+'"><span class="d"></span>'+esc(c.status||"--")+'</span></td></tr>'}).join("")+
      '</tbody></table>':'<div class="state">No containers</div>';
  });
}

// CodeGraph tab
var cgLoaded=false;
function loadCodeGraph(){
  cgLoaded=true;
  getJSON("/multi/projects").then(function(r){
    if(!r.ok||!r.data){$("cgProjects").innerHTML='<h4>Projects</h4><div class="state">No indexed projects</div>';return}
    var list=r.data.projects||[];
    $("st-proj").textContent=list.length;
    var totalSyms=0;list.forEach(function(p){totalSyms+=(p.stats&&p.stats.symbols)||0});
    $("st-syms").textContent=totalSyms;
    $("cgProjects").innerHTML='<h4>Projects ('+list.length+')</h4>'+list.map(function(p){
      return'<div class="cg-item" data-project="'+esc(p.name)+'">'+esc(p.name)+' <span style="color:var(--text-faint);font-size:10px">'+
        esc((p.stats&&p.stats.symbols)||0)+' sym</span></div>'}).join("");
    $("cgProjects").querySelectorAll(".cg-item").forEach(function(el){el.addEventListener("click",function(){
      document.querySelectorAll("#cgProjects .cg-item").forEach(function(x){x.classList.remove("active")});
      el.classList.add("active");loadProjectSymbols(el.dataset.project);
    })});
  });
}
function loadProjectSymbols(name){
  $("cgSymbols").innerHTML='<h4>Symbols</h4><div class="state">Loading...</div>';
  getJSON("/multi/project/"+encodeURIComponent(name)).then(function(r){
    if(!r.ok||!r.data){$("cgSymbols").innerHTML='<h4>Symbols</h4><div class="state err">Failed</div>';return}
    var syms=r.data.symbols||[];
    $("cgSymbols").innerHTML='<h4>Symbols ('+syms.length+')</h4>'+syms.slice(0,200).map(function(s){
      return'<div class="cg-item" data-sym="'+esc(s.name)+'"><span style="color:var(--text-faint);font-size:10px">'+
        esc(s.kind||"")+'</span> '+esc(s.name)+'</div>'}).join("");
    $("cgSymbols").querySelectorAll(".cg-item").forEach(function(el){el.addEventListener("click",function(){
      $("cgDetail").innerHTML='<h4>'+esc(el.dataset.sym)+'</h4>'+
        '<dl class="kv"><dt>Name</dt><dd class="mono">'+esc(el.dataset.sym)+'</dd></dl>';
    })});
    var routes=r.data.routes||[];var envs=r.data.env_vars||[];
    $("cgDetail").innerHTML='<h4>'+esc(name)+'</h4>'+
      '<dl class="kv"><dt>Files</dt><dd class="mono">'+esc(r.data.stats.files)+'</dd>'+
      '<dt>Symbols</dt><dd class="mono">'+esc(r.data.stats.symbols)+'</dd>'+
      '<dt>Routes</dt><dd class="mono">'+esc(r.data.stats.routes)+'</dd>'+
      '<dt>Env Vars</dt><dd class="mono">'+esc(r.data.stats.env_vars)+'</dd></dl>'+
      (routes.length?'<h4 style="margin-top:16px">Routes</h4>'+routes.slice(0,30).map(function(rt){
        return'<div class="cg-item"><span style="color:var(--accent);font-weight:700">'+esc(rt.method||"GET")+'</span> '+esc(rt.uri)+'</div>'}).join(""):"")+
      (envs.length?'<h4 style="margin-top:16px">Env Vars</h4>'+envs.slice(0,20).map(function(ev){
        return'<div class="cg-item">'+esc(ev.key)+'</div>'}).join(""):"");
  });
}

// Topology tab
var topoLoaded=false;
function loadTopology(){
  topoLoaded=true;
  getJSON("/multi/topology").then(function(r){
    if(!r.ok||!r.data){$("topoWrap").innerHTML='<div class="state">No topology data. Run a build first.</div>';return}
    var topo=r.data,projs=topo.projects||[],edges=topo.cross_service_edges||[],exts=topo.external_services||[];
    $("topo-meta").textContent=projs.length+" projects, "+edges.length+" edges, "+exts.length+" externals";
    // Build SVG Sankey-style
    var W=1200,margin=40,nodeW=160,nodeH=36,gap=16;
    var allNodes=[],cols={};
    // Assign columns by type
    var colOrder=["saas","api","bot","scraper","web","library","unknown"];
    projs.forEach(function(p){var t=p.type||"unknown";if(!cols[t])cols[t]=[];cols[t].push(p)});
    var colKeys=colOrder.filter(function(k){return cols[k]&&cols[k].length});
    var colW=(W-2*margin)/Math.max(colKeys.length,1);
    colKeys.forEach(function(ck,ci){
      var items=cols[ck];items.forEach(function(p,pi){
        allNodes.push({id:p.name,x:margin+ci*colW,y:margin+pi*(nodeH+gap),type:ck,data:p});
      });
    });
    var H=margin*2+Math.max.apply(null,colKeys.map(function(ck){return cols[ck].length*(nodeH+gap)}))||400;
    var nodeMap={};allNodes.forEach(function(n){nodeMap[n.id]=n});
    // External service nodes on the right
    exts.forEach(function(ext,ei){
      nodeMap[ext.name]={id:ext.name,x:W-margin-nodeW,y:margin+ei*(nodeH+gap),type:"external",data:ext};
      allNodes.push(nodeMap[ext.name]);
    });
    H=Math.max(H,margin*2+(exts.length||1)*(nodeH+gap));
    var svg='<svg viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" style="font-family:var(--sans)">';
    // Draw edges
    edges.forEach(function(e){
      var src=nodeMap[e.source],tgt=nodeMap[e.target];
      if(!src||!tgt)return;
      var x1=src.x+nodeW,y1=src.y+nodeH/2,x2=tgt.x,y2=tgt.y+nodeH/2;
      var cpx=(x1+x2)/2;
      svg+='<path class="topo-edge" d="M'+x1+','+y1+' C'+cpx+','+y1+' '+cpx+','+y2+' '+x2+','+y2+'" data-src="'+esc(e.source)+'" data-tgt="'+esc(e.target)+'"/>';
    });
    // Draw ext service edges
    exts.forEach(function(ext){
      var tgt=nodeMap[ext.name];if(!tgt)return;
      (ext.referenced_by||[]).forEach(function(ref){
        var src=nodeMap[ref];if(!src)return;
        var x1=src.x+nodeW,y1=src.y+nodeH/2,x2=tgt.x,y2=tgt.y+nodeH/2,cpx=(x1+x2)/2;
        svg+='<path class="topo-edge" d="M'+x1+','+y1+' C'+cpx+','+y1+' '+cpx+','+y2+' '+x2+','+y2+'" stroke="var(--t-scraper)" opacity=".4"/>';
      });
    });
    // Draw nodes
    allNodes.forEach(function(n){
      var c=TYPE_COLOR[n.type]||"var(--text-faint)";
      svg+='<g class="topo-node" data-id="'+esc(n.id)+'"><rect x="'+n.x+'" y="'+n.y+'" width="'+nodeW+'" height="'+nodeH+
        '" rx="8" fill="var(--panel)" stroke="'+c+'" stroke-width="1.5"/>'+
        '<text x="'+(n.x+10)+'" y="'+(n.y+22)+'" fill="var(--text)" font-size="12" font-weight="600">'+esc(n.id.slice(0,18))+'</text></g>';
    });
    svg+='</svg>';
    $("topoWrap").innerHTML=svg;
    // Click to highlight
    $("topoWrap").querySelectorAll(".topo-node").forEach(function(nd){nd.addEventListener("click",function(){
      var id=nd.dataset.id;
      $("topoWrap").querySelectorAll(".topo-edge").forEach(function(e){
        e.classList.toggle("highlight",e.dataset.src===id||e.dataset.tgt===id);
      });
    })});
  });
}

// Load cycle
var loading=false;
function loadAll(){
  if(loading)return;loading=true;
  Promise.all([loadProjects(),loadServices()]).then(function(){loading=false}).catch(function(){loading=false});
}
$("refreshBtn").addEventListener("click",function(){loadAll()});
document.addEventListener("visibilitychange",function(){if(!document.hidden)loadAll()});
loadAll();
setInterval(function(){if(!document.hidden)loadAll()},30000);
})();
</script>
</body>
</html>
DASHHTML
ok "public/index.html (5-tab dashboard)"

# ---------------------------------------------------------------------------
# Step 6: Install npm dependencies
# ---------------------------------------------------------------------------
step "Step 6/8: npm install"

cd "${BACKSTAGE_DIR}"
if [ -d "node_modules" ] && [ -f "node_modules/.package-lock.json" ]; then
  ok "node_modules exists, running npm install to update..."
fi
npm install --production 2>&1 | tail -3
ok "npm dependencies installed"

# ---------------------------------------------------------------------------
# Step 7: Systemd user services
# ---------------------------------------------------------------------------
step "Step 7/8: Systemd user services"

SYSTEMD_DIR="${HOME}/.config/systemd/user"
mkdir -p "${SYSTEMD_DIR}"

# Enable linger for non-root users (allows user services to run without login)
if [ "$IS_ROOT" -eq 0 ]; then
  if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "$(id -un)" 2>/dev/null || true
    ok "loginctl enable-linger (services persist after logout)"
  fi
fi

# ---- registry-api.service ----
cat > "${SYSTEMD_DIR}/registry-api.service" <<SVCEOF
[Unit]
Description=Sypnose Registry API Server
After=network.target

[Service]
Type=simple
WorkingDirectory=${BACKSTAGE_DIR}
ExecStart=$(command -v node) ${BACKSTAGE_DIR}/server.js
Environment=PORT=${API_PORT}
Environment=REGISTRY_DATA=${DATA_DIR}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
SVCEOF
ok "registry-api.service"

# ---- registry-refresh.service ----
cat > "${SYSTEMD_DIR}/registry-refresh.service" <<REFSVCEOF
[Unit]
Description=Sypnose Registry Refresh (scan + index + topology)

[Service]
Type=oneshot
ExecStart=/bin/bash ${REGISTRY_DIR}/registry-build.sh
Environment=REGISTRY_DATA=${DATA_DIR}
Environment=ROOTS=/home,/opt,/srv
Environment=PATH=${HOME}/.npm-global/bin:${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin
REFSVCEOF
ok "registry-refresh.service"

# ---- registry-refresh.timer ----
cat > "${SYSTEMD_DIR}/registry-refresh.timer" <<TIMEOF
[Unit]
Description=Sypnose Registry Refresh Timer (every 15 min)

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
Persistent=true

[Install]
WantedBy=timers.target
TIMEOF
ok "registry-refresh.timer"

# Reload and enable
systemctl --user daemon-reload 2>/dev/null || true
systemctl --user enable registry-api.service 2>/dev/null || true
systemctl --user enable registry-refresh.timer 2>/dev/null || true
ok "Systemd units enabled"

# ---------------------------------------------------------------------------
# Step 8: First run — auto-detect, index, start
# ---------------------------------------------------------------------------
step "Step 8/8: First run"

info "Auto-detecting projects..."

# Run the scanner + classifier
if bash "${REGISTRY_DIR}/registry-build.sh" 2>&1 | tail -5; then
  ok "Initial scan complete"
else
  warn "Initial scan had errors (non-fatal, API will still start)"
fi

# Count what we found
PROJ_COUNT=0
if [ -f "${DATA_DIR}/projects.json" ] && command -v jq >/dev/null 2>&1; then
  PROJ_COUNT="$(jq 'length' "${DATA_DIR}/projects.json" 2>/dev/null || echo 0)"
fi

# Start the API server
systemctl --user restart registry-api.service 2>/dev/null || true
systemctl --user start registry-refresh.timer 2>/dev/null || true

# Wait a moment for the server to start
sleep 2

# Verify it's running
if systemctl --user is-active registry-api.service >/dev/null 2>&1; then
  ok "Registry API is running"
else
  warn "Systemd start failed. Trying direct start..."
  # Fallback: start directly in background
  cd "${BACKSTAGE_DIR}"
  PORT="${API_PORT}" REGISTRY_DATA="${DATA_DIR}" nohup node server.js > "${DATA_DIR}/logs/api.log" 2>&1 &
  sleep 2
  if curl -sf "http://localhost:${API_PORT}/health" >/dev/null 2>&1; then
    ok "Registry API running (direct mode, PID $!)"
  else
    warn "Could not start API server. Check: node ${BACKSTAGE_DIR}/server.js"
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
printf '\n'
printf '%s' "$C_BOLD$C_GREEN"
cat <<'DONE'
  ====================================================
       Sypnose Registry — Installation Complete
  ====================================================
DONE
printf '%s\n' "$C_RESET"

printf '  %sDashboard:%s   http://localhost:%s/\n' "$C_BOLD" "$C_RESET" "${API_PORT}"
printf '  %sAPI:%s         http://localhost:%s/registry/summary\n' "$C_BOLD" "$C_RESET" "${API_PORT}"
printf '  %sCodeGraph:%s   http://localhost:%s/multi/projects\n' "$C_BOLD" "$C_RESET" "${API_PORT}"
printf '  %sHealth:%s      http://localhost:%s/health\n' "$C_BOLD" "$C_RESET" "${API_PORT}"
printf '\n'
printf '  %sProjects found:%s   %s\n' "$C_BOLD" "$C_RESET" "${PROJ_COUNT}"
printf '  %sAuto-refresh:%s     every 15 minutes (systemd timer)\n' "$C_BOLD" "$C_RESET"
printf '  %sData dir:%s         %s\n' "$C_BOLD" "$C_RESET" "${DATA_DIR}"
printf '  %sInstall dir:%s      %s\n' "$C_BOLD" "$C_RESET" "${REGISTRY_DIR}"
printf '\n'
printf '  %sManage:%s\n' "$C_BOLD" "$C_RESET"
printf '    systemctl --user status registry-api\n'
printf '    systemctl --user restart registry-api\n'
printf '    journalctl --user -u registry-api -f\n'
printf '    systemctl --user list-timers\n'
printf '\n'
printf '  %s%sRegistry is ready.%s\n\n' "$C_BOLD" "$C_GREEN" "$C_RESET"
