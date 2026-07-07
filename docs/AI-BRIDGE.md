# Connect your AI to Sypnose Registry

Sypnose Registry runs a local **AI Bridge** on `http://127.0.0.1:44444` whenever the
app is open. Any AI agent on your machine — Claude Code, a ChatGPT plugin, a local
LLM, your own scripts — can query the live map of the folder you have open, its
**temporal memory** (what changed and when), and even **highlight nodes on your
screen**. No API key, no account: it binds to localhost only.

> Your AI keeps using whatever LLM subscription it already has (directly or through
> a proxy like CLIProxy). The Bridge only serves *your project's map* to it.

## Quick start (any agent that can run curl)

```bash
curl http://127.0.0.1:44444/status        # is Registry open? which project?
curl http://127.0.0.1:44444/architecture  # one-shot project summary (start here)
curl "http://127.0.0.1:44444/search?q=payment"
curl http://127.0.0.1:44444/timeline      # temporal memory: every recorded scan
```

## Endpoints

| Method | Path | What it returns |
|---|---|---|
| GET | `/` | This endpoint index (self-describing) |
| GET | `/status` | Whether a project is loaded + name, path, node/edge counts |
| GET | `/graph` | Full graph JSON (nodes, edges, communities) |
| GET | `/nodes` · `/edges` | Just the nodes / just the edges |
| GET | `/architecture` | Compact summary: types, languages, lines, top hubs — ideal first call for an LLM |
| GET | `/search?q=term` | Find nodes by label/path/id (max 50) |
| GET | `/node/:id` | One node + its incoming/outgoing connections |
| GET | `/timeline` | **Temporal memory**: all recorded scans (id, timestamp, added/modified/removed counts) |
| GET | `/changes/:scan_id` | The change events of one scan — *what exactly changed* |
| GET | `/snapshot/:scan_id` | The full graph **as it was** at that scan (time travel) |
| POST | `/highlight` | Highlight a node in the UI — it lights up on the graph within ~1.5s (your color, or amber) with its label forced visible. Body: `{"node_id":"file:src/main.rs","color":"#ff6b00","label":"look here"}` |
| GET | `/highlights` | Current highlights |
| POST | `/clear-highlights` | Clear them |

## Recipe: give Claude Code eyes on your project

Tell your agent (or put in your CLAUDE.md):

> Before exploring files in this folder, query the Registry AI Bridge:
> `curl http://127.0.0.1:44444/architecture` for the map,
> `curl http://127.0.0.1:44444/timeline` for what changed recently, and
> `POST /highlight` to show the user which node you are working on.

The agent gets grounded orientation in one call instead of reading files blindly —
and with `/timeline` + `/changes/:id` it can answer *"what did we touch this week?"*
from the recorded history (the app records a scan on every index, live-watch included).

## Notes for agent builders

- Everything is read-only except highlights. The Bridge cannot modify your files.
- Data freshness: with Live watch ON, the graph re-indexes ~2s after any file change.
- The graph served is the one for the folder currently OPEN in the app.
- CORS is open (`*`) but the server binds to `127.0.0.1` — local agents only.
- C# projects: since v2.1 the indexer extracts C# classes/methods/usings too.
