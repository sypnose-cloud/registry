#!/usr/bin/env bash
# =============================================================================
# install-deps.sh  —  Auto-instalador de dependencias del Registry Universal
# =============================================================================
# Verifica si cada herramienta del Registry esta instalada y, si no, la instala.
# Pensado para cualquier servidor Linux limpio. Idempotente: re-correrlo no rompe.
#
# Herramientas gestionadas:
#   1. node + npm   (prerequisito  -> FAIL si faltan, NO se auto-instalan)
#   2. npm prefix   (si es /usr o /usr/local -> configura ~/.npm-global, evita EACCES)
#   3. trace-mcp    (npm -g)  + rebuild better-sqlite3 (bindings nativos)
#   4. repomix      (npm -g)
#   5. graphify     (uv tool install graphifyy)  -> opcional (WARN si no hay uv)
#   6. python3      (prerequisito para scanner.py / classifier.py -> FAIL si falta)
#   7. sqlite3      (modulo de python3; CLI sqlite3 opcional)
#
# Uso:
#   bash install-deps.sh
#   curl -fsSL https://.../install-deps.sh | bash
#
# Salida: codigo 0 si todo lo OBLIGATORIO quedo OK; 1 si fallo algo obligatorio.
# Lo OPCIONAL que falte (graphify, CLI sqlite3) no aborta: solo WARN en resumen.
# =============================================================================

# NOTA: no usamos `set -e`. Queremos comprobar/instalar cada herramienta y
# llegar al resumen final aunque un paso individual falle. El control de
# errores es explicito por herramienta.
set -u

# -----------------------------------------------------------------------------
# Colores (se desactivan si la salida no es una terminal: logs limpios)
# -----------------------------------------------------------------------------
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ -n "${TERM:-}" ] && [ "${TERM:-}" != "dumb" ]; then
  C_RESET="$(tput sgr0)"
  C_GREEN="$(tput setaf 2)"
  C_YELLOW="$(tput setaf 3)"
  C_RED="$(tput setaf 1)"
  C_BLUE="$(tput setaf 4)"
  C_BOLD="$(tput bold)"
else
  C_RESET="" ; C_GREEN="" ; C_YELLOW="" ; C_RED="" ; C_BLUE="" ; C_BOLD=""
fi

ok()      { printf '%s[OK]%s      %s\n'      "$C_GREEN"  "$C_RESET" "$*"; }
install() { printf '%s[INSTALL]%s %s\n'      "$C_BLUE"   "$C_RESET" "$*"; }
warn()    { printf '%s[WARN]%s    %s\n'      "$C_YELLOW" "$C_RESET" "$*"; }
fail()    { printf '%s[FAIL]%s    %s\n'      "$C_RED"    "$C_RESET" "$*"; }
hdr()     { printf '\n%s== %s ==%s\n'        "$C_BOLD"   "$*" "$C_RESET"; }

# -----------------------------------------------------------------------------
# Acumuladores para el resumen final
# -----------------------------------------------------------------------------
SUMMARY_OK=()      # herramientas que quedaron listas
SUMMARY_MISS=()    # herramientas obligatorias que faltaron (-> exit 1)
SUMMARY_WARN=()    # herramientas opcionales que faltaron (no aborta)

mark_ok()   { SUMMARY_OK+=("$1"); }
mark_miss() { SUMMARY_MISS+=("$1"); }
mark_warn() { SUMMARY_WARN+=("$1"); }

hdr "Registry Universal — auto-instalador de dependencias"
printf 'Plataforma: %s | Usuario: %s | HOME: %s\n' "$(uname -s 2>/dev/null || echo unknown)" "$(id -un 2>/dev/null || echo '?')" "${HOME:-/root}"

# =============================================================================
# 1. node + npm  (prerequisito: NO auto-instalar; es responsabilidad del host)
# =============================================================================
hdr "1/7  node + npm (prerequisito)"

NODE_FATAL=0
if command -v node >/dev/null 2>&1; then
  ok "node presente ($(node --version 2>/dev/null))"
else
  fail "node NO esta instalado. Es PRERREQUISITO y no se auto-instala."
  printf '       Instalalo con tu gestor (ej: nvm, apt, dnf) y vuelve a correr este script.\n'
  printf '       Recomendado: nvm  ->  https://github.com/nvm-sh/nvm  (luego: nvm install --lts)\n'
  NODE_FATAL=1
fi

if command -v npm >/dev/null 2>&1; then
  ok "npm presente (v$(npm --version 2>/dev/null))"
else
  fail "npm NO esta instalado. Viene con Node.js. Reinstala Node.js."
  NODE_FATAL=1
fi

if [ "$NODE_FATAL" -eq 1 ]; then
  mark_miss "node/npm (prerequisito)"
  # Sin node/npm no tiene sentido seguir con los pasos npm. Igual seguimos
  # para evaluar python3 y dar un resumen completo de lo que falta.
fi

# =============================================================================
# 2. npm prefix  (evitar EACCES configurando ~/.npm-global si el prefix es de
#    sistema /usr o /usr/local). Idempotente: si ya esta configurado, no toca.
# =============================================================================
hdr "2/7  npm prefix (anti-EACCES)"

NPM_GLOBAL_DIR="${HOME:-/root}/.npm-global"

if [ "$NODE_FATAL" -eq 1 ] || ! command -v npm >/dev/null 2>&1; then
  warn "npm no disponible: se omite la configuracion de prefix."
else
  CURRENT_PREFIX="$(npm prefix -g 2>/dev/null)"
  if [ -z "$CURRENT_PREFIX" ]; then
    CURRENT_PREFIX="$(npm config get prefix 2>/dev/null)"
  fi
  printf '       prefix actual: %s\n' "${CURRENT_PREFIX:-<desconocido>}"

  needs_userland=0
  case "$CURRENT_PREFIX" in
    /usr|/usr/local) needs_userland=1 ;;
    "")              needs_userland=1 ;;  # no detectado -> ir a userland por seguridad
  esac

  # Si root, los globals de sistema son escribibles: no hay EACCES, no tocamos nada.
  if [ "$(id -u 2>/dev/null || echo 1000)" = "0" ]; then
    needs_userland=0
    ok "Ejecutando como root: prefix de sistema es escribible (sin EACCES)."
  fi

  if [ "$needs_userland" -eq 1 ]; then
    install "prefix apunta a sistema (riesgo EACCES). Configurando ${NPM_GLOBAL_DIR}"
    mkdir -p "${NPM_GLOBAL_DIR}/bin" "${NPM_GLOBAL_DIR}/lib"
    if npm config set prefix "${NPM_GLOBAL_DIR}" >/dev/null 2>&1; then
      ok "npm config set prefix -> ${NPM_GLOBAL_DIR}"
    else
      warn "No se pudo fijar prefix con 'npm config set' (se usara el actual)."
    fi
  else
    ok "prefix de usuario correcto: ${CURRENT_PREFIX} (sin cambios)"
    NPM_GLOBAL_DIR="$CURRENT_PREFIX"
  fi

  # --- Asegurar que el bin global esta en PATH (esta sesion + persistente) ---
  NPM_BIN="${NPM_GLOBAL_DIR}/bin"
  case ":${PATH}:" in
    *":${NPM_BIN}:"*)
      ok "PATH ya incluye ${NPM_BIN}"
      ;;
    *)
      export PATH="${NPM_BIN}:${PATH}"
      install "Anadido a PATH (esta sesion): ${NPM_BIN}"
      # Persistir en el rc del shell de forma idempotente.
      RC_FILE="${HOME:-/root}/.bashrc"
      [ -f "${HOME:-/root}/.zshrc" ] && [ -n "${ZSH_VERSION:-}" ] && RC_FILE="${HOME:-/root}/.zshrc"
      PATH_LINE='export PATH="'"${NPM_BIN}"':$PATH"'
      if [ -f "$RC_FILE" ] && grep -Fq "$NPM_BIN" "$RC_FILE" 2>/dev/null; then
        ok "PATH ya persistido en $RC_FILE"
      else
        {
          printf '\n# Registry Universal — npm global bin (anadido por install-deps.sh)\n'
          printf '%s\n' "$PATH_LINE"
        } >> "$RC_FILE" 2>/dev/null \
          && ok "PATH persistido en $RC_FILE (recarga con: source $RC_FILE)" \
          || warn "No se pudo escribir en $RC_FILE. Anade manualmente: $PATH_LINE"
      fi
      ;;
  esac
