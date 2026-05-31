#!/usr/bin/env bash
#
# registry-build.sh -- ORQUESTADOR del Registry Universal de Sypnose
# ----------------------------------------------------------------------------
# El corazon que corre periodicamente (systemd timer / cron). Ata las 4 piezas:
#
#   scanner.py    -> descubre repos en el servidor          (server-scan.json)
#   classifier.py -> clasifica cada repo (saas/api/lib/...)  (projects.json)
#   trace-mcp     -> indexa el grafo API->BD de cada SaaS/API
#   graphify      -> (opcional) grafo de conocimiento del codigo
#
# Produce los JSON que el router del Registry sirve:
#   $REGISTRY_DATA/server-scan.json    (crudo del scanner)
#   $REGISTRY_DATA/projects.json       (array de proyectos clasificados)
#   $REGISTRY_DATA/build-summary.json  (resumen del ultimo ciclo)
#
# Diseno: idempotente, aislamiento de fallos por repo (un repo malo NO tumba el
# resto), FAIL_LOUD del job completo solo si una FASE CRITICA falla (scanner).
#
# Las listas de rutas se materializan a ficheros temporales (una ruta por
# linea) y se leen con 'read'. Evita pasar listas por NUL (fragil en source
# bash) y soporta rutas con espacios. Rutas con saltos de linea no existen
# para directorios de repos.
#
# Uso:
#   ./registry-build.sh
#   ROOTS="/home,/opt,/srv" REGISTRY_DATA=/var/lib/registry ./registry-build.sh
#   ./registry-build.sh --no-graphify        # salta graphify
#   ./registry-build.sh --roots /home --data ~/.registry-data
#
# ============================================================================

set -o errexit -o nounset -o pipefail

# ---------------------------------------------------------------------------
# 0. Localizar el directorio del script (scanner.py y classifier.py viven aqui)
# ---------------------------------------------------------------------------
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do                       # resolver symlinks
  DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"

# ---------------------------------------------------------------------------
# 1. Parametros (env con default + flags que pisan el env)
# ---------------------------------------------------------------------------
ROOTS="${ROOTS:-/home,/opt}"
REGISTRY_DATA="${REGISTRY_DATA:-$HOME/.registry-data}"
SCANNER="${SCANNER:-$SCRIPT_DIR/scanner.py}"
CLASSIFIER="${CLASSIFIER:-$SCRIPT_DIR/classifier.py}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

# Timeouts (segundos). Un repo lento no debe colgar el ciclo entero.
CLASSIFY_TIMEOUT="${CLASSIFY_TIMEOUT:-120}"
TRACE_TIMEOUT="${TRACE_TIMEOUT:-600}"
GRAPHIFY_TIMEOUT="${GRAPHIFY_TIMEOUT:-900}"

RUN_GRAPHIFY="${RUN_GRAPHIFY:-1}"                 # 1=si, 0=no (flag --no-graphify)
RUN_TRACE="${RUN_TRACE:-1}"                       # 1=si, 0=no (flag --no-trace)

# Tipos de proyecto que reciben trace-mcp index (mapa API->BD)
TRACE_TYPES="${TRACE_TYPES:-saas api}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --roots)        ROOTS="$2"; shift 2 ;;
    --data)         REGISTRY_DATA="$2"; shift 2 ;;
    --scanner)      SCANNER="$2"; shift 2 ;;
    --classifier)   CLASSIFIER="$2"; shift 2 ;;
    --no-graphify)  RUN_GRAPHIFY=0; shift ;;
    --no-trace)     RUN_TRACE=0; shift ;;
    -h|--help)
      grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "registry-build: argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

# Rutas de salida derivadas
SCAN_JSON="$REGISTRY_DATA/server-scan.json"
PROJECTS_JSON="$REGISTRY_DATA/projects.json"
SUMMARY_JSON="$REGISTRY_DATA/build-summary.json"
LOG_DIR="$REGISTRY_DATA/logs"
RUN_TS="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_LOG="$LOG_DIR/build-$RUN_TS.log"

# Workdir temporal para listas de rutas (limpiado al salir)
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/registry-build.XXXXXX")"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 2. Logging (a stdout + a fichero del run)
# ---------------------------------------------------------------------------
mkdir -p "$REGISTRY_DATA" "$LOG_DIR"

