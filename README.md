# Sypnose Registry

A **live, self-updating registry of an entire server**: what services and containers
are running, what ports are open, every git repo present — and a classification of
each project (saas / api / bot / worker / scraper / web / cli / library / app) plus
the code graph of each repo (which API route touches which DB table). Served over HTTP,
refreshed automatically every 15 minutes. For humans and AI agents.

Point it at a server. One command. No manual catalog files.

---

## What it does

Tells you **what's on your server** (how many services, containers, repos) and
**classifies each project** — if there's a SaaS it says `saas`, if there's a trading bot
it says `bot` + `trading`, etc — **plus the code graph of each repo** (which API touches
which DB table). For humans (a dashboard) and AI agents (an HTTP API + the `/registry` skill).

---

## Install — one command

**Linux (clean server, verified on a virgin Ubuntu container):**
```bash
curl -fsSL https://raw.githubusercontent.com/sypnose-cloud/registry/main/install.sh | bash -s -- --roots "/home,/opt" --port 7008
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/sypnose-cloud/registry/main/install.ps1 | iex
```

`--roots` is the comma-separated list of directories to scan for git repos.
`--port` is the HTTP port for the API + dashboard. The installer auto-installs every
dependency (see below), copies the scanner / classifier / orchestrator / API server,
runs a first full scan + classify of the server, and starts a service on `:7008` plus a
15-minute refresh timer.

---

## How it's composed (architecture)

The Registry is a small pipeline of single-purpose pieces glued by one orchestrator:

- **`scanner.py`** — enumerates what's live on the server: systemd services (system + user),
  docker containers, listening ports (`ss`, falls back to `netstat`), the key process behind
  each port, and git repos under the `--roots`. stdlib only, atomic writes → `server-scan.json`.
- **`classifier.py`** — classifies each repo by **type** (saas / api / bot / worker / scraper /
  web / cli / library / app / docs / config) and by **domain** (trading / fiscal / ai-agents /
  scraping / infra / general), reading manifests (`package.json`, `requirements.txt`,
  `pyproject.toml`, `Cargo.toml`, `go.mod`) and folder structure. type and domain are
  orthogonal, so a trading API comes out `type:api` + `domain:trading`. Output → `projects.json`.
- **`trace-mcp`** — indexes each repo's code into a SQLite graph (route handlers, symbols,
  calls, `.from('table')` DB queries). This is what powers the API→DB mapping.
- **`graphify`** — generates the visual knowledge graph per repo (optional).
- **`registry-build.sh`** — the **orchestrator**: runs `scanner.py` → `classifier.py` →
  `trace-mcp` (for `saas`/`api` repos) → `graphify`, with per-repo timeouts and fault isolation
  (one bad repo never kills the cycle). Driven every 15 min by a systemd user timer. Writes
  `server-scan.json`, `projects.json`, `build-summary.json`.
- **`backstage-api`** (Node / Express) — reads those JSON files + the trace-mcp SQLite graph and
  serves everything over HTTP on `:7008`: `/registry/*` (inventory), `/codegraph/*` (API→DB graph),
  `/supabase/*` (DB tables/FKs, if a Postgres/Supabase RPC is configured), and a static HTML
  dashboard for humans.

```
                       ┌──────────────┐
   THE SERVER  ───────▶│  scanner.py  │──┐
   (systemd, docker,   │ classifier.py│  ├─▶  server-scan.json + projects.json
    ports, repos)      └──────────────┘  │
                                         │
   EACH REPO   ───────▶┌──────────────┐  │
   (code)              │  trace-mcp   │  ├─▶  SQLite code graph (+ graphify visuals)
                       │  graphify    │──┘
                       └──────────────┘
                                         │   (registry-build.sh orchestrates the
                                         │    above every 15 min via systemd timer)
                                         ▼
                       ┌────────────────────────────────┐
   ALL OF IT   ───────▶│  backstage-api  (Node/Express)  │──▶  :7008
                       │  reads JSON + SQLite graph       │     • dashboard (humans)
                       └────────────────────────────────┘     • HTTP API (agents)
```