fi

# =============================================================================
# Helper: instala un paquete npm global solo si el binario no existe.
#   $1 = nombre del binario (command -v)
#   $2 = nombre del paquete npm
# Devuelve 0 si el binario quedo disponible, 1 si no.
# =============================================================================
ensure_npm_global() {
  bin_name="$1"
  pkg_name="$2"

  if command -v "$bin_name" >/dev/null 2>&1; then
    ok "$bin_name ya instalado ($(command -v "$bin_name"))"
    return 0
  fi

  if [ "$NODE_FATAL" -eq 1 ] || ! command -v npm >/dev/null 2>&1; then
    fail "$bin_name ausente y npm no disponible: no se puede instalar."
    return 1
  fi

  install "$bin_name no encontrado -> npm install -g $pkg_name"
  if npm install -g "$pkg_name" >/dev/null 2>&1; then
    # Re-evaluar PATH por si el binario quedo en el bin global recien anadido.
    hash -r 2>/dev/null || true
    if command -v "$bin_name" >/dev/null 2>&1; then
      ok "$bin_name instalado ($(command -v "$bin_name"))"
      return 0
    else
      warn "$pkg_name instalado pero '$bin_name' no esta en PATH. Revisa ${NPM_GLOBAL_DIR:-prefix}/bin"
      return 1
    fi
  else
    fail "npm install -g $pkg_name fallo. Reintenta manual: npm install -g $pkg_name"
    return 1
  fi
}

# =============================================================================
# 3. trace-mcp  (npm -g)  +  rebuild better-sqlite3 (bindings nativos)
#    El rebuild evita el error en runtime: "Could not locate the bindings file"
#    de better-sqlite3 cuando los binarios precompilados no encajan con el node
#    local. Recompilamos contra el node de este host.
# =============================================================================
hdr "3/7  trace-mcp (+ rebuild better-sqlite3)"

if ensure_npm_global "trace-mcp" "trace-mcp"; then
  # Localizar la carpeta del paquete global para recompilar la dep nativa.
  NPM_ROOT_G="$(npm root -g 2>/dev/null)"
  TRACE_DIR="${NPM_ROOT_G%/}/trace-mcp"

  if [ -d "$TRACE_DIR/node_modules/better-sqlite3" ]; then
    # Probar si los bindings ya cargan; si cargan, no recompilamos (idempotente).
    BINDING_OK=0
    if node -e "require('$TRACE_DIR/node_modules/better-sqlite3')" >/dev/null 2>&1; then
      BINDING_OK=1
    fi

    if [ "$BINDING_OK" -eq 1 ]; then
      ok "better-sqlite3 ya carga sus bindings (sin rebuild)"
    else
      install "Recompilando better-sqlite3 en $TRACE_DIR (bindings nativos)"
      # Ejecutamos el rebuild dentro de la carpeta del paquete (npm rebuild
      # opera sobre las deps del cwd). Usamos subshell para no cambiar el cwd.
      if ( cd "$TRACE_DIR" && npm rebuild better-sqlite3 ) >/dev/null 2>&1; then
        if node -e "require('$TRACE_DIR/node_modules/better-sqlite3')" >/dev/null 2>&1; then
          ok "better-sqlite3 recompilado y cargando correctamente"
        else
          warn "rebuild ejecutado pero los bindings aun no cargan."
          warn "Comprueba toolchain de compilacion: gcc/g++/make + python3 (node-gyp)."
        fi
      else
        warn "npm rebuild better-sqlite3 fallo. Probablemente falta toolchain."
        warn "Instala: build-essential (apt) o 'Development Tools' (dnf) + python3, y reintenta:"
        printf '         (cd %s && npm rebuild better-sqlite3)\n' "$TRACE_DIR"
      fi
    fi
  else
    # No siempre trace-mcp trae better-sqlite3; si no esta, no es un problema.
    warn "No se encontro better-sqlite3 dentro de $TRACE_DIR (puede no aplicar)."
  fi

  mark_ok "trace-mcp"