log()  { printf '%s [%s] %s\n' "$(date -u +%H:%M:%S)" "$1" "${*:2}" | tee -a "$RUN_LOG" >&2; }
info() { log INFO "$@"; }
warn() { log WARN "$@"; }
err()  { log ERR  "$@"; }
die()  { err "$@"; finalize_failed "$*"; exit 1; }

# Contadores globales (se reportan en el resumen)
REPOS_FOUND=0
REPOS_CLASSIFIED=0
REPOS_CLASSIFY_FAILED=0
SAAS_COUNT=0
API_COUNT=0
TRACE_OK=0
TRACE_FAILED=0
GRAPHIFY_OK=0
GRAPHIFY_FAILED=0

# ---------------------------------------------------------------------------
# 3. Pre-flight: verificar dependencias
# ---------------------------------------------------------------------------
need() { command -v "$1" >/dev/null 2>&1 || die "falta dependencia obligatoria: $1"; }

preflight() {
  info "Registry build $RUN_TS -- SCRIPT_DIR=$SCRIPT_DIR"
  info "ROOTS=$ROOTS  REGISTRY_DATA=$REGISTRY_DATA"
  need "$PYTHON_BIN"
  need jq
  [[ -f "$SCANNER" ]]    || die "scanner.py no encontrado en: $SCANNER"
  [[ -f "$CLASSIFIER" ]] || die "classifier.py no encontrado en: $CLASSIFIER"

  # timeout es de coreutils; si falta, degradamos a ejecucion sin timeout (loud).
  if command -v timeout >/dev/null 2>&1; then
    TIMEOUT_BIN="timeout"
  else
    warn "'timeout' no disponible -- los sub-procesos correran SIN limite de tiempo"
    TIMEOUT_BIN=""
  fi

  # trace-mcp / graphify son opcionales: si faltan, se saltan (no es fatal).
  if [[ "$RUN_TRACE" == "1" ]] && ! command -v trace-mcp >/dev/null 2>&1; then
    warn "trace-mcp no esta en PATH -- se omite el indexado API->BD"
    RUN_TRACE=0
  fi
  if [[ "$RUN_GRAPHIFY" == "1" ]] && ! command -v graphify >/dev/null 2>&1; then
    warn "graphify no esta en PATH -- se omite el grafo de conocimiento"
    RUN_GRAPHIFY=0
  fi
}

# run_with_timeout <segundos> <cmd...> -- corre con timeout si esta disponible
run_with_timeout() {
  local secs="$1"; shift
  if [[ -n "$TIMEOUT_BIN" ]]; then
    "$TIMEOUT_BIN" --kill-after=10s "${secs}s" "$@"
  else
    "$@"
  fi
}

# ---------------------------------------------------------------------------
# 4. FASE 1 -- Scanner (CRITICA: si falla, abortamos el ciclo)
# ---------------------------------------------------------------------------
run_scanner() {
  info "FASE 1/5 -- escaneando repos en roots: $ROOTS"
  local tmp="$SCAN_JSON.tmp.$$"

  if ! "$PYTHON_BIN" "$SCANNER" --roots "$ROOTS" --out "$tmp" >>"$RUN_LOG" 2>&1; then
    rm -f "$tmp"
    die "scanner.py fallo (fase critica). Ver $RUN_LOG"
  fi

  # Validar que el JSON producido es parseable y tiene .repos[]
  if ! jq -e '.repos | type == "array"' "$tmp" >/dev/null 2>&1; then
    rm -f "$tmp"
    die "server-scan.json invalido: falta el array .repos[]. Ver $RUN_LOG"
  fi

  mv -f "$tmp" "$SCAN_JSON"                       # escritura atomica
  REPOS_FOUND="$(jq '.repos | length' "$SCAN_JSON")"
  info "scanner OK -- $REPOS_FOUND repos descubiertos -> $SCAN_JSON"
}

