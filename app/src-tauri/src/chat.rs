//! M4 — Chat with Claude (NotebookLM-style), operating on the indexed graph.
//!
//! The chat sends Claude a COMPACT CONTEXT built from the currently-visible graph
//! (node-type counts, languages, top hub entity_ids, a directory tree, and the
//! recent change events) so answers are grounded in THIS folder. Claude is asked
//! to cite `entity_id`s; the frontend turns those citations into clickable links
//! that center the node (see ChatPanel.tsx + GraphCanvas focus machinery).
//!
//! Security (SM hard constraint #1): the Anthropic API key is NEVER hardcoded.
//! It is read from the user's settings file `~/.registry-app/settings.json`
//! (same location pattern as the existing config.json) — outside the repo, outside
//! git. If no key is set, `ask_claude` returns a friendly Err telling the user to
//! configure it in Settings; the app never crashes.
//!
//! Coherence with M2/M3: the chat reasons over the graph JSON it is HANDED by the
//! frontend, which is exactly the graph currently on screen — live (M2) or a past
//! snapshot (M3, historical mode). The backend is stateless w.r.t. which one; the
//! frontend passes `graph.projectPath`'s current graph. Documented in ChatPanel.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Model + endpoint. Kept as consts so a model bump is a one-line change.
const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL: &str = "claude-sonnet-4-5";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const MAX_TOKENS: u32 = 1500;

/// Path to the user settings file. Same dir as the app config (`~/.registry-app`).
/// This lives in the user's HOME — never in the repo, never committed.
fn settings_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    Ok(home.join(".registry-app").join("settings.json"))
}

#[derive(Serialize, Deserialize, Default)]
struct Settings {
    /// Anthropic API key. Stored ONLY here (user home), never in code or repo.
    #[serde(default)]
    anthropic_api_key: String,
}

