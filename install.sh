#!/usr/bin/env bash
# ============================================================================
# Sypnose Registry — UNIVERSAL one-command installer
# ============================================================================
# Installs a live, self-updating registry of an ENTIRE server: discovers every
# service, port, container and repo; classifies each project (saas/api/bot/
# worker/scraper/web/cli/library); maps SaaS APIs->DB->frontend; serves it all
# over HTTP for humans and AI agents. Auto-refreshes on a timer.
#
# Works on any clean Linux server. Installs its own dependencies (trace-mcp,
# repomix, graphify) if missing. No secrets in this repo.
#
# Usage:
#   git clone / gh repo clone sypnose-cloud/registry && cd registry
#   bash install.sh --roots "/home,/opt" --port 7008
# ============================================================================
set -euo pipefail

info(){ printf '\033[36m[INFO]\033[0m %s\n' "$1"; }
ok(){   printf '\033[32m[OK]  \033[0m %s\n' "$1"; }
warn(){ printf '\033[33m[WARN]\033[0m %s\n' "$1"; }
fail(){ printf '\033[31m[ERR] \033[0m %s\n' "$1"; exit 1; }

echo "======================================="
echo " Sypnose Registry — Universal Installer"
echo "======================================="

# --- args / config ---
ROOTS="${REGISTRY_ROOTS:-/home,/opt}"
PORT="${REGISTRY_PORT:-7008}"
while [ $# -gt 0 ]; do
  case "$1" in
    --roots) ROOTS="$2"; shift 2;;
    --port)  PORT="$2"; shift 2;;
    *) shift;;
  esac
done

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # where this repo is
INSTALL_DIR="$HOME/.registry"
DATA_DIR="$HOME/.registry-data"
mkdir -p "$INSTALL_DIR" "$DATA_DIR"
ok "Source: $SRC_DIR  |  Install: $INSTALL_DIR  |  Data: $DATA_DIR  |  Roots: $ROOTS"

# --- 1. Dependencies (delegates to install-deps.sh: node/trace-mcp/repomix/graphify) ---
info "Step 1/5 — Installing dependencies..."
if [ -f "$SRC_DIR/install-deps.sh" ]; then
  bash "$SRC_DIR/install-deps.sh" || warn "install-deps reported issues (continuing)."
else
  warn "install-deps.sh not found next to installer."
fi
# Make sure user npm bin is on PATH for the rest of this run.
export PATH="$(npm config get prefix 2>/dev/null)/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"

# --- 2. Copy the API server + scanner + classifier + orchestrator ---
# Idempotent: remove any previous copy BEFORE copying so we always land the new
# version. Without the rm, `cp -r` would nest the new dir inside the old one (or
# leave stale files behind), breaking re-installs.
info "Step 2/5 — Installing Registry files..."
rm -rf "$INSTALL_DIR/backstage-api"
cp -r "$SRC_DIR/backstage-api"  "$INSTALL_DIR/backstage-api"
rm -f  "$INSTALL_DIR/scanner.py"
cp     "$SRC_DIR/scanner.py"     "$INSTALL_DIR/scanner.py"
rm -f  "$INSTALL_DIR/classifier.py"
cp     "$SRC_DIR/classifier.py"  "$INSTALL_DIR/classifier.py"
rm -f  "$INSTALL_DIR/registry-build.sh"
cp     "$SRC_DIR/registry-build.sh" "$INSTALL_DIR/registry-build.sh"
rm -rf "$INSTALL_DIR/scripts"
[ -d "$SRC_DIR/scripts" ] && cp -r "$SRC_DIR/scripts" "$INSTALL_DIR/scripts" || true
( cd "$INSTALL_DIR/backstage-api" && npm install --omit=dev 2>&1 | tail -1 ) || fail "npm install (backstage-api) failed."
ok "Registry files installed."

# --- 3. First full scan + classify (the orchestrator) ---
info "Step 3/5 — First scan + classify of this server (may take a minute)..."
REGISTRY_DATA="$DATA_DIR" ROOTS="$ROOTS" bash "$INSTALL_DIR/registry-build.sh" || warn "first build had issues (will retry on timer)."
ok "Initial inventory built in $DATA_DIR."

# --- 4. systemd user units: API (always on) + refresh timer (every 15 min) ---
info "Step 4/5 — Setting up service + auto-update timer..."
UNIT_DIR="$HOME/.config/systemd/user"; mkdir -p "$UNIT_DIR"
NODE_BIN="$(command -v node)"

