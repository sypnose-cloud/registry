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

# --- prerequisite: curl must exist before we do anything (health-check + uv) ---
if ! command -v curl >/dev/null 2>&1; then
  fail "curl no esta instalado — es requisito del instalador (health-check + uv install)."
  fail "Instala: sudo apt-get install -y curl   |   sudo dnf install -y curl   |   sudo apk add curl"
  exit 1
fi

# ============================================================================
# Step 0 — Auto-install base toolchain (node/npm, python3, jq, git, build tools)
# This runs BEFORE install-deps.sh so that install-deps.sh always finds its
# prerequisites in place even on a completely clean container.
# Idempotent: each tool is guarded with 'command -v'; already-present tools
# are never re-installed.
# ============================================================================
info "Step 0/5 — Auto-installing base toolchain (node, python3, jq, git, build tools)..."

# --- 0a. Detect sudo capability ---
if [ "$(id -u)" = "0" ]; then
  SUDO=""          # running as root: no sudo needed
elif sudo -n true 2>/dev/null; then
  SUDO="sudo"      # passwordless sudo available
else
  # No root, no passwordless sudo — list what we need and abort clearly.
  _NEED_MANUAL=()
  for _t in node python3 jq git curl; do
    command -v "$_t" >/dev/null 2>&1 || _NEED_MANUAL+=("$_t")
  done
  command -v gcc >/dev/null 2>&1 || _NEED_MANUAL+=("build-essential/gcc")
  if [ "${#_NEED_MANUAL[@]}" -gt 0 ]; then
    fail "Se necesita root o sudo sin contrasena para auto-instalar: ${_NEED_MANUAL[*]}"
    fail "Instala manualmente antes de continuar:"
    fail "  apt-get: sudo apt-get install -y build-essential python3 python3-venv python3-dev nodejs npm jq git curl ca-certificates"
    fail "  dnf:     sudo dnf groupinstall -y 'Development Tools' && sudo dnf install -y python3 nodejs npm jq git curl"
    fail "  apk:     sudo apk add --no-cache build-base python3 python3-dev nodejs npm jq git curl ca-certificates"
    exit 1
  fi
  SUDO=""  # everything already installed; no sudo needed going forward
fi

# --- 0b. Detect package manager ---
if command -v apt-get >/dev/null 2>&1; then
  _PKG_MGR="apt"
elif command -v dnf >/dev/null 2>&1; then
  _PKG_MGR="dnf"
elif command -v yum >/dev/null 2>&1; then
  _PKG_MGR="yum"
elif command -v apk >/dev/null 2>&1; then
  _PKG_MGR="apk"
elif command -v pacman >/dev/null 2>&1; then
  _PKG_MGR="pacman"
else
  _PKG_MGR="unknown"
  warn "Gestor de paquetes no reconocido (apt/dnf/yum/apk/pacman). Se asume que las herramientas ya estan instaladas."
fi

# --- 0c. Install base packages (idempotent per-tool guards) ---
_apt_updated=0   # track if we've done 'apt-get update' yet (do it once, lazily)

_apt_ensure_updated() {
  if [ "$_apt_updated" -eq 0 ]; then
    info "  apt-get update (primera vez)..."
    $SUDO apt-get update -qq >/dev/null 2>&1 && _apt_updated=1 || warn "  apt-get update fallo (continuando de todas formas)"
  fi
}

# git
if ! command -v git >/dev/null 2>&1; then
  info "  Instalando git..."
  case "$_PKG_MGR" in
    apt)     _apt_ensure_updated; $SUDO apt-get install -y git >/dev/null 2>&1 && ok "  git instalado." || warn "  apt-get install git fallo." ;;
    dnf|yum) $SUDO "$_PKG_MGR" install -y git >/dev/null 2>&1 && ok "  git instalado." || warn "  $_PKG_MGR install git fallo." ;;
    apk)     $SUDO apk add --no-cache git >/dev/null 2>&1 && ok "  git instalado." || warn "  apk add git fallo." ;;
    pacman)  $SUDO pacman -Sy --noconfirm git >/dev/null 2>&1 && ok "  git instalado." || warn "  pacman install git fallo." ;;
    *)       warn "  No se puede instalar git automaticamente (gestor desconocido)." ;;
  esac
