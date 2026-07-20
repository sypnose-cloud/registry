# Sypnose Registry

**Open any folder → an interactive knowledge graph of everything inside. Live, time-travel, and chat with it.**

This repo ships **two things** that share the same idea (a self-updating map of your code):

| I want to… | Use | Section |
|---|---|---|
| **Explore a folder/repo on my desktop** — see it as a graph, watch it update live, scrub its history, ask an AI about it | **Sypnose Registry (desktop app, Windows)** | [↓ Desktop app](#-desktop-app-windows) |
| **Map an entire Linux server** — every project, every function, cross-project topology (who calls who), dashboard + JSON API | **Registry server (Linux, `curl \| bash`)** | [↓ Server registry](#-server-registry-linux) |

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

> _Store link: **PENDIENTE CARLOS** (submit `v2.2.1` to Partner Center)._

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
---

# 🐧 Server registry (Linux)

Map **every project, every file, every function, and every connection** on your server. One command.

Click on a project, see its files. Inside each file, see its functions. Those functions connect to other projects, workers connect to dispatchers, dispatchers connect to LLM APIs — the **entire chain**, mapped live.

## Install — one command

```bash
curl -fsSL https://registry.sypnose.cloud/install.sh | bash
```

That's it. The installer:
1. Installs Node.js 20+ if missing
2. Auto-discovers every project on your server (package.json, Cargo.toml, pyproject.toml, go.mod, .git)
3. Indexes all code into per-project SQLite databases
4. Detects cross-project connections and external service dependencies
5. Starts an API server + dashboard on port 7009
6. Sets up auto-refresh every 15 minutes via systemd

Works on Ubuntu 20+/22+/24+, Debian 11+. Idempotent — safe to run multiple times.

## What you get

### Dashboard (port 7009)

5-tab HTML dashboard, zero dependencies, dark devops theme:

| Tab | What it shows |
|-----|--------------|
| **Projects** | Card grid — every project with file/symbol/edge/route counts |
| **Services** | Table view — systemd services, ports, Docker containers |
| **CodeGraph** | 3-pane browser — files, symbols, relationships |
| **Topology Map** | SVG Sankey diagram — projects connected by Bezier curves, external services on the right |
| **Gaps** | What's missing — unindexed dirs, disconnected services |

### API

All data available as JSON:

```bash
# List all indexed projects
curl http://localhost:7009/multi/projects

# Cross-project topology (who calls who)
curl http://localhost:7009/multi/topology

# Search any symbol across all projects
curl http://localhost:7009/multi/search?q=dispatch

# Deep drill-down: files → functions → calls → externals
curl http://localhost:7009/multi/deep/my-project

# File-level: every function in a file + what it calls
curl http://localhost:7009/multi/deep/my-project/src/main.rs
```

### Auto-refresh

A systemd timer re-scans every 15 minutes. New files, new functions, new connections appear automatically.

```bash
# Check timer status
systemctl --user list-timers registry-refresh.timer

# Force a re-scan now
systemctl --user start registry-refresh.service

# View API logs
journalctl --user -u registry-api -f
```

## How it works

```
Your Server
  │
  ├── Project A (Node.js)     ─┐
  ├── Project B (Python)       ├── trace-mcp indexes each ──► SQLite DBs
  ├── Project C (Rust)         │                               │
  └── Project D (Go)          ─┘                               │
                                                               ▼
                                                    topology-builder detects
                                                    cross-project edges
                                                               │
                                                               ▼
                                                    backstage-api serves
                                                    dashboard + JSON API
```

**trace-mcp** (the code intelligence engine) parses each project and extracts:
- Files and their languages
- Symbols (functions, classes, methods, variables, constants)
- Edges (calls, imports, references, route definitions, DB queries)
- Routes (API endpoints with handlers)
- Environment variables

**topology-builder** then detects:
- Cross-project symbol references (Project A calls a function defined in Project B)
- External service dependencies (from env vars matching known patterns: OpenAI, Cloudflare, Supabase, etc.)

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `REGISTRY_PORT` | `7009` | Port for the API + dashboard |
| `REGISTRY_DATA` | `~/.registry-data` | Where scan results and topology are stored |

---

MIT. (c) 2026 Sypnose Cloud. Not affiliated with Anthropic. Built as part of [Sypnose](https://github.com/sypnose-cloud).