cat > "$UNIT_DIR/registry-api.service" <<EOF
[Unit]
Description=Sypnose Registry API (server inventory on :$PORT)
[Service]
Type=simple
Environment=REGISTRY_PORT=$PORT
Environment=REGISTRY_DATA=$DATA_DIR
WorkingDirectory=$INSTALL_DIR/backstage-api
ExecStart=$NODE_BIN server.js
Restart=always
RestartSec=5
[Install]
WantedBy=default.target
EOF

cat > "$UNIT_DIR/registry-refresh.service" <<EOF
[Unit]
Description=Sypnose Registry refresh (re-scan + re-classify the server)
[Service]
Type=oneshot
# PATH must include trace-mcp + graphify bins, else the timer context can't
# resolve them and the code-graph/knowledge-graph steps silently skip (RUN_TRACE=0).
# The login shell has these on PATH, but a --user timer does NOT inherit it.
Environment=PATH=$HOME/.trace-mcp/bin:$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=REGISTRY_DATA=$DATA_DIR
Environment=ROOTS=$ROOTS
# Cap memory so a heavy trace-mcp index can't OOM the box (seen on 217).
MemoryMax=1500M
OOMScoreAdjust=400
ExecStart=/usr/bin/env bash $INSTALL_DIR/registry-build.sh
EOF

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

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload 2>/dev/null || true
  systemctl --user enable --now registry-api.service 2>&1 | tail -1 || warn "could not enable API service"
  systemctl --user enable --now registry-refresh.timer 2>&1 | tail -1 || warn "could not enable timer"
  loginctl enable-linger "$USER" 2>/dev/null || warn "run 'sudo loginctl enable-linger $USER' so it survives logout."
else
  warn "systemctl not available — start manually: cd $INSTALL_DIR/backstage-api && REGISTRY_PORT=$PORT node server.js"
fi

# --- 5. Verify (retry loop + real data, not just /health) ---
info "Step 5/5 — Verifying..."
CODE=000
for i in $(seq 1 15); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 6 "http://localhost:$PORT/health" 2>/dev/null || echo 000)
  [ "$CODE" = "200" ] && break
  sleep 2
done
if [ "$CODE" = "200" ]; then ok "Registry API live: http://localhost:$PORT/health"; else warn "API not up yet (HTTP $CODE) — check: systemctl --user status registry-api"; fi

# Did the data actually get fed? (path fix + trace-mcp + graphify)
if [ -f "$DATA_DIR/build-summary.json" ] && command -v jq >/dev/null 2>&1; then
  TRACE_OK=$(jq -r '.trace_mcp.ok // 0' "$DATA_DIR/build-summary.json" 2>/dev/null || echo 0)
  GRAPH_OK=$(jq -r '.graphify.ok // 0' "$DATA_DIR/build-summary.json" 2>/dev/null || echo 0)
  REPOS=$(jq -r '.repos.found // 0' "$DATA_DIR/build-summary.json" 2>/dev/null || echo 0)
  PATHS_OK=$(jq -e 'all(.[]; .path!=null)' "$DATA_DIR/projects.json" >/dev/null 2>&1 && echo yes || echo no)
  info "Data check -> repos:$REPOS  paths_present:$PATHS_OK  trace_mcp.ok:$TRACE_OK  graphify.ok:$GRAPH_OK"
  [ "$PATHS_OK" = "yes" ] && ok "projects.json has paths (code-graph will feed)." || warn "projects.json missing paths — trace-mcp won't run (classifier path bug)."
  [ "$TRACE_OK" -ge 1 ] 2>/dev/null && ok "trace-mcp code graph fed ($TRACE_OK repos indexed)." || warn "trace-mcp fed 0 repos — check PATH in registry-refresh.service."
fi

echo ""
echo "=== Sypnose Registry installed ==="
cat <<EOF

Your server is now registered and auto-updates every 15 min.
  Summary:   curl http://localhost:$PORT/registry/summary
  Server:    curl http://localhost:$PORT/registry/server     (services, ports, containers, repos)
  Projects:  curl http://localhost:$PORT/registry/projects   (each classified: saas/api/bot/...)
  SaaS:      curl http://localhost:$PORT/registry/saas        (each SaaS with its APIs/DB/frontend)

Roots scanned: $ROOTS
Refresh timer: systemctl --user list-timers registry-refresh.timer
EOF