else
  mark_miss "trace-mcp"
fi

# =============================================================================
# 4. repomix  (npm -g)
# =============================================================================
hdr "4/7  repomix"

if ensure_npm_global "repomix" "repomix"; then
  mark_ok "repomix"
else
  mark_miss "repomix"
fi

# =============================================================================
# 5. graphify  (OPCIONAL)  ->  uv tool install graphifyy
#    Si no hay 'uv', solo avisamos. graphify no es bloqueante para el Registry.
# =============================================================================
hdr "5/7  graphify (opcional)"

if command -v graphify >/dev/null 2>&1; then
  ok "graphify ya instalado ($(command -v graphify))"
  mark_ok "graphify"
elif command -v uv >/dev/null 2>&1; then
  install "graphify no encontrado -> uv tool install graphifyy"
  if uv tool install graphifyy >/dev/null 2>&1; then
    hash -r 2>/dev/null || true
    if command -v graphify >/dev/null 2>&1; then
      ok "graphify instalado ($(command -v graphify))"
      mark_ok "graphify"
    else
      warn "graphifyy instalado pero 'graphify' no esta en PATH."
      warn "Anade el bin de uv al PATH (suele ser ~/.local/bin)."
      mark_warn "graphify (no en PATH)"
    fi
  else
    warn "uv tool install graphifyy fallo. Reintenta: uv tool install graphifyy"
    mark_warn "graphify (instalacion fallo)"
  fi
else
  warn "graphify ausente y 'uv' no esta instalado. Instalando uv (knowledge-graph es parte del Registry)..."
  if curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1; then
    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"; hash -r 2>/dev/null || true
    if command -v uv >/dev/null 2>&1; then
      ok "uv instalado ($(uv --version 2>&1 | awk '{print $2}'))"
      if uv tool install graphifyy >/dev/null 2>&1; then
        export PATH="$HOME/.local/bin:$PATH"; hash -r 2>/dev/null || true
        if command -v graphify >/dev/null 2>&1; then
          ok "graphify instalado ($(command -v graphify))"; mark_ok "graphify"
        else
          warn "graphifyy instalado pero 'graphify' no en PATH (anade ~/.local/bin)."; mark_warn "graphify (no en PATH)"
        fi
      else
        warn "uv tool install graphifyy fallo. Reintenta: uv tool install graphifyy"; mark_warn "graphify (instalacion fallo)"
      fi
    else
      warn "uv se instalo pero no esta en PATH. Abre shell nueva y: uv tool install graphifyy"; mark_warn "graphify (uv sin PATH)"
    fi
  else
    warn "No se pudo instalar uv (sin red?). Manual: curl -LsSf https://astral.sh/uv/install.sh | sh && uv tool install graphifyy"
    mark_warn "graphify (uv install fallo)"
  fi
fi

# =============================================================================
# 6. python3  (prerequisito para scanner.py / classifier.py)
# =============================================================================
hdr "6/7  python3 (prerequisito)"

if command -v python3 >/dev/null 2>&1; then
  ok "python3 presente ($(python3 --version 2>&1))"
  mark_ok "python3"
  PY_OK=1
else
  fail "python3 NO esta instalado. Es PRERREQUISITO (scanner.py / classifier.py)."
  printf '       Instalalo: sudo apt-get install -y python3   |   sudo dnf install -y python3\n'
  mark_miss "python3 (prerequisito)"
  PY_OK=0
fi

# =============================================================================
# 7. sqlite3  (modulo de python3 viene incluido en la stdlib). CLI opcional.
# =============================================================================
hdr "7/7  sqlite3"