It is **self-updating**: change your code or spin up a new service, and within 15 minutes
the registry reflects it. No manual YAML, no manual catalog.

---

## What you get (HTTP endpoints on `:7008`)

| Endpoint | What it returns |
|----------|-----------------|
| `GET /health` | status + service count |
| `GET /registry/summary` | rollup: hostname, #services, #repos, counts by type, scan age |
| `GET /registry/server` | raw server scan (services, ports, containers, repos) |
| `GET /registry/projects` | every repo, classified (type + domain + stack) |
| `GET /registry/saas` | only the projects classified as `saas` |
| `GET /registry/project/:name` | detail of one project (case-insensitive) |
| `GET /codegraph/summary` | files, symbols, edges, route handlers, DB queries |
| `GET /codegraph/routes` | all API route handlers detected |
| `GET /codegraph/routes-with-tables` | which API route touches which DB table |
| `GET /codegraph/route/:path` | call chain + DB queries for one route file |
| `GET /supabase/summary` | DB tables, FK count, schemas (if Postgres/Supabase RPC set) |
| `GET /supabase/tables` · `/supabase/tables/:name/columns` · `/supabase/fks` | schema detail |
| `GET /fleet/*` | host/container inventory via osquery/Fleet (only if `FLEET_URL` is set) |

Plus a static HTML **dashboard** at `GET /` for humans.

---

## Requirements (auto-installed)

The installer **auto-installs every dependency** on a clean server — `node`, `python3`,
`jq`, `git`, `build-essential` (for native modules), and `uv` / `graphify` / `trace-mcp` —
across any distro (`apt` / `dnf` / `yum` / `apk` / `pacman`). The only real prerequisites are:

- **`curl`** (used for the health-check and to fetch the toolchain)
- **`sudo` (or running as root)** — needed once to install the system packages
- **internet access**

That's it. On a box where everything is already present, the installer detects each tool
with `command -v` and skips it (idempotent).

---

## Configuration

Flags (or the equivalent env var, env wins are noted):

| Flag | Env var | Default | Meaning |
|------|---------|---------|---------|
| `--roots` | `REGISTRY_ROOTS` | `/home,/opt` | Comma-separated dirs to scan for git repos |
| `--port` | `REGISTRY_PORT` | `7008` | HTTP port for the API + dashboard |
| — | `REGISTRY_BIND` | `0.0.0.0` | Bind address |
| — | `FLEET_URL` | (unset) | Enable host-fleet inventory (osquery/Fleet). Off by default |
| — | `SUPABASE_SERVICE_KEY` / `SUPABASE_RPC_URL` | (unset) | Enable the `/supabase/*` DB endpoints |

No secrets in this repo. Anything sensitive (Fleet creds, DB key) is supplied via env at install time.

---

## Uninstall

```bash
systemctl --user disable --now registry-api.service registry-refresh.timer
rm -rf ~/.registry ~/.registry-data ~/.config/systemd/user/registry-*.{service,timer}
systemctl --user daemon-reload
```

---

## Limitations (honest)

- **API → DB** mapping captures direct `.from('table')` calls in the handler. Routes that
  query through helper functions may not be fully traced.
- **`/supabase/*`** endpoints are off unless you set `SUPABASE_SERVICE_KEY` + `SUPABASE_RPC_URL`
  pointing at a reachable Postgres/Supabase RPC; otherwise they return `503 available:false`.
- **Fleet** integration is off unless you set `FLEET_URL` to a running Fleet/osquery server.
- The code-graph / `routes-with-tables` mapping is tuned for Next.js / Supabase stacks first;
  the classifier itself handles many more languages, but the API→DB chain is richest on that stack.
- In a **container without systemd**, the service does not start as a daemon; the installer
  detects this and prints the manual command (`node server.js`). On a real VPS/server with
  systemd, it starts on its own (enable linger if it's headless: `sudo loginctl enable-linger $USER`).

---

MIT. Not affiliated with Anthropic. Built as part of [Sypnose](https://github.com/sypnose-cloud).