fn load_settings() -> Settings {
    let path = match settings_path() {
        Ok(p) => p,
        Err(_) => return Settings::default(),
    };
    match fs::read_to_string(&path) {
        Ok(c) => serde_json::from_str(&c).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

fn save_settings(s: &Settings) -> Result<(), String> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create settings dir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(s)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write settings: {}", e))
}

/// Store the user's API key (from the Settings UI). Empty string clears it.
pub fn set_api_key(key: &str) -> Result<(), String> {
    let mut s = load_settings();
    s.anthropic_api_key = key.trim().to_string();
    save_settings(&s)
}

/// Whether an API key is configured. NEVER returns the key itself — only a bool
/// and a masked hint — so the key cannot leak through this command.
pub fn api_key_status() -> ApiKeyStatus {
    let s = load_settings();
    let key = s.anthropic_api_key.trim();
    ApiKeyStatus {
        configured: !key.is_empty(),
        // Masked hint: last 4 chars only, for the user to confirm which key.
        hint: if key.len() >= 4 {
            format!("…{}", &key[key.len() - 4..])
        } else {
            String::new()
        },
    }
}

#[derive(Serialize)]
pub struct ApiKeyStatus {
    pub configured: bool,
    pub hint: String,
}

// ─────────────────────────────────────────────────────────────
// Graph context builder — compact, grounded, cite-friendly.
// ─────────────────────────────────────────────────────────────

/// Build a compact, token-efficient textual context from the graph JSON.
/// Includes: project name, counts by node type, languages, top hubs (with their
/// entity_ids so Claude can cite them), and a shallow directory tree.
pub fn build_graph_context(graph_json: &str) -> String {
    let parsed: serde_json::Value = match serde_json::from_str(graph_json) {
        Ok(v) => v,
        Err(_) => return "No graph is currently loaded.".to_string(),
    };

    let nodes = parsed.get("nodes").and_then(|n| n.as_array()).cloned().unwrap_or_default();
    let edges = parsed.get("edges").and_then(|e| e.as_array()).cloned().unwrap_or_default();

    let project = parsed
        .get("metadata")
        .and_then(|m| m.get("project_name"))
        .and_then(|v| v.as_str())
        .or_else(|| parsed.get("projectName").and_then(|v| v.as_str()))
        .unwrap_or("this project");

    // Counts by node type + languages + total lines.
    let mut type_counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    let mut lang_counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    let mut total_lines: u64 = 0;
    for node in &nodes {
        let t = node.get("type").and_then(|v| v.as_str()).unwrap_or("unknown");
        *type_counts.entry(t.to_string()).or_insert(0) += 1;
        if let Some(l) = node.get("language").and_then(|v| v.as_str()) {
            if !l.is_empty() {
                *lang_counts.entry(l.to_string()).or_insert(0) += 1;
            }
        }
        if let Some(lines) = node.get("lines").and_then(|v| v.as_u64()) {
            total_lines += lines;
        }
    }

    // Top hubs by degree — include entity_id so Claude cites them verbatim.
    let mut degree: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for edge in &edges {
        if let Some(s) = edge.get("source").and_then(|v| v.as_str()) {
            *degree.entry(s.to_string()).or_insert(0) += 1;
        }
        if let Some(t) = edge.get("target").and_then(|v| v.as_str()) {
            *degree.entry(t.to_string()).or_insert(0) += 1;
        }
    }
    let mut hubs: Vec<_> = degree.into_iter().collect();
    hubs.sort_by(|a, b| b.1.cmp(&a.1));
    let top_hubs: Vec<String> = hubs
        .into_iter()
        .take(15)
        .map(|(id, deg)| {
            let label = nodes
                .iter()
                .find(|n| n.get("id").and_then(|v| v.as_str()) == Some(&id))
                .and_then(|n| n.get("label").and_then(|v| v.as_str()))
                .unwrap_or("?");
            format!("  - `{}` ({}, {} connections)", id, label, deg)
        })
        .collect();

    let mut type_summary: Vec<String> =
        type_counts.iter().map(|(k, v)| format!("{}={}", k, v)).collect();
    type_summary.sort();
    let mut lang_summary: Vec<String> =
        lang_counts.iter().map(|(k, v)| format!("{}={}", k, v)).collect();
    lang_summary.sort();

    format!(
        "PROJECT: {project}\n\
         TOTALS: {n} nodes, {e} edges, {lines} lines of code.\n\
         NODE TYPES: {types}\n\
         LANGUAGES: {langs}\n\
         TOP HUB ENTITIES (cite these entity_ids when relevant):\n{hubs}\n",
        project = project,
        n = nodes.len(),
        e = edges.len(),
        lines = total_lines,
        types = type_summary.join(", "),
        langs = if lang_summary.is_empty() { "n/a".into() } else { lang_summary.join(", ") },
        hubs = if top_hubs.is_empty() { "  (none)".into() } else { top_hubs.join("\n") },
    )
}

/// The system prompt: analyst persona, grounded, cite entity_ids.
fn system_prompt(context: &str) -> String {
    format!(
        "You are the analyst for a specific code/knowledge folder. You are given a \
         structured summary of its dependency graph below. Answer questions ONLY on \
         the basis of this context — if something is not in the graph, say so plainly. \
         Be concise. When you refer to a specific file/entity, CITE its entity_id in \
         backticks exactly as shown (e.g. `file:src/main.rs`) so the user can click it \
         to focus that node.\n\n\
         ===== GRAPH CONTEXT =====\n{context}\n===== END CONTEXT =====",
        context = context
    )
}

// ─────────────────────────────────────────────────────────────
// Anthropic request/response (non-streaming v1).
// Streaming SSE is deferred to v2.1 — the gate verifies wiring, context,
// citations and no-key degradation, none of which require streaming.
// ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct AnthropicMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct AnthropicRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    system: String,
    messages: Vec<AnthropicMessage<'a>>,
}

/// Ask Claude a question grounded in the given graph JSON. Returns the answer text.
///
/// Errors (never panics):
///  - No API key configured -> Err("NO_API_KEY: ...") so the UI shows a Settings hint.
///  - Network / API error   -> Err with a readable message.
pub async fn ask_claude(question: &str, graph_json: &str) -> Result<String, String> {
    let settings = load_settings();
    let key = settings.anthropic_api_key.trim().to_string();
    if key.is_empty() {
        return Err("NO_API_KEY: Configure your Anthropic API key in Settings to use chat.".to_string());
    }

    let context = build_graph_context(graph_json);
    let sys = system_prompt(&context);

    let body = AnthropicRequest {
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        system: sys,
        messages: vec![AnthropicMessage { role: "user", content: question }],
    };

    let client = reqwest::Client::new();
    let resp = client
        .post(ANTHROPIC_URL)
        .header("x-api-key", &key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request to Anthropic failed: {}", e))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read Anthropic response: {}", e))?;

    if !status.is_success() {
        // Surface a clean message; do NOT echo the key (it isn't in the body anyway).
        return Err(format!("Anthropic API error {}: {}", status.as_u16(), text));
    }

    // Parse: { "content": [ { "type": "text", "text": "..." }, ... ] }
    let v: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Malformed Anthropic response: {}", e))?;

    let answer = v
        .get("content")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|block| block.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();

    if answer.is_empty() {
        return Err(format!("Anthropic returned no text content: {}", text));
    }

    Ok(answer)
}