# ---------------------------------------------------------------------------
# 5. FASE 2 -- Clasificar cada repo y acumular projects.json
#    (aislamiento por repo: un classifier que peta NO tumba el ciclo)
# ---------------------------------------------------------------------------
classify_repos() {
  info "FASE 2/5 -- clasificando $REPOS_FOUND repos"
  local tmp_projects="$PROJECTS_JSON.tmp.$$"
  local parts="$WORKDIR/projects.parts"
  local repolist="$WORKDIR/repos.list"
  : > "$parts"

  # Materializar rutas (una por linea) a un fichero y leerlo con read.
  jq -r '.repos[].path // empty' "$SCAN_JSON" > "$repolist"

  local repo out
  while IFS= read -r repo; do
    [[ -z "$repo" ]] && continue
    if [[ ! -d "$repo" ]]; then
      warn "repo del scan no existe en disco, se omite: $repo"
      REPOS_CLASSIFY_FAILED=$((REPOS_CLASSIFY_FAILED + 1))
      continue
    fi

    if ! out="$(run_with_timeout "$CLASSIFY_TIMEOUT" "$PYTHON_BIN" "$CLASSIFIER" "$repo" 2>>"$RUN_LOG")"; then
      warn "classifier.py fallo/timeout en: $repo (se continua)"
      REPOS_CLASSIFY_FAILED=$((REPOS_CLASSIFY_FAILED + 1))
      continue
    fi

    # El classifier debe imprimir UN objeto JSON. Validar antes de acumular.
    if ! printf '%s' "$out" | jq -e 'type == "object"' >/dev/null 2>&1; then
      warn "classifier.py salida no-JSON para: $repo (se omite)"
      REPOS_CLASSIFY_FAILED=$((REPOS_CLASSIFY_FAILED + 1))
      continue
    fi

    printf '%s\n' "$out" >> "$parts"
    REPOS_CLASSIFIED=$((REPOS_CLASSIFIED + 1))
  done < "$repolist"

  # Consolidar todos los objetos en UN array JSON valido (slurp)
  if ! jq -s '.' "$parts" > "$tmp_projects" 2>>"$RUN_LOG"; then
    rm -f "$tmp_projects"
    die "no se pudo ensamblar projects.json (jq slurp fallo). Ver $RUN_LOG"
  fi

  mv -f "$tmp_projects" "$PROJECTS_JSON"           # escritura atomica
  SAAS_COUNT="$(jq '[.[] | select(.type=="saas")] | length' "$PROJECTS_JSON")"
  API_COUNT="$(jq  '[.[] | select(.type=="api")]  | length' "$PROJECTS_JSON")"
  info "clasificacion OK -- $REPOS_CLASSIFIED clasificados, $REPOS_CLASSIFY_FAILED fallidos -> $PROJECTS_JSON"
  info "   tipos: $SAAS_COUNT saas, $API_COUNT api"
}

# ---------------------------------------------------------------------------
# 6. FASE 3 -- trace-mcp index por cada proyecto saas|api (mapa API->BD)
#    (timeout por repo; un fallo NO tumba el job)
# ---------------------------------------------------------------------------
build_type_filter() {
  # "saas api" -> .type=="saas" or .type=="api"
  local f="" t
  for t in $TRACE_TYPES; do
    [[ -n "$f" ]] && f="$f or "
    f="${f}.type==\"$t\""
  done
  printf '%s' "${f:-false}"
}

run_trace_mcp() {
  if [[ "$RUN_TRACE" != "1" ]]; then
    info "FASE 3/5 -- trace-mcp OMITIDO"
    return 0
  fi
  info "FASE 3/5 -- trace-mcp index para proyectos: $TRACE_TYPES"

  local filter list repo
  filter="$(build_type_filter)"
  list="$WORKDIR/trace.list"
  jq -r "[.[] | select($filter)] | .[].path // empty" "$PROJECTS_JSON" > "$list"

  while IFS= read -r repo; do
    [[ -z "$repo" || ! -d "$repo" ]] && continue
    info "   trace-mcp index $repo"
    if run_with_timeout "$TRACE_TIMEOUT" trace-mcp index "$repo" >>"$RUN_LOG" 2>&1; then
      TRACE_OK=$((TRACE_OK + 1))
    else
      warn "   trace-mcp index fallo/timeout en: $repo (se continua)"
      TRACE_FAILED=$((TRACE_FAILED + 1))
    fi
  done < "$list"

  info "trace-mcp OK -- $TRACE_OK indexados, $TRACE_FAILED fallidos"
}