else
  ok "  git ya presente ($(git --version 2>/dev/null | head -1))."
fi

# curl + ca-certificates (may already be there since we checked curl above, but ensure ca-certs)
if ! command -v curl >/dev/null 2>&1; then
  info "  Instalando curl..."
  case "$_PKG_MGR" in
    apt)     _apt_ensure_updated; $SUDO apt-get install -y curl ca-certificates >/dev/null 2>&1 && ok "  curl instalado." || warn "  apt-get install curl fallo." ;;
    dnf|yum) $SUDO "$_PKG_MGR" install -y curl >/dev/null 2>&1 && ok "  curl instalado." || warn "  $_PKG_MGR install curl fallo." ;;
    apk)     $SUDO apk add --no-cache curl ca-certificates >/dev/null 2>&1 && ok "  curl instalado." || warn "  apk add curl fallo." ;;
    pacman)  $SUDO pacman -Sy --noconfirm curl >/dev/null 2>&1 && ok "  curl instalado." || warn "  pacman install curl fallo." ;;
    *)       warn "  No se puede instalar curl automaticamente (gestor desconocido)." ;;
  esac
else
  ok "  curl ya presente."
fi

# jq
if ! command -v jq >/dev/null 2>&1; then
  info "  Instalando jq..."
  case "$_PKG_MGR" in
    apt)     _apt_ensure_updated; $SUDO apt-get install -y jq >/dev/null 2>&1 && ok "  jq instalado." || warn "  apt-get install jq fallo." ;;
    dnf|yum) $SUDO "$_PKG_MGR" install -y jq >/dev/null 2>&1 && ok "  jq instalado." || warn "  $_PKG_MGR install jq fallo." ;;
    apk)     $SUDO apk add --no-cache jq >/dev/null 2>&1 && ok "  jq instalado." || warn "  apk add jq fallo." ;;
    pacman)  $SUDO pacman -Sy --noconfirm jq >/dev/null 2>&1 && ok "  jq instalado." || warn "  pacman install jq fallo." ;;
    *)       warn "  No se puede instalar jq automaticamente (gestor desconocido)." ;;
  esac
else
  ok "  jq ya presente ($(jq --version 2>/dev/null))."
fi

# python3 (+ python3-venv for virtual envs)
if ! command -v python3 >/dev/null 2>&1; then
  info "  Instalando python3..."
  case "$_PKG_MGR" in
    apt)     _apt_ensure_updated; $SUDO apt-get install -y python3 python3-venv python3-dev >/dev/null 2>&1 && ok "  python3 instalado." || warn "  apt-get install python3 fallo." ;;
    dnf|yum) $SUDO "$_PKG_MGR" install -y python3 python3-devel >/dev/null 2>&1 && ok "  python3 instalado." || warn "  $_PKG_MGR install python3 fallo." ;;
    apk)     $SUDO apk add --no-cache python3 python3-dev >/dev/null 2>&1 && ok "  python3 instalado." || warn "  apk add python3 fallo." ;;
    pacman)  $SUDO pacman -Sy --noconfirm python >/dev/null 2>&1 && ok "  python3 instalado." || warn "  pacman install python fallo." ;;
    *)       warn "  No se puede instalar python3 automaticamente (gestor desconocido)." ;;
  esac
else
  ok "  python3 ya presente ($(python3 --version 2>/dev/null))."
fi