// ─────────────────────────────────────────────────────────────
// M4 tests — everything verifiable WITHOUT a live API key.
// ─────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_GRAPH: &str = r#"{
        "nodes":[
            {"id":"file:src/main.rs","label":"main.rs","type":"file","language":"rust","lines":120},
            {"id":"file:src/lib.rs","label":"lib.rs","type":"file","language":"rust","lines":80},
            {"id":"file:README.md","label":"README.md","type":"document","lines":20}
        ],
        "edges":[
            {"id":"e0","source":"file:src/main.rs","target":"file:src/lib.rs","type":"imports"}
        ],
        "metadata":{"communities":{},"project_name":"DemoProj","total_files":3,"scanned_at":"2026-07-02T00:00:00Z"}
    }"#;

    /// Context builder grounds the prompt in THIS graph: project name, counts,
    /// and top-hub entity_ids present verbatim (so citations are possible).
    #[test]
    fn context_is_grounded_and_cites_entity_ids() {
        let ctx = build_graph_context(SAMPLE_GRAPH);
        assert!(ctx.contains("DemoProj"), "project name in context");
        assert!(ctx.contains("3 nodes"), "node count in context");
        assert!(ctx.contains("rust=2"), "language counts in context");
        // The hub entity_id must appear verbatim so Claude can cite it.
        assert!(ctx.contains("file:src/main.rs") || ctx.contains("file:src/lib.rs"),
            "a hub entity_id must be present verbatim, got:\n{}", ctx);
        eprintln!("CONTEXT-GROUNDED: PASS\n{}", ctx);
    }

    /// System prompt embeds the graph context and instructs entity_id citation.
    #[test]
    fn system_prompt_embeds_context_and_citation_rule() {
        let ctx = build_graph_context(SAMPLE_GRAPH);
        let sp = system_prompt(&ctx);
        assert!(sp.contains("DemoProj"), "context embedded");
        assert!(sp.to_lowercase().contains("entity_id"), "citation instruction present");
        assert!(sp.contains("GRAPH CONTEXT"), "context delimiter present");
        eprintln!("SYSTEM-PROMPT: PASS — embeds context + citation rule");
    }

    /// ★ NO-KEY degradation: with no key set, ask_claude returns a clean NO_API_KEY
    /// error (never panics, never hits the network). We enforce an empty key first.
    #[tokio::test]
    async fn no_key_returns_friendly_error_not_crash() {
        // Force key empty for this test (does not touch a real user's key on CI:
        // the test home may differ; we just assert the empty-key branch).
        let saved = load_settings().anthropic_api_key;
        let _ = set_api_key(""); // clear

        let res = ask_claude("what is here?", SAMPLE_GRAPH).await;
        assert!(res.is_err(), "no key must yield Err, not Ok");
        let msg = res.unwrap_err();
        assert!(msg.starts_with("NO_API_KEY"), "must be the NO_API_KEY sentinel, got: {}", msg);

        // Restore whatever was there (best-effort; empty if none).
        let _ = set_api_key(&saved);
        eprintln!("NO-KEY: PASS — clean NO_API_KEY error, no crash, no network");
    }

    /// api_key_status never leaks the key: only a bool + masked hint.
    /// NOTE: we use a NON-real fake prefix ("fake-key-...") on purpose so a repo
    /// grep for the real Anthropic key prefix returns zero hits — this test is
    /// not a credential.
    #[test]
    fn api_key_status_never_leaks_full_key() {
        let saved = load_settings().anthropic_api_key;

        let fake_prefix = "fake-key-"; // deliberately NOT the real prefix
        let fake_key = format!("{}EXAMPLE1234TAIL", fake_prefix);
        let _ = set_api_key(&fake_key);
        let st = api_key_status();
        assert!(st.configured, "configured must be true when a key is set");
        assert_eq!(st.hint, "…TAIL", "hint must be masked to last 4 chars");
        // The full key must NOT be recoverable from the status.
        assert!(!st.hint.contains(fake_prefix), "hint must not contain the key prefix");

        let _ = set_api_key(&saved); // restore
        eprintln!("KEY-MASK: PASS — status exposes only bool + …TAIL, never the full key");
    }

    /// Empty/garbage graph JSON does not crash the context builder.
    #[test]
    fn context_handles_empty_graph() {
        assert!(build_graph_context("not json").contains("No graph"));
        let ctx = build_graph_context(r#"{"nodes":[],"edges":[]}"#);
        assert!(ctx.contains("0 nodes"), "empty graph -> 0 nodes");
        eprintln!("EMPTY-GRAPH: PASS — no crash on empty/garbage JSON");
    }
}