# ---------------------------------------------------------------------------
# 7. FASE 4 -- graphify update por cada repo de codigo (opcional)
# ---------------------------------------------------------------------------
run_graphify() {
  if [[ "$RUN_GRAPHIFY" != "1" ]]; then
    info "FASE 4/5 -- graphify OMITIDO"
    return 0
  fi
  info "FASE 4/5 -- graphify update por repo de codigo"

  # Repos "de codigo": todo lo que NO sea tipo documental.
  # Si el classifier marca .is_code o .type, lo respetamos; por defecto, todos.
  local list repo
  list="$WORKDIR/graphify.list"
  jq -r '.[] | select((.is_code // true) and (.type // "") != "docs") | .path // empty' "$PROJECTS_JSON" > "$list"

  while IFS= read -r repo; do
    [[ -z "$repo" || ! -d "$repo" ]] && continue
    info "   graphify update $repo"
    if run_with_timeout "$GRAPHIFY_TIMEOUT" graphify update "$repo" >>"$RUN_LOG" 2>&1; then
      GRAPHIFY_OK=$((GRAPHIFY_OK + 1))
    else
      warn "   graphify update fallo/timeout en: $repo (se continua)"
      GRAPHIFY_FAILED=$((GRAPHIFY_FAILED + 1))
    fi
  done < "$list"

  info "graphify OK -- $GRAPHIFY_OK actualizados, $GRAPHIFY_FAILED fallidos"
}

# ---------------------------------------------------------------------------
# 8. FASE 5 -- Resumen (build-summary.json + impresion humana)
# ---------------------------------------------------------------------------
finalize_ok() {
  local ended; ended="$(date -u +%Y%m%dT%H%M%SZ)"
  jq -n \
    --arg status "ok" \
    --arg started "$RUN_TS" \
    --arg ended "$ended" \
    --arg roots "$ROOTS" \
    --arg data "$REGISTRY_DATA" \
    --arg log "$RUN_LOG" \
    --argjson found "$REPOS_FOUND" \
    --argjson classified "$REPOS_CLASSIFIED" \
    --argjson classify_failed "$REPOS_CLASSIFY_FAILED" \
    --argjson saas "$SAAS_COUNT" \
    --argjson api "$API_COUNT" \
    --argjson trace_ok "$TRACE_OK" \
    --argjson trace_failed "$TRACE_FAILED" \
    --argjson graphify_ok "$GRAPHIFY_OK" \
    --argjson graphify_failed "$GRAPHIFY_FAILED" \
    '{status:$status, started:$started, ended:$ended, roots:$roots,
      data_dir:$data, log:$log,
      repos:{found:$found, classified:$classified, classify_failed:$classify_failed},
      types:{saas:$saas, api:$api},
      trace_mcp:{ok:$trace_ok, failed:$trace_failed},
      graphify:{ok:$graphify_ok, failed:$graphify_failed}}' \
    > "$SUMMARY_JSON"

  info "FASE 5/5 -- resumen -> $SUMMARY_JSON"
  echo "============================================================"
  echo " Registry build COMPLETO ($RUN_TS -> $ended)"
  echo " Repos descubiertos : $REPOS_FOUND"
  echo " Clasificados       : $REPOS_CLASSIFIED  (fallidos: $REPOS_CLASSIFY_FAILED)"
  echo " SaaS detectados    : $SAAS_COUNT"
  echo " APIs detectadas    : $API_COUNT"
  echo " trace-mcp index    : $TRACE_OK ok / $TRACE_FAILED fail"
  echo " graphify update    : $GRAPHIFY_OK ok / $GRAPHIFY_FAILED fail"
  echo " Salidas            : $SCAN_JSON"
  echo "                      $PROJECTS_JSON"
  echo "                      $SUMMARY_JSON"
  echo "============================================================"
}

finalize_failed() {
  local reason="${1:-error desconocido}"
  local ended; ended="$(date -u +%Y%m%dT%H%M%SZ)"
  jq -n \
    --arg status "failed" --arg reason "$reason" \
    --arg started "$RUN_TS" --arg ended "$ended" \
    --arg log "$RUN_LOG" \
    --argjson found "$REPOS_FOUND" \
    --argjson classified "$REPOS_CLASSIFIED" \
    '{status:$status, reason:$reason, started:$started, ended:$ended, log:$log,
      repos:{found:$found, classified:$classified}}' \
    > "$SUMMARY_JSON" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# 9. Orquestacion
# ---------------------------------------------------------------------------
main() {
  preflight
  run_scanner       # critica
  classify_repos    # critica (genera projects.json que sirve el router)
  run_trace_mcp     # best-effort
  run_graphify      # best-effort
  finalize_ok
}

main "$@"