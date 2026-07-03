# Sypnose Registry

**Open any folder → an interactive knowledge graph of everything inside. Live, time-travel, and chat with it.**

This repo ships **two things** that share the same idea (a self-updating map of your code):

| I want to… | Use | Section |
|---|---|---|
| **Explore a folder/repo on my desktop** — see it as a graph, watch it update live, scrub its history, ask an AI about it | **Sypnose Registry (desktop app, Windows)** | [↓ Desktop app](#-desktop-app-windows) |
| **Map an entire Linux server** — services, containers, ports, every repo, API→DB graph, over HTTP | **Registry server (Linux, `curl \| bash`)** | [↓ Server registry](#-server-registry-linux) |

---

# 🖥️ Desktop app (Windows)

> Point it at any folder. It indexes the folder into an interactive graph, **watches it live** as you (or an AI agent) edit files, lets you **travel back in time** through every scan, and lets you **chat with the graph** using your own Anthropic key.

![Sypnose Registry — hero](media/hero.png)
<!-- GIF/screenshot PENDIENTE CARLOS: capture the app on a real repo. See "Screenshots to record" below. -->

## What it does (the three features)

- **🟢 Live graph** — the graph re-indexes itself within seconds when files change on disk. No refresh button.
- **🕑 Time-travel** — every scan is snapshotted; drag a slider to reconstruct the folder at any past moment, with color-coded diffs.
- **💬 Chat (NotebookLM-style)** — ask questions about the folder in plain language; answers cite the exact files/entities and clicking a citation centers that node. Uses **your own Anthropic API key**.

---

## Install

Requirements: **Windows 10 1809+ (build 17763) or Windows 11, x64.**

### Option A — Microsoft Store (recommended, once published)

> _Store link: **PENDIENTE CARLOS** (submit `v2.0.0` to Partner Center)._

Nothing else to do — the Store handles trust and updates.

### Option B — GitHub Release (sideload the signed MSIX)

The MSIX is signed with a **self-issued certificate** (publisher `RepackagerExpress`), not a public CA. So Windows needs you to **trust that certificate once** before it will install. Three steps:

From the [latest Release](https://github.com/sypnose-cloud/registry/releases) download **all three** files:
`SypnoseRegistry_2.0.0_x64.msix`, `SypnoseRegistry.cer`, `SypnoseRegistry_2.0.0_x64.msix.sha256`.

**1. Verify the download** (optional but recommended):

```powershell
Get-FileHash .\SypnoseRegistry_2.0.0_x64.msix -Algorithm SHA256
# Compare the hash against the contents of SypnoseRegistry_2.0.0_x64.msix.sha256
```

**2. Trust the signing certificate** (one time, run PowerShell **as Administrator**):

```powershell
Import-Certificate -FilePath .\SypnoseRegistry.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
```

**3. Install the app:**

```powershell
Add-AppxPackage .\SypnoseRegistry_2.0.0_x64.msix
```

…or just double-click the `.msix` and click **Install**.

> The certificate's publisher is `CN=20D5B5BC-82B1-4ABC-A891-8833937F9AF4` and must match the MSIX's `Publisher`. If the versions mismatch, the install will complain — download both from the same Release.

### Option C — Plain installer (no certificate, no MSIX)

If you'd rather not deal with the certificate, the same Release also ships a standard Windows installer:

```
Sypnose Registry_2.0.0_x64-setup.exe    (NSIS, per-user install)
```

Double-click it and follow the wizard. This is the easiest path for a first look; the MSIX is the path to the Microsoft Store.

---

## Getting started

1. Launch **Sypnose Registry**.
2. On the Welcome screen click **Open Folder** (or pick one under **Recent Projects**).
3. The app indexes the folder — you'll see **"Scanning N of M files"** the first time. When it finishes, the interactive graph appears. Zoom/pan with the mouse; click a node to see its details.

That's it — the three features below are always on from here.

---

## The three features

### 🟢 Live graph (watcher)

A **Live** indicator sits in the middle of the status bar (bottom of the window):

- **`Live`** (red, pulsing) — the watcher is on and tracking the current folder.
- **`Live off`** — no folder open / watcher paused.

Edit, create, or delete files in the open folder — from your editor, a script, or an AI agent — and the graph **re-indexes itself within a couple of seconds**. Existing nodes keep their positions (they don't jump around) thanks to a position cache.

![Watcher live](media/watcher.gif)
<!-- GIF PENDIENTE CARLOS: open a repo, edit a file in another window, show the graph updating live within ~2s. -->

### 🕑 Time-travel (history slider)

Once the folder has been scanned more than once, a **time slider** appears just under the status bar:

- A badge reads **`PRESENTE`** (present) or **`HISTÓRICO`** (historical).
- Drag the thumb to a **past scan** → the app reconstructs the graph exactly as the folder was at that moment.
- Changes are **color-coded**: <span>+ added (green)</span>, <span>~ modified (amber)</span>, <span>− removed (red)</span>.
- Click **`HOY`** (today) to jump back to the present and re-arm the live watcher.

![Time-travel](media/timeslider.gif)
<!-- GIF PENDIENTE CARLOS: drag the slider across a few scans, show added/modified/removed counts + the graph changing, then click HOY. -->

> Note: a few controls (`PRESENTE` / `HISTÓRICO` / `HOY`) are currently in Spanish. English labels are planned for a later release; the behavior is exactly as described above.

### 💬 Chat with the graph (Ask Claude)

A right-hand panel titled **Ask Claude** (toggle it from the toolbar) lets you ask questions about the open folder in plain language. Answers **cite the entities they reference** — click a citation and the graph centers that node.

**This feature needs your own Anthropic API key** (the rest of the app does not):

1. On first use the chat shows: _"No Anthropic API key configured. Open Settings (gear icon) and paste your key to use chat."_
2. Open **Settings (⚙)** → field **Anthropic API key** (placeholder `sk-ant-...`) → **Save key**.
3. Your key is stored **locally** in `~/.registry-app/settings.json` — it is never sent anywhere except Anthropic's API, and never committed to git.

The chat calls `https://api.anthropic.com/v1/messages` (model `claude-sonnet-4-5`), so it needs an internet connection. Without a key the app doesn't crash — chat simply tells you to add one. Get a key at <https://console.anthropic.com>.

![Chat](media/chat.gif)
<!-- GIF PENDIENTE CARLOS: ask "what does this project do?" on a real repo; show a cited answer + clicking a citation centering a node. -->

### ➕ Bonus — Export digest (for NotebookLM / Drive)

The toolbar has an **Export digest** button that writes a Markdown summary of the folder (structure, recent changes with dates, top files) — drop it into Google Drive and NotebookLM will index it, or paste it anywhere you like.

---

## What needs what (requirements at a glance)

| Feature | Needs internet? | Needs Anthropic key? | Notes |
|---|---|---|---|
| Open folder + graph | No | No | Fully local |
| Live watcher | No | No | Fully local |
| Time-travel | No | No | Snapshots stored locally (SQLite) |
| **Chat (Ask Claude)** | **Yes** | **Yes (your own)** | Key stored in `~/.registry-app/settings.json` |
| AI Bridge (`:44444`) | Local only | No | Lets other local AI agents query the graph — see below |

### AI Bridge — let other agents read the graph

The app exposes a small local HTTP server on **`localhost:44444`** so other AI tools/agents on your machine can query the current graph:

```
GET /status        GET /graph        GET /search?q=<term>
GET /architecture  GET /highlight
```

This is off the network (localhost only) and requires no key.

---

MIT. Not affiliated with Anthropic. Built as part of [Sypnose](https://github.com/sypnose-cloud).

---
---

# 🐧 Server registry (Linux)

A **live, self-updating registry of an entire server**: what services and containers
are running, what ports are open, every git repo present — and a classification of
each project (saas / api / bot / worker / scraper / web / cli / library / app) plus
the code graph of each repo (which API route touches which DB table). Served over HTTP,
refreshed automatically every 15 minutes. For humans and AI agents.

Point it at a server. One command. No manual catalog files.

## What it does

Tells you **what's on your server** (how many services, containers, repos) and
**classifies each project** — if there's a SaaS it says `saas`, if there's a trading bot
it says `bot` + `trading`, etc — **plus the code graph of each repo** (which API touches
which DB table). For humans (a dashboard) and AI agents (an HTTP API + the `/registry` skill).

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

## Requirements (auto-installed)

The installer **auto-installs every dependency** on a clean server — `node`, `python3`,
`jq`, `git`, `build-essential` (for native modules), and `uv` / `graphify` / `trace-mcp` —
across any distro (`apt` / `dnf` / `yum` / `apk` / `pacman`). The only real prerequisites are:

- **`curl`** (used for the health-check and to fetch the toolchain)
- **`sudo` (or running as root)** — needed once to install the system packages
- **internet access**

That's it. On a box where everything is already present, the installer detects each tool
with `command -v` and skips it (idempotent).

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

## Uninstall

```bash
systemctl --user disable --now registry-api.service registry-refresh.timer
rm -rf ~/.registry ~/.registry-data ~/.config/systemd/user/registry-*.{service,timer}
systemctl --user daemon-reload
```

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