# build tools (gcc/make/python3-dev needed by node-gyp for native modules like better-sqlite3)
if ! command -v gcc >/dev/null 2>&1; then
  info "  Instalando build tools (gcc, make, python3-dev)..."
  case "$_PKG_MGR" in
    apt)
      _apt_ensure_updated
      $SUDO apt-get install -y build-essential python3-dev >/dev/null 2>&1 \
        && ok "  build-essential instalado (apt)." \
        || warn "  apt-get install build-essential fallo."
      ;;
    dnf|yum)
      $SUDO "$_PKG_MGR" groupinstall -y 'Development Tools' >/dev/null 2>&1 \
        && $SUDO "$_PKG_MGR" install -y python3-devel >/dev/null 2>&1 \
        && ok "  Development Tools instalado ($_PKG_MGR)." \
        || warn "  $_PKG_MGR groupinstall Development Tools fallo."
      ;;
    apk)
      $SUDO apk add --no-cache build-base python3-dev >/dev/null 2>&1 \
        && ok "  build-base instalado (apk)." \
        || warn "  apk add build-base fallo."
      ;;
    pacman)
      $SUDO pacman -Sy --noconfirm base-devel python >/dev/null 2>&1 \
        && ok "  base-devel instalado (pacman)." \
        || warn "  pacman install base-devel fallo."
      ;;
    *)
      warn "  Gestor de paquetes no reconocido. Instala build tools manualmente (build-essential / 'Development Tools' / build-base)."
      ;;
  esac
else
  ok "  gcc ya presente — build tools instalados."
fi

# Node.js LTS (only if node is missing)
if ! command -v node >/dev/null 2>&1; then
  info "  Instalando Node.js LTS..."
  _NODE_INSTALLED=0
  case "$_PKG_MGR" in
    apt)
      # Prefer NodeSource LTS; fall back to distro nodejs if NodeSource fails.
      _apt_ensure_updated
      info "    Intentando NodeSource (LTS)..."
      if $SUDO bash -c 'curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -' >/dev/null 2>&1; then
        if $SUDO apt-get install -y nodejs >/dev/null 2>&1; then
          hash -r 2>/dev/null || true
          if command -v node >/dev/null 2>&1; then
            ok "    Node.js instalado via NodeSource ($(node --version 2>/dev/null))."
            _NODE_INSTALLED=1
          fi
        fi
      fi
      if [ "$_NODE_INSTALLED" -eq 0 ]; then
        warn "    NodeSource fallo — usando nodejs del repo de la distro (puede ser version antigua)."
        $SUDO apt-get install -y nodejs npm >/dev/null 2>&1 \
          && hash -r 2>/dev/null || true
        command -v node >/dev/null 2>&1 && _NODE_INSTALLED=1 \
          && ok "    Node.js instalado desde repo distro ($(node --version 2>/dev/null))." \
          || warn "    apt-get install nodejs fallo tambien."
      fi
      ;;
    dnf|yum)
      $SUDO "$_PKG_MGR" install -y nodejs npm >/dev/null 2>&1 \
        && hash -r 2>/dev/null || true
      command -v node >/dev/null 2>&1 && _NODE_INSTALLED=1 \
        && ok "    Node.js instalado ($_PKG_MGR) ($(node --version 2>/dev/null))." \
        || warn "    $_PKG_MGR install nodejs fallo."
      ;;
    apk)
      $SUDO apk add --no-cache nodejs npm >/dev/null 2>&1 \
        && hash -r 2>/dev/null || true
      command -v node >/dev/null 2>&1 && _NODE_INSTALLED=1 \
        && ok "    Node.js instalado (apk) ($(node --version 2>/dev/null))." \
        || warn "    apk add nodejs fallo."
      ;;
    pacman)
      $SUDO pacman -Sy --noconfirm nodejs npm >/dev/null 2>&1 \
        && hash -r 2>/dev/null || true
      command -v node >/dev/null 2>&1 && _NODE_INSTALLED=1 \
        && ok "    Node.js instalado (pacman) ($(node --version 2>/dev/null))." \
        || warn "    pacman install nodejs fallo."
      ;;
    *)
      warn "  Gestor de paquetes no reconocido. Instala Node.js manualmente: https://nodejs.org"
      ;;
  esac
  if [ "$_NODE_INSTALLED" -eq 0 ]; then
    warn "  Node.js no se pudo instalar automaticamente."
  fi
else
  ok "  node ya presente ($(node --version 2>/dev/null))."
fi

