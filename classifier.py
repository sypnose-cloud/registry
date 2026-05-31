#!/usr/bin/env python3
"""
Registry Universal — Clasificador de Proyectos (L2)
====================================================

Dado un repo/carpeta, detecta QUE TIPO de proyecto es (saas, api, bot,
worker, scraper, web, cli, library, app, unknown) y extrae su estructura
basica.

Capa L2 del Registry Universal de Sypnose: el L1 lista repos; el L2 los
clasifica y perfila para que el resto del Registry (APIs, tablas, BD,
frontend) sepa que esperar de cada uno.

Diseno:
  - Python 3 stdlib unicamente (json, os, sys, re, pathlib, collections).
  - Lee SOLO archivos marcadores (package.json, requirements.txt,
    pyproject.toml, Cargo.toml, go.mod) + estructura de carpetas. Para Rust
    se parsea el Cargo.toml (nombre + dependencias) y se inspeccionan los
    .rs en busca de handlers HTTP.
  - No ejecuta el repo, no instala nada, no llama a la red.
  - Heuristica por puntuacion: cada tipo acumula senales; gana el de mayor
    score con desempate por prioridad (saas > api > bot > worker > scraper >
    web > cli > library > app). markers_found explica POR QUE se clasifico asi.

API publica:
    classify_repo(path) -> dict con:
        name, type, language, framework, stack[], file_count,
        top_dirs[], endpoints_approx, markers_found[]

CLI:
    python3 classifier.py /ruta/al/repo
    python3 classifier.py /ruta/al/repo --pretty   (JSON indentado, default)
    python3 classifier.py /ruta/al/repo --compact   (JSON una linea)
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuracion
# ---------------------------------------------------------------------------

# Carpetas que ignoramos al recorrer (ruido / no son codigo del proyecto).
IGNORE_DIRS = {
    ".git", ".hg", ".svn", "node_modules", ".next", ".nuxt", "dist", "build",
    "out", "target", "__pycache__", ".venv", "venv", "env", ".env",
    ".idea", ".vscode", ".pytest_cache", ".mypy_cache", ".cache",
    "coverage", ".turbo", ".parcel-cache", "vendor", ".gradle",
    "__snapshots__", ".terraform", "bin", "obj",
}

# Extension -> lenguaje, para detectar el lenguaje predominante.
EXT_LANG = {
    ".ts": "TypeScript", ".tsx": "TypeScript",
    ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
    ".py": "Python",
    ".rs": "Rust",
    ".go": "Go",
    ".java": "Java", ".kt": "Kotlin",
    ".rb": "Ruby",
    ".php": "PHP",
    ".cs": "C#",
    ".c": "C", ".h": "C",
    ".cpp": "C++", ".cc": "C++", ".hpp": "C++",
    ".swift": "Swift",
    ".dart": "Dart",
    ".scala": "Scala",
    ".ex": "Elixir", ".exs": "Elixir",
    ".vue": "Vue", ".svelte": "Svelte", ".astro": "Astro",
}

# Dependencias que delatan cada framework / categoria.
# (nombre normalizado a minusculas; el match es por substring sobre la clave de dep)
NEXT_LIKE = ("next", "nuxt", "@remix-run", "remix")
EXPRESS_LIKE = ("express", "fastify", "@nestjs", "koa", "hapi", "@hapi", "restify")
PY_WEB = ("flask", "fastapi", "django", "starlette", "sanic", "tornado", "aiohttp", "bottle", "falcon")
DB_DEPS = ("@supabase", "supabase", "pg", "postgres", "prisma", "drizzle", "drizzle-orm",
           "mongoose", "mongodb", "typeorm", "sequelize", "knex", "mysql", "mysql2",
           "sqlalchemy", "psycopg2", "psycopg", "asyncpg", "pymongo", "redis",
           # Rust ORMs / drivers
           "sqlx", "sea-orm", "diesel", "tokio-postgres", "deadpool-postgres",
           "mongodb-rs")
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

# Palabras en el nombre del repo que dan pistas (refuerzo, no decisivas solas).
# Ampliado con vocabulario trading/bot real del ecosistema (stratos, rithmic...).
BOT_NAME_HINTS = (
    "bot", "trader", "trading", "agent", "stratos", "exchange", "rithmic",
    "metatrader", "mt5", "ccxt", "backtest", "nautilus", "eagleview",
)
SCRAPER_NAME_HINTS = ("scraper", "crawler", "etl", "spider", "scrape")
WORKER_NAME_HINTS = ("worker", "dispatch", "dispatcher", "mirofish", "mithos", "claw")

# --- Senales especificas de Rust (Cargo.toml) ------------------------------
# Dependencias / palabras de crate que delatan un bot de trading o chat en Rust.
# OJO: los nombres de crate se normalizan con '_' -> '-' al parsear el
# Cargo.toml, asi que aqui van en forma con guion (rust-decimal, no rust_decimal).
RUST_BOT_DEPS = (
    "rithmic", "metatrader", "mt5", "ccxt", "nautilus", "nautilus-trader",
    "backtest", "barter", "binance", "teloxide",
    "serenity", "twilight", "rust-decimal",
)
RUST_BOT_NAME = (
    "trading", "trader", "stratos", "bot", "exchange", "rithmic",
    "metatrader", "mt5", "ccxt", "backtest", "nautilus",
)
# Frameworks HTTP / gRPC en Rust -> servidor web/API.
RUST_WEB_DEPS = ("axum", "actix-web", "actix", "warp", "rocket", "tonic",
                 "hyper", "poem", "salvo", "tide")
# Runtime asincrono (worker/servicio de fondo).
RUST_ASYNC_DEPS = ("tokio", "async-std", "smol")
# CLI Rust.
RUST_CLI_DEPS = ("clap", "structopt", "argh", "gumdrop")

# Carpetas que indican UI con componentes (.tsx/.jsx/.vue/.svelte dentro).
UI_DIR_NAMES = ("app", "pages", "views", "templates", "components", "src/app",
                "src/pages", "src/components")


# ---------------------------------------------------------------------------
# Lectura de marcadores
# ---------------------------------------------------------------------------

def _read_json(path: Path) -> dict:
    """Lee un JSON tolerante a fallos. Devuelve {} si no se puede parsear."""
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _read_text(path: Path) -> str:
    """Lee texto tolerante a fallos. Devuelve '' si no se puede."""
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _pkg_deps(pkg: dict) -> dict:
    """Une dependencies + devDependencies + peerDependencies + optional en un solo dict."""
    deps: dict = {}
    for field in ("dependencies", "devDependencies", "peerDependencies",
                  "optionalDependencies"):
        block = pkg.get(field)
        if isinstance(block, dict):
            deps.update(block)
    return deps


def _parse_py_requirements(text: str) -> set:
    """Extrae nombres de paquete (minusculas) de un requirements.txt."""
    names = set()
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        # quita marcadores de entorno y extras: paquete[extra]==x ; sys_platform...
        line = line.split(";", 1)[0].strip()
        m = re.match(r"^([A-Za-z0-9_.\-]+)", line)
        if m:
            names.add(m.group(1).lower().replace("_", "-"))
    return names


def _parse_pyproject_deps(text: str) -> set:
    """
    Extrae nombres de dependencia de un pyproject.toml SIN libreria toml
    (stdlib-only para Python < 3.11 sin tomllib garantizado).

    Cubre los dos formatos comunes:
      [project] dependencies = ["fastapi>=0.1", "uvicorn"]
      [tool.poetry.dependencies] fastapi = "^0.1"
    Heuristica por regex; suficiente para clasificar.
    """
    names = set()

    # Formato PEP 621 / poetry array: dependencies = [ "...", "..." ]
    for block_match in re.finditer(
        r"dependencies\s*=\s*\[(.*?)\]", text, re.DOTALL | re.IGNORECASE
    ):
        for item in re.findall(r"""['"]([^'"]+)['"]""", block_match.group(1)):
            m = re.match(r"^([A-Za-z0-9_.\-]+)", item.strip())
            if m:
                names.add(m.group(1).lower().replace("_", "-"))

    # Formato poetry tabla: [tool.poetry.dependencies] \n fastapi = "^0.1"
    poetry = re.search(
        r"\[tool\.poetry\.dependencies\](.*?)(?:\n\[|\Z)", text, re.DOTALL
    )
    if poetry:
        for line in poetry.group(1).splitlines():
            m = re.match(r"^\s*([A-Za-z0-9_.\-]+)\s*=", line)
            if m:
                names.add(m.group(1).lower().replace("_", "-"))

    return names


def _parse_cargo(text: str) -> dict:
    """
    Parser ligero de Cargo.toml SIN libreria toml (stdlib-only). Extrae lo
    necesario para clasificar un repo Rust:

      {
        "name": "<package.name>" | "",
        "deps": set(),            # nombres de crate en minusculas (con '-')
        "has_bin_section": bool,  # hay [[bin]]
        "is_workspace": bool,     # hay [workspace]
      }

    Heuristica por regex. Cubre [dependencies], [dev-dependencies],
    [build-dependencies] y dependencias de [target.*]. Suficiente para tipar.
    """
    info = {"name": "", "deps": set(), "has_bin_section": False,
            "is_workspace": False}
    if not text:
        return info

    # package.name = "..."
    m = re.search(
        r"\[package\][^\[]*?\bname\s*=\s*[\"']([^\"']+)[\"']",
        text, re.DOTALL,
    )
    if m:
        info["name"] = m.group(1).strip().lower()

    info["has_bin_section"] = re.search(r"(?m)^\s*\[\[bin\]\]", text) is not None
    info["is_workspace"] = re.search(r"(?m)^\s*\[workspace\]", text) is not None

    # Cualquier tabla de dependencias: [dependencies], [dev-dependencies],
    # [build-dependencies], [target.'cfg(...)'.dependencies], etc.
    for header in re.finditer(
        r"(?m)^\s*\[(?:[A-Za-z0-9_.\-'\"()=\s]+\.)?"
        r"(?:dependencies|dev-dependencies|build-dependencies)\]\s*$",
        text,
    ):
        start = header.end()
        # El bloque va hasta el siguiente header [..] o fin de archivo.
        nxt = re.search(r"(?m)^\s*\[", text[start:])
        block = text[start:start + nxt.start()] if nxt else text[start:]
        for line in block.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            # crate = "1.0"   |   crate = { version = "1", features=[...] }
            dm = re.match(r"^([A-Za-z0-9_.\-]+)\s*=", line)
            if dm:
                info["deps"].add(dm.group(1).lower().replace("_", "-"))

    return info


# ---------------------------------------------------------------------------
# Recorrido del arbol (un solo walk, reutilizado por todo)
# ---------------------------------------------------------------------------

def _scan_tree(root: Path) -> dict:
    """
    Recorre el repo UNA vez y recolecta todo lo que necesitamos:
      - ext_counter: cuantos archivos por extension (para lenguaje)
      - file_count: total de archivos (no dirs, ignorando IGNORE_DIRS)
      - dir_set: set de rutas relativas de dirs vistas (en minusculas, '/')
      - ui_component_files: nº de .tsx/.jsx/.vue/.svelte bajo carpetas UI
      - route_files: nº de route.ts / route.js (endpoints aprox Next-style)
      - server_listen_hits / http_route_decorators: heuristica de servidor/endpoints
      - rust_route_hits: nº de handlers HTTP en .rs (axum .route(, actix
        web::get/post, #[get]/#[post])
      - rust_serve_hits: indicios de servidor escuchando en Rust
        (axum::serve, HttpServer::new, .bind(, Server::bind, .serve()
      - has_rust_main / has_rust_lib: existe algun main.rs / lib.rs
    """
    ext_counter: Counter = Counter()
    file_count = 0
    dir_set = set()
    ui_component_files = 0
    route_files = 0
    server_listen_hits = 0      # app.listen( / uvicorn / http.createServer
    http_route_decorators = 0   # @app.get / app.get( / router.post( etc.
    rust_route_hits = 0         # axum .route( / actix web::get / #[get] ...
    rust_serve_hits = 0         # axum::serve / HttpServer::new / .bind( ...
    has_rust_main = False       # cualquier main.rs en el arbol
    has_rust_lib = False        # cualquier lib.rs en el arbol

    root_str = str(root)

    for dirpath, dirnames, filenames in os.walk(root):
        # Poda in-place de carpetas ignoradas (no descendemos en ellas).
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS and not d.startswith(".git")]

        rel_dir = os.path.relpath(dirpath, root_str)
        if rel_dir == ".":
            rel_dir = ""
        rel_norm = rel_dir.replace(os.sep, "/").lower()
        if rel_norm:
            dir_set.add(rel_norm)

        in_ui_dir = any(
            seg in UI_DIR_NAMES for seg in rel_norm.split("/")
        ) or rel_norm.startswith(("app/", "pages/", "src/app/", "src/pages/"))

        in_api_dir = (
            "/api" in ("/" + rel_norm) and ("app" in rel_norm or "pages" in rel_norm)
        ) or rel_norm.endswith("routes") or "/routes/" in ("/" + rel_norm + "/")

        for fname in filenames:
            file_count += 1
            ext = os.path.splitext(fname)[1].lower()
            if ext:
                ext_counter[ext] += 1

            low = fname.lower()

            # Endpoints estilo Next/Remix/SvelteKit: route.ts, route.js, +server.ts
            if low in ("route.ts", "route.js", "route.tsx", "route.jsx") or \
               low in ("+server.ts", "+server.js"):
                route_files += 1
            # API folder en pages/ (pages/api/*.ts cuenta como endpoint)
            elif in_api_dir and ext in (".ts", ".js", ".tsx", ".jsx", ".py"):
                route_files += 1

            # Componentes UI
            if in_ui_dir and ext in (".tsx", ".jsx", ".vue", ".svelte"):
                ui_component_files += 1

            # Entrypoints Rust (en cualquier nivel: src/, crates/*/src/, etc.)
            if low == "main.rs":
                has_rust_main = True
            elif low == "lib.rs":
                has_rust_lib = True

            # Heuristica de servidor/handlers HTTP en Rust.
            if ext == ".rs":
                full = Path(dirpath) / fname
                try:
                    if full.stat().st_size <= 400_000:
                        txt = _read_text(full)
                        if txt:
                            # Handlers de ruta: axum Router .route("/x", ...),
                            # actix .route("/x", ...) / .service(, atributos
                            # #[get(...)] #[post(...)] (actix/poem/rocket).
                            rust_route_hits += len(re.findall(
                                r"\.route\s*\(|\.service\s*\(|"
                                r"#\[(?:get|post|put|delete|patch|head|options)\b",
                                txt,
                            ))
                            # Servidor escuchando.
                            if re.search(
                                r"axum::serve|HttpServer::new|Server::bind|"
                                r"\.bind\s*\(|\.serve\s*\(|tonic::transport::Server",
                                txt,
                            ):
                                rust_serve_hits += 1
                except OSError:
                    pass

            # Heuristica de servidor HTTP / rutas en codigo (solo archivos chicos
            # para no leer monstruos; nos basta con senal).
            if ext in (".py", ".js", ".ts", ".go"):
                full = Path(dirpath) / fname
                try:
                    if full.stat().st_size <= 200_000:
                        txt = _read_text(full)
                        if txt:
                            if re.search(r"app\.listen\(|uvicorn\.run|http\.createServer|"
                                         r"createServer\(|\.run_server\(|gunicorn", txt):
                                server_listen_hits += 1
                            http_route_decorators += len(re.findall(
                                r"@app\.(get|post|put|delete|patch)\b|"
                                r"@router\.(get|post|put|delete|patch)\b|"
                                r"\b(app|router)\.(get|post|put|delete|patch)\s*\(",
                                txt,
                            ))
                except OSError:
                    pass

    return {
        "ext_counter": ext_counter,
        "file_count": file_count,
        "dir_set": dir_set,
        "ui_component_files": ui_component_files,
        "route_files": route_files,
        "server_listen_hits": server_listen_hits,
        "http_route_decorators": http_route_decorators,
        "rust_route_hits": rust_route_hits,
        "rust_serve_hits": rust_serve_hits,
        "has_rust_main": has_rust_main,
        "has_rust_lib": has_rust_lib,
    }


def _detect_language(ext_counter: Counter) -> str:
    """Lenguaje predominante por nº de archivos de codigo (ignora datos/config)."""
    lang_counter: Counter = Counter()
    for ext, n in ext_counter.items():
        lang = EXT_LANG.get(ext)
        if lang:
            lang_counter[lang] += n
    if not lang_counter:
        return "unknown"
    # TypeScript y JavaScript se mezclan en repos JS; deja el mas frecuente.
    return lang_counter.most_common(1)[0][0]


def _any_dep(deps_lower: set, needles: tuple) -> list:
    """Devuelve la lista de needles presentes (substring) en el set de deps."""
    hits = []
    for needle in needles:
        for dep in deps_lower:
            if dep == needle or dep.startswith(needle):
                hits.append(needle)
                break
    return hits


# ---------------------------------------------------------------------------
# Clasificacion (motor de puntuacion)
# ---------------------------------------------------------------------------

def classify_repo(path) -> dict:
    """
    Clasifica un repo/carpeta y devuelve su perfil L2.

    Returns dict:
        {
          name, type, language, framework, stack[], file_count,
          top_dirs[], endpoints_approx, markers_found[]
        }
    """
    root = Path(path).expanduser().resolve()

    base = {
        "name": root.name or str(root),
        "type": "unknown",
        "language": "unknown",
        "framework": None,
        "stack": [],
        "file_count": 0,
        "top_dirs": [],
        "endpoints_approx": 0,
        "markers_found": [],
    }

    if not root.exists() or not root.is_dir():
        base["markers_found"].append(f"error: path no existe o no es carpeta ({root})")
        return base

    # --- Marcadores de manifiesto ------------------------------------------
    pkg = _read_json(root / "package.json")
    req_txt = _read_text(root / "requirements.txt")
    pyproject_txt = _read_text(root / "pyproject.toml")
    cargo_txt = _read_text(root / "Cargo.toml")
    cargo = (root / "Cargo.toml").exists()
    gomod = (root / "go.mod").exists()
    has_setup_py = (root / "setup.py").exists()

    # Parse del Cargo.toml (nombre de crate + deps + [[bin]] + workspace).
    cargo_info = _parse_cargo(cargo_txt) if cargo else {
        "name": "", "deps": set(), "has_bin_section": False,
        "is_workspace": False,
    }
    rust_deps: set = cargo_info["deps"]

    # Conjunto unificado de dependencias en minusculas (JS + Python + Rust).
    js_deps = _pkg_deps(pkg)
    deps_lower: set = set(d.lower() for d in js_deps.keys())
    if req_txt:
        deps_lower |= _parse_py_requirements(req_txt)
    if pyproject_txt:
        deps_lower |= _parse_pyproject_deps(pyproject_txt)
    if rust_deps:
        deps_lower |= rust_deps

    # --- Walk del arbol -----------------------------------------------------
    scan = _scan_tree(root)
    base["file_count"] = scan["file_count"]
    base["language"] = _detect_language(scan["ext_counter"])

    # top-level dirs reales (primer segmento), ya filtrados por IGNORE_DIRS.
    top_dirs = sorted({
        d.split("/")[0] for d in scan["dir_set"] if d and "/" not in d
    })
    base["top_dirs"] = top_dirs
    top_set = set(top_dirs)

    # --- Senales reutilizables ---------------------------------------------
    next_hits = _any_dep(deps_lower, NEXT_LIKE)
    express_hits = _any_dep(deps_lower, EXPRESS_LIKE)
    pyweb_hits = _any_dep(deps_lower, PY_WEB)
    db_hits = _any_dep(deps_lower, DB_DEPS)
    auth_hits = _any_dep(deps_lower, AUTH_DEPS)
    fe_style_hits = _any_dep(deps_lower, FRONTEND_DEPS)
    fe_fw_hits = _any_dep(deps_lower, FRONTEND_FRAMEWORKS)
    bot_dep_hits = _any_dep(deps_lower, BOT_DEPS)
    scraper_dep_hits = _any_dep(deps_lower, SCRAPER_DEPS)

    # Nombre a considerar: el de la carpeta + el del crate Cargo (si difiere,
    # ambos cuentan; ej. carpeta 'svc' con package.name 'mirofish-dispatch').
    name_lower = base["name"].lower()
    cargo_name = cargo_info["name"]
    name_blob = name_lower + " " + cargo_name
    bot_name_hit = [h for h in BOT_NAME_HINTS if h in name_blob]
    scraper_name_hit = [h for h in SCRAPER_NAME_HINTS if h in name_blob]
    worker_name_hit = [h for h in WORKER_NAME_HINTS if h in name_blob]

    # --- Senales Rust -------------------------------------------------------
    is_rust = cargo or base["language"] == "Rust"
    rust_bot_dep_hits = _any_dep(rust_deps, RUST_BOT_DEPS) if is_rust else []
    rust_web_dep_hits = _any_dep(rust_deps, RUST_WEB_DEPS) if is_rust else []
    rust_async_hits = _any_dep(rust_deps, RUST_ASYNC_DEPS) if is_rust else []
    rust_cli_hits = _any_dep(rust_deps, RUST_CLI_DEPS) if is_rust else []
    rust_bot_name_hit = [h for h in RUST_BOT_NAME if h in name_blob] if is_rust else []
    has_bin = cargo_info["has_bin_section"] or scan["has_rust_main"]
    rust_route_hits = scan["rust_route_hits"]
    rust_serve_hits = scan["rust_serve_hits"]
    has_rust_http_server = bool(rust_web_dep_hits) and (
        rust_serve_hits > 0 or rust_route_hits > 0
    )

    has_app_or_pages = bool({"app", "pages"} & top_set) or \
        any(d in ("src/app", "src/pages") for d in scan["dir_set"])
    has_api_dir = any(
        seg == "api" for d in scan["dir_set"] for seg in d.split("/")
    ) and has_app_or_pages
    has_middleware = (root / "middleware.ts").exists() or (root / "middleware.js").exists() \
        or (root / "src" / "middleware.ts").exists()
    has_ui_components = scan["ui_component_files"] > 0
    has_http_server = (
        scan["server_listen_hits"] > 0
        or scan["http_route_decorators"] > 0
        or bool(express_hits)
        or bool(pyweb_hits)
        or "django" in deps_lower
        or has_rust_http_server
    )

    has_any_manifest = bool(pkg) or bool(req_txt) or bool(pyproject_txt) \
        or cargo or gomod or has_setup_py

    # Endpoints aproximados: route files (Next), decoradores HTTP (api/bot)
    # o handlers Rust (axum/actix). Tomamos la senal mas alta.
    endpoints = max(
        scan["route_files"], scan["http_route_decorators"], rust_route_hits,
    )

    markers: list = []
    scores: dict = {
        "saas": 0, "api": 0, "bot": 0, "worker": 0, "scraper": 0,
        "web": 0, "cli": 0, "library": 0, "app": 0,
    }

    # =======================================================================
    # SaaS
    #   next/nuxt/remix + (app/ o pages/) + (app/api o middleware)
    #   refuerzo: BD + auth + frontend styling
    # =======================================================================
    if next_hits:
        markers.append(f"dep:{next_hits[0]} (meta-framework SSR)")
        scores["saas"] += 3
        if has_app_or_pages:
            scores["saas"] += 2
            markers.append("dir:app/|pages/ presente")
        if has_api_dir:
            scores["saas"] += 3
            markers.append("dir:app/api|pages/api (rutas servidor)")
        if has_middleware:
            scores["saas"] += 1
            markers.append("file:middleware.ts")
        if db_hits:
            scores["saas"] += 2
            markers.append(f"BD:{','.join(db_hits)}")
        if auth_hits:
            scores["saas"] += 2
            markers.append(f"auth:{','.join(auth_hits)}")
        if fe_style_hits:
            scores["saas"] += 1
            markers.append(f"frontend:{','.join(fe_style_hits)}")

    # =======================================================================
    # API
    #   express/fastify/nest/koa  O  flask/fastapi/django
    #   O Rust axum/actix/warp/rocket/tonic (gRPC) con handlers
    #   SIN UI (sin componentes .tsx/.jsx/.vue en app/pages/views/templates)
    # =======================================================================
    if express_hits or pyweb_hits or rust_web_dep_hits:
        if express_hits:
            markers.append(f"dep:{','.join(express_hits)} (HTTP server JS)")
        if pyweb_hits:
            markers.append(f"dep:{','.join(pyweb_hits)} (HTTP server Python)")
        if rust_web_dep_hits:
            markers.append(f"dep:{','.join(rust_web_dep_hits)} (HTTP/gRPC server Rust)")
        scores["api"] += 4
        # En Rust exigimos handlers o servidor escuchando para confirmar API
        # (axum como dep sin rutas podria ser solo cliente/util).
        if rust_web_dep_hits and not (express_hits or pyweb_hits):
            if rust_route_hits > 0 or rust_serve_hits > 0:
                scores["api"] += 2
                markers.append(
                    f"rust handlers={rust_route_hits} serve={rust_serve_hits}"
                )
            else:
                scores["api"] -= 2  # dep web pero sin endpoints visibles
        if not has_ui_components:
            scores["api"] += 3
            markers.append("sin componentes UI -> backend puro")
        else:
            # Hay UI: probablemente es SaaS/web full-stack, no API pura.
            scores["api"] -= 1
        if db_hits:
            scores["api"] += 1
            markers.append(f"BD:{','.join(db_hits)} (persistencia)")
        if endpoints:
            scores["api"] += 1

    # =======================================================================
    # bot   (cualquier lenguaje, Rust incluido)
    #   deps de trading/exchange/chat (ccxt/metaapi/MT5/telegram/discord/rpyc
    #     o crates Rust rithmic/nautilus/teloxide/serenity/rust_decimal...)
    #   O nombre con bot/trader/trading/agent/stratos/exchange/rithmic/...
    #   SIN servidor HTTP que exponga rutas -> proceso de fondo, no API
    # =======================================================================
    any_bot_dep = bool(bot_dep_hits) or bool(rust_bot_dep_hits)
    any_bot_name = bool(bot_name_hit) or bool(rust_bot_name_hit)
    if bot_dep_hits:
        markers.append(f"dep:{','.join(bot_dep_hits)} (trading/chat bot)")
        scores["bot"] += 4
    if rust_bot_dep_hits:
        markers.append(f"rust-dep:{','.join(rust_bot_dep_hits)} (trading/chat crate)")
        scores["bot"] += 4
    if any_bot_name and (any_bot_dep or not has_http_server):
        hits = sorted(set(bot_name_hit) | set(rust_bot_name_hit))
        markers.append(f"nombre contiene {hits} -> bot")
        scores["bot"] += 2
    if (any_bot_dep or any_bot_name) and not has_http_server:
        scores["bot"] += 2
        markers.append("sin servidor HTTP -> proceso bot/agente")
    elif any_bot_dep and has_http_server:
        # Bot que ademas expone un panel/health; sigue siendo bot pero menos puro.
        scores["bot"] += 0

    # =======================================================================
    # scraper
    #   playwright/puppeteer/selenium/scrapy/bs4/cheerio  O nombre scraper/crawler/etl
    # =======================================================================
    if scraper_dep_hits:
        markers.append(f"dep:{','.join(scraper_dep_hits)} (scraping/automation)")
        scores["scraper"] += 4
    if scraper_name_hit:
        markers.append(f"nombre contiene {scraper_name_hit} -> scraper/etl")
        scores["scraper"] += 2
    # Un scraper headless suele NO servir HTTP; refuerzo leve.
    if scraper_dep_hits and not has_http_server:
        scores["scraper"] += 1

    # =======================================================================
    # web
    #   react/vue/svelte/astro SIN backend (sin app/api, sin server HTTP)
    # =======================================================================
    if fe_fw_hits and not next_hits:
        markers.append(f"frontend-fw:{','.join(fe_fw_hits)}")
        scores["web"] += 3
        if not has_api_dir and not has_http_server:
            scores["web"] += 3
            markers.append("sin app/api ni server -> frontend puro")
        else:
            scores["web"] -= 1
        if fe_style_hits:
            scores["web"] += 1

    # =======================================================================
    # Rust especifico (Cargo.toml)
    #   worker/dispatcher : tokio + nombre worker/dispatch/mirofish/mithos/claw
    #   cli               : clap/structopt SIN servidor web
    #   library           : lib.rs sin main.rs ni [[bin]] -> crate libreria
    #   (bot y api ya cubiertos arriba; aqui solo lo que faltaba)
    # =======================================================================
    rust_has_lib = scan["has_rust_lib"] or (root / "src" / "lib.rs").exists()
    if is_rust:
        # worker / dispatcher: runtime async + nombre de worker, sin servir HTTP
        if worker_name_hit and rust_async_hits and not has_rust_http_server \
                and not any_bot_dep:
            scores["worker"] += 4
            markers.append(
                f"rust worker: tokio + nombre {worker_name_hit} (sin HTTP) -> worker"
            )
        elif worker_name_hit and not has_rust_http_server and not any_bot_dep:
            scores["worker"] += 2
            markers.append(f"nombre {worker_name_hit} -> worker/dispatcher")

        # cli: clap/structopt y NO es servidor web ni bot
        if rust_cli_hits and not has_rust_http_server and not any_bot_dep \
                and not worker_name_hit:
            scores["cli"] += 3
            markers.append(f"rust-dep:{','.join(rust_cli_hits)} (CLI) -> cli")

        # library: expone lib.rs y no hay binario ni servidor ni bot
        if rust_has_lib and not has_bin and not has_rust_http_server \
                and not any_bot_dep and not worker_name_hit:
            scores["library"] += 3
            markers.append("Cargo + lib.rs sin bin/server -> crate libreria")

    # =======================================================================
    # library
    #   tiene manifest pero 0 senales anteriores fuertes; expone main/exports/bin
    # =======================================================================
    exposes_entry = bool(
        pkg.get("main") or pkg.get("module") or pkg.get("exports")
        or pkg.get("bin") or pkg.get("types")
    )
    py_lib_signal = has_setup_py or (
        bool(pyproject_txt) and re.search(
            r"\[build-system\]|\[tool\.(setuptools|hatch|flit|poetry)\]", pyproject_txt
        ) is not None
    )
    # Solo es lib Rust si hay lib.rs y NO hay binario (main.rs / [[bin]]).
    # Un crate con lib.rs + main.rs es un binario que ademas expone libreria.
    rust_lib = cargo and rust_has_lib and not has_bin
    go_lib = gomod and not (root / "main.go").exists() and \
        not any(d in ("cmd",) for d in top_set)

    strong_app_signal = (
        bool(next_hits) or bool(express_hits) or bool(pyweb_hits)
        or bool(bot_dep_hits) or bool(scraper_dep_hits)
        or bool(rust_bot_dep_hits) or bool(rust_web_dep_hits)
        or bool(rust_cli_hits)
        or any_bot_name or bool(worker_name_hit)
        or has_bin
        or has_http_server or has_ui_components
    )
    if has_any_manifest and not strong_app_signal:
        if exposes_entry:
            scores["library"] += 3
            markers.append("expone main/module/exports/bin -> libreria")
        if py_lib_signal:
            scores["library"] += 2
            markers.append("build-system pyproject/setup.py -> paquete")
        if rust_lib:
            scores["library"] += 3
            markers.append("Cargo + lib.rs (sin binario) -> crate libreria")
        if go_lib:
            scores["library"] += 2
            markers.append("go.mod sin main.go -> modulo Go")
        if scores["library"] == 0:
            # Manifest presente pero sin entrypoint claro: igual es lib minima.
            scores["library"] += 1
            markers.append("manifest sin app -> probable libreria")

    # --- Decision final -----------------------------------------------------
    # Prioridad de desempate (mas especifico primero).
    priority = ["saas", "api", "bot", "worker", "scraper", "web", "cli",
                "library", "app"]
    best_type = "unknown"
    best_score = 0
    for t in priority:
        if scores[t] > best_score:
            best_score = scores[t]
            best_type = t

    # Fallback "app": si nada hizo match claro pero hay un binario ejecutable
    # (Cargo [[bin]]/main.rs, o main.go, o package.json con bin), es una
    # aplicacion ejecutable, no "unknown". Mejor poco-especifico que nada.
    if best_score == 0:
        has_executable = (
            has_bin
            or (gomod and (root / "main.go").exists())
            or (gomod and "cmd" in top_set)
            or bool(pkg.get("bin"))
        )
        if has_executable:
            scores["app"] += 1
            best_type = "app"
            best_score = 1
            if cargo:
                markers.append("Cargo con [[bin]]/main.rs sin tipo claro -> app")
            else:
                markers.append("binario ejecutable sin tipo claro -> app")
        else:
            best_type = "unknown"
            if not has_any_manifest:
                markers.append("sin package.json/requirements/pyproject/Cargo/go.mod")
            else:
                markers.append("manifest presente pero sin marcadores de tipo")

    base["type"] = best_type

    # --- framework canonico (etiqueta legible) -----------------------------
    framework = None
    if next_hits:
        framework = {"next": "Next.js", "nuxt": "Nuxt", "remix": "Remix",
                     "@remix-run": "Remix"}.get(next_hits[0], next_hits[0])
    elif express_hits:
        framework = {"express": "Express", "fastify": "Fastify",
                     "@nestjs": "NestJS", "koa": "Koa", "hapi": "Hapi",
                     "@hapi": "Hapi", "restify": "Restify"}.get(
            express_hits[0], express_hits[0])
    elif pyweb_hits:
        framework = {"fastapi": "FastAPI", "flask": "Flask", "django": "Django",
                     "starlette": "Starlette", "sanic": "Sanic",
                     "tornado": "Tornado", "aiohttp": "aiohttp",
                     "bottle": "Bottle", "falcon": "Falcon"}.get(
            pyweb_hits[0], pyweb_hits[0])
    elif fe_fw_hits:
        framework = {"react": "React", "react-dom": "React", "vue": "Vue",
                     "svelte": "Svelte", "@sveltejs/kit": "SvelteKit",
                     "astro": "Astro", "solid-js": "SolidJS",
                     "preact": "Preact", "@angular/core": "Angular",
                     "lit": "Lit"}.get(fe_fw_hits[0], fe_fw_hits[0])
    elif scraper_dep_hits:
        framework = {"scrapy": "Scrapy", "playwright": "Playwright",
                     "puppeteer": "Puppeteer", "selenium": "Selenium"}.get(
            scraper_dep_hits[0], scraper_dep_hits[0])
    elif bot_dep_hits:
        framework = bot_dep_hits[0]
    elif cargo:
        # Framework REAL del crate Rust, no solo "Cargo": preferimos el
        # framework web > runtime async > CLI; con bot crate lo nombramos.
        rust_fw_label = {
            "axum": "Axum", "actix-web": "Actix Web", "actix": "Actix",
            "warp": "Warp", "rocket": "Rocket", "tonic": "Tonic (gRPC)",
            "hyper": "Hyper", "poem": "Poem", "salvo": "Salvo", "tide": "Tide",
            "tokio": "Tokio", "async-std": "async-std", "smol": "smol",
            "clap": "clap", "structopt": "StructOpt", "argh": "argh",
            "gumdrop": "gumdrop",
        }
        if rust_web_dep_hits:
            framework = rust_fw_label.get(rust_web_dep_hits[0], rust_web_dep_hits[0])
        elif rust_bot_dep_hits:
            framework = rust_bot_dep_hits[0]
        elif rust_cli_hits and not rust_async_hits:
            framework = rust_fw_label.get(rust_cli_hits[0], rust_cli_hits[0])
        elif rust_async_hits:
            framework = rust_fw_label.get(rust_async_hits[0], rust_async_hits[0])
        elif rust_cli_hits:
            framework = rust_fw_label.get(rust_cli_hits[0], rust_cli_hits[0])
        else:
            framework = "Cargo"
    elif gomod:
        framework = "Go modules"
    base["framework"] = framework

    # --- stack (deps principales, top 12) ----------------------------------
    base["stack"] = _principal_stack(js_deps, deps_lower)

    # --- endpoints aprox ----------------------------------------------------
    base["endpoints_approx"] = int(endpoints)

    # --- name/version desde manifest cuando exista -------------------------
    if pkg.get("name"):
        base["name"] = pkg["name"]
    elif cargo_info["name"]:
        base["name"] = cargo_info["name"]
    base["version"] = (
        pkg.get("version")
        or _toml_version(pyproject_txt)
        or _toml_version(_read_text(root / "Cargo.toml"))
        or None
    )

    # --- scripts del package.json (utiles para el Registry) ----------------
    scripts = pkg.get("scripts")
    base["scripts"] = list(scripts.keys()) if isinstance(scripts, dict) else []

    # markers_found final (dedup preservando orden) + score ganador.
    seen = set()
    deduped = []
    for m in markers:
        if m not in seen:
            seen.add(m)
            deduped.append(m)
    base["markers_found"] = deduped
    base["_scores"] = scores  # diagnostico; util para depurar la clasificacion

    return base


def _principal_stack(js_deps: dict, deps_lower: set) -> list:
    """
    Devuelve hasta 12 dependencias 'principales' (las que importan para
    entender el stack): frameworks, BD, auth, scraping, bots, lenguaje.
    Prioriza las senales conocidas; rellena con el resto.
    """
    important_groups = (
        NEXT_LIKE + EXPRESS_LIKE + PY_WEB + DB_DEPS + AUTH_DEPS
        + FRONTEND_FRAMEWORKS + FRONTEND_DEPS + BOT_DEPS + SCRAPER_DEPS
        + RUST_WEB_DEPS + RUST_BOT_DEPS + RUST_ASYNC_DEPS + RUST_CLI_DEPS
    )
    picked = []
    seen = set()
    # 1) primero las dependencias 'famosas' que esten presentes
    for needle in important_groups:
        for dep in sorted(deps_lower):
            if dep in seen:
                continue
            if dep == needle or dep.startswith(needle):
                picked.append(dep)
                seen.add(dep)
                break
        if len(picked) >= 12:
            return picked[:12]
    # 2) rellena con el resto de deps JS (orden alfabetico) hasta 12
    for dep in sorted(deps_lower):
        if dep not in seen:
            picked.append(dep)
            seen.add(dep)
        if len(picked) >= 12:
            break
    return picked[:12]


def _toml_version(text: str) -> str | None:
    """Extrae version = "x.y.z" de un TOML (pyproject/Cargo) sin parser TOML."""
    if not text:
        return None
    m = re.search(r'(?m)^\s*version\s*=\s*["\']([^"\']+)["\']', text)
    return m.group(1) if m else None


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _main(argv: list) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    flags = {a for a in argv[1:] if a.startswith("--")}

    if not args or "--help" in flags or "-h" in flags:
        prog = os.path.basename(argv[0])
        sys.stderr.write(
            f"Registry Universal L2 — Clasificador de Proyectos\n\n"
            f"Uso:\n"
            f"  python3 {prog} <ruta-repo> [--compact|--pretty]\n\n"
            f"Salida: JSON con {{name, type, language, framework, stack, "
            f"file_count, top_dirs, endpoints_approx, markers_found}}.\n"
            f"Tipos posibles: saas | api | bot | worker | scraper | web | "
            f"cli | library | app | unknown\n"
        )
        return 0 if ("--help" in flags or "-h" in flags) else 2

    target = args[0]
    result = classify_repo(target)

    if "--compact" in flags:
        sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
    else:
        sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv))