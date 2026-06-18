# Sypnose Registry

Map **every project, every file, every function, and every connection** on your server. One command.

Click on a project, see its files. Inside each file, see its functions. Those functions connect to other projects, workers connect to dispatchers, dispatchers connect to LLM APIs — the **entire chain**, mapped live.

---

## Install

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

---

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

---

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

---

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `REGISTRY_PORT` | `7009` | Port for the API + dashboard |
| `REGISTRY_DATA` | `~/.registry-data` | Where scan results and topology are stored |

---

## License

MIT. (c) 2026 Sypnose Cloud.