if [ "${PY_OK:-0}" -eq 1 ]; then
  if python3 -c "import sqlite3; sqlite3.connect(':memory:').execute('select sqlite_version()')" >/dev/null 2>&1; then
    SQLITE_VER="$(python3 -c "import sqlite3; print(sqlite3.sqlite_version)" 2>/dev/null)"
    ok "modulo sqlite3 de python3 OK (libsqlite ${SQLITE_VER:-?})"
    mark_ok "sqlite3 (python)"
  else
    fail "El modulo sqlite3 de python3 NO carga (python compilado sin soporte sqlite)."
    printf '       Reinstala python3 con soporte sqlite (paquete libsqlite3 / sqlite-devel).\n'
    mark_miss "sqlite3 (modulo python)"
  fi
else
  warn "python3 ausente: no se puede verificar el modulo sqlite3."
  mark_warn "sqlite3 (sin python3)"
fi

# La CLI sqlite3 es opcional (el Registry usa el modulo de python). Solo informa.
if command -v sqlite3 >/dev/null 2>&1; then
  ok "CLI sqlite3 disponible ($(sqlite3 --version 2>/dev/null | awk '{print $1}'))"
else
  warn "CLI 'sqlite3' no instalada (OPCIONAL). Para tenerla: apt-get install -y sqlite3"
fi

# =============================================================================
# 8. jq  (PRERREQUISITO runtime de registry-build.sh: hace 'need jq' y muere sin el)
# =============================================================================
hdr "8/8  jq (prerequisito del orquestador)"
if command -v jq >/dev/null 2>&1; then
  ok "jq presente ($(jq --version 2>&1))"
  mark_ok "jq"
else
  warn "jq ausente — registry-build.sh lo requiere. Intentando instalar..."
  if command -v apt-get >/dev/null 2>&1; then sudo apt-get install -y jq >/dev/null 2>&1 || true
  elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y jq >/dev/null 2>&1 || true
  elif command -v yum >/dev/null 2>&1; then sudo yum install -y jq >/dev/null 2>&1 || true
  fi
  if command -v jq >/dev/null 2>&1; then
    ok "jq instalado ($(jq --version 2>&1))"; mark_ok "jq"
  else
    fail "jq NO se pudo instalar. Es PRERREQUISITO del orquestador (registry-build.sh)."
    printf '       Instalalo: sudo apt-get install -y jq   |   sudo dnf install -y jq\n'
    mark_miss "jq (prerequisito)"
  fi
fi

# =============================================================================
# RESUMEN FINAL
# =============================================================================
hdr "Resumen"

if [ "${#SUMMARY_OK[@]}" -gt 0 ]; then
  printf '%sListo:%s\n' "$C_GREEN" "$C_RESET"
  for item in "${SUMMARY_OK[@]}"; do printf '  [OK]   %s\n' "$item"; done
fi

if [ "${#SUMMARY_WARN[@]}" -gt 0 ]; then
  printf '%sOpcionales no instalados (no bloquean el Registry):%s\n' "$C_YELLOW" "$C_RESET"
  for item in "${SUMMARY_WARN[@]}"; do printf '  [WARN] %s\n' "$item"; done
fi

if [ "${#SUMMARY_MISS[@]}" -gt 0 ]; then
  printf '%sObligatorios que FALTARON:%s\n' "$C_RED" "$C_RESET"
  for item in "${SUMMARY_MISS[@]}"; do printf '  [FAIL] %s\n' "$item"; done
fi

printf '\n'
if [ "${#SUMMARY_MISS[@]}" -eq 0 ]; then
  printf '%s== Dependencias del Registry listas. ==%s\n' "$C_BOLD$C_GREEN" "$C_RESET"
  printf 'Si se cambio el PATH, abre una shell nueva o ejecuta: source ~/.bashrc\n'
  exit 0
else
  printf '%s== Instalacion incompleta: faltan %d obligatorias. ==%s\n' "$C_BOLD$C_RED" "${#SUMMARY_MISS[@]}" "$C_RESET"
  printf 'Resuelve los [FAIL] de arriba y vuelve a correr: bash install-deps.sh\n'
  exit 1
fi