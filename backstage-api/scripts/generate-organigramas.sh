#!/bin/bash
# ============================================================================
# Batch secuencial de organigramas (CodeBoarding) — registry local Windows
# Misión SM 260707. Trampas del 67 aplicadas:
#  - stdin SIEMPRE </dev/null (codeboarding se come el stdin en bucles)
#  - solo las env vars OPENAI_* (otras keys confunden la selección de proveedor)
#  - timeout por proyecto (45 min) con kill; skip documentado, nada silencioso
#  - reintento x1 en fallo; log OK/FALLO/SKIP en ~/.registry-data/organigramas.log
# Uso: generate-organigramas.sh [nombre-proyecto]   (sin arg = todos los pendientes)
# ============================================================================
set -u

VENV="/c/Users/carlo/codeboarding-venv"
CB="$VENV/Scripts/codeboarding.exe"
KEYFILE="$HOME/.codeboarding/cliproxy.key"
PROJECTS_JSON="$HOME/.registry-data/projects.json"
LOG="$HOME/.registry-data/organigramas.log"
TIMEOUT_S=2700  # 45 min

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

[ -f "$CB" ] || { log "FATAL: codeboarding no instalado en $VENV"; exit 1; }
[ -f "$KEYFILE" ] || { log "FATAL: falta $KEYFILE"; exit 1; }
[ -f "$PROJECTS_JSON" ] || { log "FATAL: falta $PROJECTS_JSON"; exit 1; }

# Extrae pares name|path del projects.json (shape {projects:[...]} o [...]).
mapfile -t ENTRIES < <(python - "$PROJECTS_JSON" <<'PYEOF'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
arr=d if isinstance(d,list) else d.get('projects') or d.get('data') or []
for p in arr:
    if p.get('name') and p.get('path'):
        print(f"{p['name']}|{p['path']}")
PYEOF
)

ONLY="${1:-}"

run_one() {
  local name="$1" wpath="$2"
  local upath; upath=$(cygpath -u "$wpath")
  # Skips documentados (trampas 67). find en vez de ls+globs: ls devuelve error
  # si CUALQUIER patrón no matchea y provocaba SKIPs en falso.
  if [ ! -d "$upath" ]; then log "SKIP $name: ruta no existe ($wpath)"; return 2; fi
  local srcs cpps
  srcs=$(find "$upath" -maxdepth 3 -type d \( -name node_modules -o -name .git -o -name target -o -name dist \) -prune -o -type f \( -name '*.js' -o -name '*.ts' -o -name '*.tsx' -o -name '*.py' -o -name '*.rs' -o -name '*.go' -o -name '*.java' -o -name '*.php' -o -name '*.cs' \) -print 2>/dev/null | head -1)
  cpps=$(find "$upath" -maxdepth 3 -type d \( -name node_modules -o -name .git \) -prune -o -type f \( -name '*.cpp' -o -name '*.cc' -o -name '*.cxx' \) -print 2>/dev/null | head -1)
  if [ -n "$cpps" ] && [ -z "$srcs" ]; then log "SKIP $name: C++ no soportado"; return 2; fi
  if [ -z "$srcs" ]; then log "SKIP $name: sin código fuente detectable (repo-ancla)"; return 2; fi
  if [ -f "$upath/.codeboarding/analysis.json" ]; then log "OK $name: ya tenía analysis.json"; return 0; fi

  log "GEN $name: arrancando codeboarding --local $wpath (timeout ${TIMEOUT_S}s)"
  # Entorno LIMPIO: solo OPENAI_* — nada de ANTHROPIC/GOOGLE que confunda el proveedor.
  env -u ANTHROPIC_API_KEY -u GOOGLE_API_KEY -u GEMINI_API_KEY \
      OPENAI_BASE_URL="https://proxy.sypnose.cloud/v1" \
      OPENAI_API_KEY="$(tr -d '\r\n' < "$KEYFILE")" \
      "$CB" --local "$wpath" </dev/null >"$HOME/.registry-data/cb-$name.out" 2>&1 &
  local pid=$!
  local waited=0
  while kill -0 $pid 2>/dev/null; do
    sleep 15; waited=$((waited+15))
    if [ $waited -ge $TIMEOUT_S ]; then
      kill -9 $pid 2>/dev/null
      log "FALLO $name: timeout ${TIMEOUT_S}s — matado (ver cb-$name.out)"
      return 1
    fi
  done
  wait $pid; local rc=$?
  if [ $rc -eq 0 ] && [ -f "$upath/.codeboarding/analysis.json" ]; then
    log "OK $name: analysis.json generado (${waited}s)"
    return 0
  fi
  log "FALLO $name: rc=$rc, analysis.json $([ -f "$upath/.codeboarding/analysis.json" ] && echo existe || echo NO existe) (ver cb-$name.out)"
  return 1
}

for entry in "${ENTRIES[@]}"; do
  entry="${entry//$'\r'/}"   # Python en Windows emite \r\n; mapfile solo quita \n — sin esto la ruta viaja con \r y CodeBoarding revienta (WinError 123)
  name="${entry%%|*}"; wpath="${entry#*|}"
  [ -n "$ONLY" ] && [ "$name" != "$ONLY" ] && continue
  run_one "$name" "$wpath"
  rc=$?
  if [ $rc -eq 1 ]; then
    log "RETRY $name: reintento único"
    run_one "$name" "$wpath" || log "FALLO $name: agotado el reintento"
  fi
done
log "BATCH terminado."
