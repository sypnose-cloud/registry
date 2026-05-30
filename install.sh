#!/usr/bin/env bash
# Sypnose Registry — one-command installer (Linux)
# Installs a live, auto-updating code+API+DB registry for ANY repo.
# Indexes your repo (trace-mcp + graphify), serves it over HTTP (:7008), refreshes every 15 min.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/sypnose-cloud/registry/main/install.sh | bash -s -- --repo /path/to/your/repo
#   (or set REGISTRY_REPO=/path/to/repo and pipe to bash)
set -euo pipefail

info(){ printf '\033[36m[INFO]\033[0m %s\n' "$1"; }
ok(){   printf '\033[32m[OK]  \033[0m %s\n' "$1"; }
warn(){ printf '\033[33m[WARN]\033[0m %s\n' "$1"; }
fail(){ printf '\033[31m[ERR] \033[0m %s\n' "$1"; exit 1; }

echo "=== Sypnose Registry Installer ==="

# --- args ---
REPO="${REGISTRY_REPO:-}"
PORT="${REGISTRY_PORT:-7008}"
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    *) shift;;
  esac
done
[ -z "$REPO" ] && fail "No repo given. Use: --repo /path/to/your/repo (the codebase to index)."
[ -d "$REPO" ] || fail "Repo path does not exist: $REPO"
REPO="$(cd "$REPO" && pwd)"
ok "Indexing repo: $REPO"

GH_REPO="sypnose-cloud/registry"
INSTALL_DIR="$HOME/.registry"
SVC_DIR="$INSTALL_DIR/backstage-api"

# --- 1. Prereqs ---
info "Checking prerequisites..."
command -v node >/dev/null 2>&1 || fail "Node.js 18+ required."
command -v npm  >/dev/null 2>&1 || fail "npm required."
command -v git  >/dev/null 2>&1 || fail "git required."
ok "Node/npm/git present."

# --- 2. Install trace-mcp (code graph indexer) ---
if ! command -v trace-mcp >/dev/null 2>&1; then
  info "Installing trace-mcp (npm -g)..."
  npm install -g trace-mcp 2>&1 | tail -1 || warn "trace-mcp global install had issues."
fi
command -v trace-mcp >/dev/null 2>&1 && ok "trace-mcp present." || warn "trace-mcp not on PATH — add ~/.npm-global/bin or npm bin -g to PATH."

# --- 3. Install graphify (optional, code-graph visual) ---
if ! command -v graphify >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    info "Installing graphify (uv tool)..."
    uv tool install graphifyy 2>&1 | tail -1 || warn "graphify install skipped."
  else
    warn "uv not found — graphify optional, skipping (registry works without it)."
  fi
fi

# --- 4. Get the backstage-api code (this repo) ---
info "Fetching registry API code..."
mkdir -p "$INSTALL_DIR"
TMP="$(mktemp -d)"
git clone --depth 1 "https://github.com/$GH_REPO.git" "$TMP" >/dev/null 2>&1 || fail "git clone $GH_REPO failed (need access)."
rm -rf "$SVC_DIR"; cp -r "$TMP/backstage-api" "$SVC_DIR"
mkdir -p "$INSTALL_DIR/scripts"; cp -r "$TMP/scripts/." "$INSTALL_DIR/scripts/" 2>/dev/null || true
rm -rf "$TMP"
( cd "$SVC_DIR" && npm install --omit=dev 2>&1 | tail -1 ) || fail "npm install in backstage-api failed."
ok "Registry API installed at $SVC_DIR"

# --- 5. First index of the repo ---
info "Indexing your repo (first run, may take a minute)..."
trace-mcp index "$REPO" 2>&1 | tail -2 || warn "first index had issues."
command -v graphify >/dev/null 2>&1 && (graphify update "$REPO" 2>&1 | tail -1 || true)

# --- 6. systemd user units (API service + 15-min refresh timer) ---
info "Setting up systemd user units..."
UNIT_DIR="$HOME/.config/systemd/user"; mkdir -p "$UNIT_DIR"
TRACE_BIN="$(command -v trace-mcp)"
GRAPHIFY_BIN="$(command -v graphify || echo /bin/true)"
NODE_BIN="$(command -v node)"

# API service (always on)
cat > "$UNIT_DIR/registry-api.service" <<EOF
[Unit]
Description=Sypnose Registry API (serves code+DB+API graph on :$PORT)
[Service]
Type=simple
Environment=REGISTRY_PORT=$PORT
Environment=REGISTRY_REPO=$REPO
WorkingDirectory=$SVC_DIR
ExecStart=$NODE_BIN server.js
Restart=always
RestartSec=5
[Install]
WantedBy=default.target
EOF

# Refresh service (oneshot, triggered by timer)
cat > "$UNIT_DIR/registry-refresh.service" <<EOF
[Unit]
Description=Sypnose Registry auto-update (reindex code graph)
[Service]
Type=oneshot
ExecStart=$TRACE_BIN index $REPO
ExecStartPost=-$GRAPHIFY_BIN update $REPO
ExecStartPost=-$NODE_BIN $INSTALL_DIR/scripts/build-frontend-api-map.mjs $REPO
EOF

# Refresh timer (every 15 min)
cat > "$UNIT_DIR/registry-refresh.timer" <<EOF
[Unit]
Description=Sypnose Registry refresh timer (every 15 min)
[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
Persistent=true
[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now registry-api.service 2>&1 | tail -1
systemctl --user enable --now registry-refresh.timer 2>&1 | tail -1
loginctl enable-linger "$USER" 2>/dev/null || warn "could not enable linger (run: sudo loginctl enable-linger $USER) — needed to survive logout."

# --- 7. Verify ---
sleep 3
info "Verifying..."
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 6 "http://localhost:$PORT/health" || echo 000)
if [ "$CODE" = "200" ]; then ok "Registry API live: http://localhost:$PORT/health -> 200"; else warn "API not responding yet (HTTP $CODE) — check: systemctl --user status registry-api"; fi

echo ""
echo "=== Sypnose Registry installed ==="
cat <<EOF

Your registry is live and auto-updates every 15 min.
  Health:           curl http://localhost:$PORT/health
  Code summary:     curl http://localhost:$PORT/codegraph/summary
  API -> tables:    curl http://localhost:$PORT/codegraph/routes-with-tables
  DB inventory:     curl http://localhost:$PORT/supabase/summary   (if a Supabase/Postgres is configured)

Indexed repo: $REPO
Refresh timer: systemctl --user list-timers registry-refresh.timer
EOF