# --- 0d. Post-install sanity check: fail loudly if node or python3 still missing ---
_STILL_MISSING=()
command -v node    >/dev/null 2>&1 || _STILL_MISSING+=("node")
command -v python3 >/dev/null 2>&1 || _STILL_MISSING+=("python3")
if [ "${#_STILL_MISSING[@]}" -gt 0 ]; then
  fail "Tras el intento de auto-instalacion siguen faltando: ${_STILL_MISSING[*]}"
  fail "Instalalos manualmente y vuelve a correr install.sh:"
  fail "  apt: sudo apt-get install -y nodejs python3"
  fail "  dnf: sudo dnf install -y nodejs python3"
  fail "  apk: sudo apk add --no-cache nodejs python3"
  exit 1
fi
ok "Step 0 completo — toolchain base lista."

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
  bash "$SRC_DIR/install-deps.sh" || warn "install-deps reported issues (see above)."
else
  warn "install-deps.sh not found next to installer."
fi
# Make sure user npm bin is on PATH for the rest of this run.
export PATH="$(npm config get prefix 2>/dev/null)/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"

# --- 1b. Explicit verification of every mandatory CLI tool ---
info "Step 1b/5 — Verifying mandatory tools are present..."
_MISSING_TOOLS=()
for _tool in node npm python3 jq curl git; do
  if ! command -v "$_tool" >/dev/null 2>&1; then
    _MISSING_TOOLS+=("$_tool")
    warn "  MISSING: $_tool"
  fi
done
if [ "${#_MISSING_TOOLS[@]}" -gt 0 ]; then
  fail "Faltan herramientas obligatorias: ${_MISSING_TOOLS[*]}"
  fail "En Ubuntu/Debian:  sudo apt-get install -y ${_MISSING_TOOLS[*]}"
  fail "En RHEL/Fedora:    sudo dnf install -y ${_MISSING_TOOLS[*]}"
  fail "Instala las herramientas faltantes y vuelve a correr install.sh"
  exit 1
fi
ok "Todas las herramientas obligatorias presentes."

# --- 1c. Auto-install build tools (node-gyp needs them for native modules) ---
#         Guard: only run once per install (idempotent check via gcc presence).
if ! command -v gcc >/dev/null 2>&1; then
  info "gcc no encontrado — instalando build tools para node-gyp..."
  if sudo -n true 2>/dev/null; then
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get install -y build-essential python3-dev git curl jq \
        >/dev/null 2>&1 && ok "build-essential instalado (apt)." \
        || warn "apt-get install build-essential fallo (revisa permisos / red)."
    elif command -v dnf >/dev/null 2>&1; then
      sudo dnf groupinstall -y 'Development Tools' >/dev/null 2>&1 \
        && sudo dnf install -y python3-devel git curl jq >/dev/null 2>&1 \
        && ok "Development Tools instalado (dnf)." \
        || warn "dnf groupinstall fallo (revisa permisos / red)."
    elif command -v apk >/dev/null 2>&1; then
      sudo apk add --no-cache build-base python3-dev git curl jq \
        >/dev/null 2>&1 && ok "build-base instalado (apk)." \
        || warn "apk add fallo (revisa permisos / red)."
    else
      warn "Gestor de paquetes no detectado (apt/dnf/apk). Instala manualmente: build-essential / 'Development Tools' segun tu distro."
    fi
  else
    fail "Se necesitan build tools (gcc/make/python3-dev) para compilar modulos nativos (node-gyp)."
    fail "No hay sudo sin contrasena disponible. Instala manualmente ANTES de continuar:"
    if command -v apt-get >/dev/null 2>&1; then
      fail "  sudo apt-get install -y build-essential python3-dev git curl jq"
    elif command -v dnf >/dev/null 2>&1; then
      fail "  sudo dnf groupinstall -y 'Development Tools' && sudo dnf install -y python3-devel git curl jq"
    elif command -v apk >/dev/null 2>&1; then
      fail "  sudo apk add build-base python3-dev git curl jq"
    else
      fail "  build-essential (o equivalente para tu distro) + python3-dev + git + curl + jq"
    fi
    exit 1
  fi
