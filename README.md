# Sypnose Registry

A **live, self-updating registry** of your codebase: every API route, every database table,
which API touches which table, which frontend page calls which endpoint — served over HTTP,
refreshed automatically every 15 minutes. For humans and AI agents.

Point it at any repo. One command. No manual catalog files.

---

## Install — one command

**Linux / Mac:**
```bash
curl -fsSL https://raw.githubusercontent.com/sypnose-cloud/registry/main/install.sh | bash -s -- --repo /path/to/your/repo
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/sypnose-cloud/registry/main/install.ps1 | iex
# then it prompts for your repo path
```

`--repo` is the codebase you want indexed. The registry installs trace-mcp (code-graph indexer),
optionally graphify, copies the API server, indexes your repo, and starts a service on `:7008`
plus a 15-minute refresh timer.

---

## What you get

| Endpoint | What it returns |
|----------|-----------------|
| `GET /health` | status + service count |
| `GET /codegraph/summary` | files, symbols, edges, relation types |
| `GET /codegraph/routes` | all API route handlers detected |
| `GET /codegraph/routes-with-tables` | which API route touches which DB table |
| `GET /supabase/summary` | DB tables, foreign keys (if Supabase/Postgres configured) |
| `GET /fleet/*` | host/container inventory (only if `FLEET_URL` is set) |

Plus a `frontend-api-map.json` mapping each page to the API endpoints it calls.

---

## How it works

```
[15-min timer]
   -> trace-mcp index <repo>      (rebuilds the code graph -> SQLite)
   -> graphify update <repo>      (refreshes the visual graph)
   -> build-frontend-api-map.mjs  (maps page -> endpoints)
[registry-api :7008]  reads that graph (read-only) and serves it over HTTP — always live.
```

It is **self-updating**: edit your code, and within 15 minutes the registry reflects it.
No manual YAML, no manual catalog.

---

## Configuration (all optional, env vars)

| Var | Default | Meaning |
|-----|---------|---------|
| `REGISTRY_REPO` | (required) | Repo to index |
| `REGISTRY_PORT` | `7008` | HTTP port |
| `REGISTRY_BIND` | `0.0.0.0` | Bind address |
| `FLEET_URL` | (unset) | Enable host-fleet inventory (osquery/Fleet). Off by default. |

No secrets in this repo. Anything sensitive (Fleet creds, DB URL) is supplied via env at install time.

---

## Requirements

- Node.js 18+, npm, git
- (optional) `uv` for graphify
- A repo to index

---

## Uninstall

```bash
systemctl --user disable --now registry-api.service registry-refresh.timer
rm -rf ~/.registry ~/.config/systemd/user/registry-*.{service,timer}
systemctl --user daemon-reload
```

---

## Limitations (honest)

- **API -> DB** mapping captures direct `.from('table')` calls in the handler. Routes that
  query through helper functions may need the optional `build-api-bd-helpers-map.mjs` pass.
- **Fleet** integration is off unless you set `FLEET_URL` to a running Fleet/osquery server.
- Designed for Next.js / Supabase stacks first; the code-graph (trace-mcp) supports more, but
  the `routes-with-tables` mapping is tuned for that stack.

---

MIT. Not affiliated with Anthropic. Built as part of [Sypnose](https://github.com/sypnose-cloud).