else
  ok "gcc presente — build tools ya instalados (sin cambios)."
fi

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
_NPM_LOG="$INSTALL_DIR/backstage-api/.npm-install.log"
if ! ( cd "$INSTALL_DIR/backstage-api" && npm install --omit=dev 2>&1 | tee "$_NPM_LOG" ); then
  if grep -qi "node-gyp" "$_NPM_LOG" 2>/dev/null; then
    fail "npm install fallo con errores de node-gyp (compilacion nativa)."
    fail "Instala build tools: sudo apt-get install -y build-essential python3-dev"
    fail "Luego vuelve a correr install.sh"
  else
    fail "npm install (backstage-api) fallo. Ver log: $_NPM_LOG"
  fi
  exit 1
fi
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

# registry-refresh.service — split heredoc to control which variables expand:
#
#   %h  = systemd --user unit specifier, expanded at *runtime* to the home dir of the
#         unit owner. Use this for PATH so the service always finds the right bins
#         regardless of which user ran the installer.
#
#   $DATA_DIR / $ROOTS / $INSTALL_DIR are absolute paths set by this installer for the
#   current user — they ARE expanded by bash now (intentionally baked in).
#
# WRONG: <<EOF with $HOME — bash expands $HOME at heredoc-write time, baking in the
#        installer's home. If the service owner differs the PATH points to the wrong dir.
# RIGHT: <<'UNIT_EOF' for the PATH line (literal %h), then a second heredoc for the
#        lines that need bash expansion.
cat > "$UNIT_DIR/registry-refresh.service" <<'UNIT_EOF'
[Unit]
Description=Sypnose Registry refresh (re-scan + re-classify the server)
[Service]
Type=oneshot
# PATH must include trace-mcp + graphify bins, else the timer context can't
# resolve them and the code-graph/knowledge-graph steps silently skip (RUN_TRACE=0).
# The login shell has these on PATH, but a --user timer does NOT inherit it.
# %h is the systemd --user specifier expanded at runtime to the unit owner's home.
# Do NOT use $HOME here — it expands at heredoc-write time and bakes in the
# installer's home, breaking if the unit owner differs.
Environment=PATH=%h/.trace-mcp/bin:%h/.npm-global/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
UNIT_EOF
# Append lines that require bash-variable expansion (absolute paths baked at install time).
cat >> "$UNIT_DIR/registry-refresh.service" <<EOF
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

  # --- Real linger + is-active verification ---
  # On headless/VPS without a D-Bus session, systemctl --user enable --now can silently
  # succeed even if the unit never starts (no linger = no user session at boot).
  # Check both: actual running state AND linger configuration.
  _API_STATE=$(systemctl --user is-active registry-api.service 2>/dev/null || echo "unknown")
  _LINGER=$(loginctl show-user "$USER" -p Linger 2>/dev/null | cut -d= -f2 || echo "no")

  if [ "$_API_STATE" != "active" ]; then
    warn "=========================================================="
    warn " registry-api.service is NOT active (state: $_API_STATE)"
    warn " This is common on headless/VPS servers without a D-Bus"
    warn " session or without linger enabled."
    warn ""
    warn " REQUIRED — run as root:"
    warn "   sudo loginctl enable-linger $USER"
    warn " Then re-run this installer, OR start manually:"
    warn "   systemctl --user start registry-api.service"
    warn " Check status:"
    warn "   systemctl --user status registry-api.service"
    warn "   journalctl --user -u registry-api.service -n 30"
    warn "=========================================================="
  else
    ok "registry-api.service is active."
  fi

  if [ "$_LINGER" != "yes" ]; then
    # Try to enable linger automatically (needs sudo or root).
    loginctl enable-linger "$USER" 2>/dev/null \
      && ok "Linger enabled for $USER — service survives logout." \
      || warn "Linger NOT enabled. Run: sudo loginctl enable-linger $USER (service won't auto-start after reboot without it)."
  else
    ok "Linger already enabled for $USER."
  fi
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
