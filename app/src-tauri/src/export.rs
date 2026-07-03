//! M5 — Export Digest (NotebookLM mirror, Vía A / official path).
//!
//! Generates a human-readable, DETERMINISTIC Markdown summary of the currently
//! visible graph so Carlos can drop it into a folder synced with Google Drive;
//! NotebookLM then auto-indexes it. No unofficial APIs are used on this path.
//!
//! Sections of the digest (all sourced from data that ALREADY exists in the app):
//!   1. Title / project + totals (project_name, nodes/edges/lines) — from the graph JSON.
//!   2. Structure by node type and by language, WITH counts — from the graph JSON.
//!   3. Recent changes WITH DATES — from `history::list_scans` (each scan is a dated
//!      row with added/removed/modified counters) plus `history::get_changes` for the
//!      most recent scans (per-file added/modified/removed, dated by their parent scan).
//!   4. Top hub files — degree ranking over the graph edges.
//!
//! DESIGN / §11 notes (reported to the SM):
//!   - The digest body is built by a PURE function `build_digest(...)` that takes the
//!     graph JSON + already-fetched scan/change data. This makes it byte-deterministic
//!     and unit-testable WITHOUT touching disk, a live API, or `Utc::now()`. The IO
//!     wrapper `write_digest(...)` fetches history and writes the file.
//!   - Hub/degree logic is intentionally recomputed here (a few lines) rather than
//!     reaching into `ai_bridge.rs`, where the equivalent code is embedded inside the
//!     HTTP handler closure and is NOT a reusable function. Recomputing keeps M5
//!     self-contained and avoids a risky refactor of the live-server code path.
//!   - `change_events` carry NO timestamp of their own (confirmed in history.rs): a
//!     change's date is its parent scan's `ts`. We JOIN in memory: for each recent
//!     scan we label its events with that scan's `ts`.
//!   - Compact mode (>5000 files → one node per directory, id "dir:...") is tolerated:
//!     we read whatever nodes/types/languages are present; no assumption of per-file nodes.
//!   - Destination default is OUTSIDE the scanned folder (`~/RegistryDigests/`) so the
//!     written .md never falls inside the watcher and triggers a re-index. `graphify-out/`
//!     is deliberately NOT used (it is internal generated data / gitignored).
//!
//! Vía B (teng-lin/notebooklm-py) is left as an EXPERIMENTAL STUB (`notebooklm_status`)
//! that only reports whether the CLI is installed. It is NEVER invoked automatically and
//! uses unofficial Google APIs — off by default, surfaced as a disabled hint in the UI.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::history;

/// How many of the most-recent scans to expand into per-file change detail.
/// Older scans still appear as dated summary rows in the "history" table.
const RECENT_CHANGE_SCANS: usize = 3;
/// Cap per-scan change lines so a huge scan does not produce a wall of text.
const MAX_CHANGES_PER_SCAN: usize = 40;
/// How many hub files to list.
const TOP_HUBS: usize = 15;

// ─────────────────────────────────────────────────────────────
// Pure builder — deterministic, no IO, no clock. Unit-tested.
// ─────────────────────────────────────────────────────────────

/// One dated scan plus (optionally) its expanded per-entity changes.
/// `changes` is empty for scans we only summarize (older than RECENT_CHANGE_SCANS).
pub struct ScanWithChanges {
    pub summary: history::ScanSummary,
    pub changes: Vec<history::ChangeEvent>,
}

/// Build the Markdown digest. PURE: given the graph JSON and the already-fetched
/// dated scan history, returns the exact Markdown string. The only "now" it embeds
/// is the value passed in `generated_at` (caller supplies it) so tests are stable.
pub fn build_digest(graph_json: &str, generated_at: &str, history: &[ScanWithChanges]) -> String {
    let parsed: Value = serde_json::from_str(graph_json).unwrap_or(Value::Null);

    let nodes = parsed
        .get("nodes")
        .and_then(|n| n.as_array())
        .cloned()
        .unwrap_or_default();
    let edges = parsed
        .get("edges")
        .and_then(|e| e.as_array())
        .cloned()
        .unwrap_or_default();

    let project = parsed
        .get("metadata")
        .and_then(|m| m.get("project_name"))
        .and_then(|v| v.as_str())
        .or_else(|| parsed.get("projectName").and_then(|v| v.as_str()))
        .unwrap_or("this project");

    let scanned_at = parsed
        .get("metadata")
        .and_then(|m| m.get("scanned_at"))
        .and_then(|v| v.as_str())
        .or_else(|| parsed.get("scannedAt").and_then(|v| v.as_str()))
        .unwrap_or("unknown");

    // ── Structure: counts by node type + by language + total lines ──
    let mut type_counts: std::collections::BTreeMap<String, u64> = std::collections::BTreeMap::new();
    let mut lang_counts: std::collections::BTreeMap<String, u64> = std::collections::BTreeMap::new();
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

    // ── Hubs: total (undirected) degree over edges, resolve labels ──
    let mut degree: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    for edge in &edges {
        if let Some(s) = edge.get("source").and_then(|v| v.as_str()) {
            *degree.entry(s.to_string()).or_insert(0) += 1;
        }
        if let Some(t) = edge.get("target").and_then(|v| v.as_str()) {
            *degree.entry(t.to_string()).or_insert(0) += 1;
        }
    }
    let mut hubs: Vec<(String, u64)> = degree.into_iter().collect();
    // Deterministic ordering: degree desc, then id asc to break ties.
    hubs.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    hubs.truncate(TOP_HUBS);

    let label_of = |id: &str| -> String {
        nodes
            .iter()
            .find(|n| n.get("id").and_then(|v| v.as_str()) == Some(id))
            .and_then(|n| n.get("label").and_then(|v| v.as_str()))
            .unwrap_or("?")
            .to_string()
    };

    // ── Assemble Markdown ──
    let mut out = String::new();

    out.push_str(&format!("# Registry digest — {}\n\n", project));
    out.push_str(&format!("- **Generated:** {}\n", generated_at));
    out.push_str(&format!("- **Last scan:** {}\n", scanned_at));
    out.push_str(&format!(
        "- **Totals:** {} nodes, {} edges, {} lines of code\n\n",
        nodes.len(),
        edges.len(),
        total_lines
    ));
    out.push_str(
        "> Auto-generated map of this folder for NotebookLM. Deterministic; safe to re-index.\n\n",
    );

    // Section: Structure
    out.push_str("## Structure\n\n");
    out.push_str("### By type\n\n");
    if type_counts.is_empty() {
        out.push_str("_No nodes._\n\n");
    } else {
        for (t, c) in &type_counts {
            out.push_str(&format!("- **{}**: {}\n", t, c));
        }
        out.push('\n');
    }
    out.push_str("### By language\n\n");
    if lang_counts.is_empty() {
        out.push_str("_No language data._\n\n");
    } else {
        for (l, c) in &lang_counts {
            out.push_str(&format!("- **{}**: {}\n", l, c));
        }
        out.push('\n');
    }

    // Section: Recent changes WITH DATES
    out.push_str("## Recent changes\n\n");
    if history.is_empty() {
        out.push_str("_No scan history recorded yet._\n\n");
    } else {
        // Dated summary table (newest first).
        out.push_str("| Date | Added | Removed | Modified | Nodes | Edges |\n");
        out.push_str("|---|---:|---:|---:|---:|---:|\n");
        for h in history {
            let s = &h.summary;
            out.push_str(&format!(
                "| {} | {} | {} | {} | {} | {} |\n",
                s.ts, s.added, s.removed, s.modified, s.node_count, s.edge_count
            ));
        }
        out.push('\n');

        // Per-file detail for the scans that carry expanded changes.
        for h in history {
            if h.changes.is_empty() {
                continue;
            }
            out.push_str(&format!("### Changes on {}\n\n", h.summary.ts));
            // Deterministic order: change_type, then entity_id.
            let mut sorted = h.changes.clone();
            sorted.sort_by(|a, b| {
                a.change_type
                    .cmp(&b.change_type)
                    .then_with(|| a.entity_id.cmp(&b.entity_id))
            });
            for (i, ev) in sorted.iter().enumerate() {
                if i >= MAX_CHANGES_PER_SCAN {
                    out.push_str(&format!(
                        "- _…and {} more_\n",
                        sorted.len() - MAX_CHANGES_PER_SCAN
                    ));
                    break;
                }
                out.push_str(&format!(
                    "- `{}` — {} ({})\n",
                    ev.entity_id, ev.change_type, ev.entity_kind
                ));
            }
            out.push('\n');
        }
    }

    // Section: Top hub files
    out.push_str("## Top files (hubs)\n\n");
    if hubs.is_empty() {
        out.push_str("_No connections._\n\n");
    } else {
        for (id, deg) in &hubs {
            out.push_str(&format!("- `{}` — {} ({} connections)\n", id, label_of(id), deg));
        }
        out.push('\n');
    }

    out.push_str("---\n");
    out.push_str("_Generated by Sypnose Registry · Export digest (M5)._\n");

    out
}

// ─────────────────────────────────────────────────────────────
// IO wrapper — fetch history, resolve destination, write file.
// ─────────────────────────────────────────────────────────────

/// Sanitize a project name into a filesystem-safe slug for the digest filename.
fn slug(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let trimmed = s.trim_matches('-').to_string();
    if trimmed.is_empty() { "project".to_string() } else { trimmed }
}

/// Default destination if the user has not chosen one: `~/RegistryDigests/`.
/// Deliberately OUTSIDE any scanned folder so it never triggers a watcher re-index.
fn default_dest_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    Ok(home.join("RegistryDigests"))
}

/// Gather the recent dated history for the digest: all scans (summary rows) with
/// the most recent `RECENT_CHANGE_SCANS` expanded into per-entity change detail.
fn gather_history(project_path: &Path) -> Vec<ScanWithChanges> {
    // list_scans returns oldest-first; we want newest-first in the digest.
    let mut scans = history::list_scans(project_path).unwrap_or_default();
    scans.reverse();

    scans
        .into_iter()
        .enumerate()
        .map(|(i, summary)| {
            let changes = if i < RECENT_CHANGE_SCANS {
                history::get_changes(project_path, summary.scan_id).unwrap_or_default()
            } else {
                Vec::new()
            };
            ScanWithChanges { summary, changes }
        })
        .collect()
}

/// Write the digest for `project_path` using the given `graph_json` (the graph the
/// UI currently shows — live or a historical snapshot). Destination resolution:
///   1. explicit `dest_dir` argument, else
///   2. the persisted `digest_dir` setting (chat::get_digest_dir), else
///   3. the default `~/RegistryDigests/`.
/// Returns the absolute path of the written .md file.
///
/// Determinism note: the ON-DISK filename embeds the project slug ONLY (no clock),
/// so re-exporting overwrites the SAME file and NotebookLM re-indexes one stable doc.
/// The "Generated" line inside uses the real time (this is IO, not the pure builder).
pub fn write_digest(
    project_path: &str,
    graph_json: &str,
    dest_dir: Option<String>,
) -> Result<String, String> {
    let root = PathBuf::from(project_path);

    // Resolve destination directory.
    let dir: PathBuf = match dest_dir.map(|d| d.trim().to_string()).filter(|d| !d.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => {
            let saved = crate::chat::get_digest_dir();
            let saved = saved.trim();
            if saved.is_empty() {
                default_dest_dir()?
            } else {
                PathBuf::from(saved)
            }
        }
    };

    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create digest directory '{}': {}", dir.display(), e))?;

    // Project name for slug + heading: prefer graph metadata, fall back to folder name.
    let parsed: Value = serde_json::from_str(graph_json).unwrap_or(Value::Null);
    let project_name = parsed
        .get("metadata")
        .and_then(|m| m.get("project_name"))
        .and_then(|v| v.as_str())
        .or_else(|| parsed.get("projectName").and_then(|v| v.as_str()))
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            root.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("project")
                .to_string()
        });

    let history = gather_history(&root);
    let generated_at = chrono::Utc::now().to_rfc3339();
    let md = build_digest(graph_json, &generated_at, &history);

    let filename = format!("registry-digest-{}.md", slug(&project_name));
    let out_path = dir.join(filename);
    fs::write(&out_path, md)
        .map_err(|e| format!("Failed to write digest '{}': {}", out_path.display(), e))?;

    Ok(out_path.to_string_lossy().to_string())
}

// ─────────────────────────────────────────────────────────────
// v2.2 — "NotebookLM in 2 clicks" wizard support.
// ─────────────────────────────────────────────────────────────

/// Return the first existing directory among candidates. Split out (pure over
/// the filesystem probe) so the candidate-ordering logic is unit-testable.
fn first_existing_dir(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|p| p.is_dir())
}

/// Candidate locations where the Google Drive desktop client exposes the local
/// sync folder, most-likely first:
///   - Drive for Desktop mounts a drive letter (G: by default) with a
///     "My Drive"/"Mi unidad" root.
///   - The legacy client synced to %USERPROFILE%\Google Drive.
fn drive_dir_candidates(home: Option<PathBuf>) -> Vec<PathBuf> {
    let mut cands = Vec::new();
    for letter in ["G", "H", "I", "J", "K", "D", "E", "F"] {
        for name in ["My Drive", "Mi unidad"] {
            cands.push(PathBuf::from(format!("{}:\\{}", letter, name)));
        }
    }
    if let Some(h) = home {
        for name in ["Google Drive", "My Drive", "Mi unidad"] {
            cands.push(h.join(name));
        }
    }
    cands
}

/// Auto-detect the user's Google Drive sync folder ("" if not found). The wizard
/// shows this pre-selected so connecting NotebookLM is one click; if not found,
/// the UI falls back to the folder picker.
pub fn detect_drive_dir() -> Option<String> {
    first_existing_dir(drive_dir_candidates(dirs::home_dir()))
        .map(|p| p.to_string_lossy().to_string())
}

// ─────────────────────────────────────────────────────────────
// Vía B — EXPERIMENTAL stub (unofficial Google APIs; OFF by default).
// ─────────────────────────────────────────────────────────────

/// Status of the OPTIONAL teng-lin/notebooklm-py integration (Vía B).
#[derive(serde::Serialize)]
pub struct NotebookLmStatus {
    /// Whether the `notebooklm-py` CLI appears to be installed on PATH.
    pub cli_available: bool,
    /// Always true: this path uses UNOFFICIAL Google APIs and is experimental.
    pub experimental: bool,
    /// Human hint for the UI.
    pub note: String,
}

/// EXPERIMENTAL / Vía B: report whether the optional `notebooklm-py` CLI is present.
/// This DOES NOT upload anything — it only probes for the tool. Direct upload via
/// this CLI relies on UNOFFICIAL Google APIs and must remain opt-in and off by
/// default. The supported path is Vía A (write to a Drive-synced folder).
pub fn notebooklm_status() -> NotebookLmStatus {
    // Probe without side effects. `--version` is a read-only query on the CLI.
    let cli_available = std::process::Command::new("notebooklm-py")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    NotebookLmStatus {
        cli_available,
        experimental: true,
        note: "EXPERIMENTAL (unofficial Google APIs). Use Vía A: export to a Drive-synced folder.".to_string(),
    }
}

#[cfg(test)]
mod wizard_tests {
    use super::*;

    #[test]
    fn drive_candidates_prefer_g_my_drive_then_home() {
        let home = PathBuf::from(if cfg!(windows) { r"C:\Users\x" } else { "/home/x" });
        let cands = drive_dir_candidates(Some(home.clone()));
        // G:\My Drive is the single most likely location -> must be first.
        assert_eq!(cands[0], PathBuf::from("G:\\My Drive"));
        // Spanish locale root must be covered.
        assert!(cands.iter().any(|c| c.ends_with("Mi unidad")));
        // Home fallbacks must be present, after the drive letters.
        assert!(cands.iter().any(|c| c == &home.join("Google Drive")));
    }

    #[test]
    fn first_existing_dir_picks_first_present() {
        // Nonexistent everywhere -> None (deterministic, no filesystem assumptions).
        let none = first_existing_dir(vec![
            PathBuf::from("Z:\\definitely\\nope"),
            PathBuf::from("Z:\\also\\nope"),
        ]);
        assert!(none.is_none());
    }
}

// ─────────────────────────────────────────────────────────────
// Tests — verify the digest is deterministic and has all sections.
// ─────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::{ChangeEvent, ScanSummary};

    const SAMPLE_GRAPH: &str = r#"{
        "nodes":[
            {"id":"file:src/main.rs","label":"main.rs","type":"file","language":"rust","lines":120},
            {"id":"file:src/lib.rs","label":"lib.rs","type":"file","language":"rust","lines":80},
            {"id":"file:README.md","label":"README.md","type":"document","language":"markdown","lines":20}
        ],
        "edges":[
            {"id":"e0","source":"file:src/main.rs","target":"file:src/lib.rs","type":"imports"},
            {"id":"e1","source":"file:README.md","target":"file:src/main.rs","type":"imports"}
        ],
        "metadata":{"communities":{},"project_name":"DemoProj","total_files":3,"scanned_at":"2026-07-01T10:00:00Z"}
    }"#;

    fn sample_history() -> Vec<ScanWithChanges> {
        vec![ScanWithChanges {
            summary: ScanSummary {
                scan_id: 2,
                ts: "2026-07-02T09:30:00Z".to_string(),
                node_count: 3,
                edge_count: 2,
                added: 1,
                removed: 0,
                modified: 1,
            },
            changes: vec![
                ChangeEvent {
                    entity_id: "file:src/lib.rs".to_string(),
                    entity_kind: "node".to_string(),
                    change_type: "added".to_string(),
                    payload_json: "{}".to_string(),
                },
                ChangeEvent {
                    entity_id: "file:src/main.rs".to_string(),
                    entity_kind: "node".to_string(),
                    change_type: "modified".to_string(),
                    payload_json: "{}".to_string(),
                },
            ],
        }]
    }

    /// The digest contains ALL required sections with real content: structure
    /// (types + languages + counts), recent changes WITH the scan DATE, and hubs.
    #[test]
    fn digest_has_all_sections() {
        let md = build_digest(SAMPLE_GRAPH, "2026-07-02T12:00:00Z", &sample_history());

        // Title + totals.
        assert!(md.contains("# Registry digest — DemoProj"), "title/project\n{md}");
        assert!(md.contains("3 nodes, 2 edges, 220 lines"), "totals (lines summed)\n{md}");

        // Structure by type + by language with counts.
        assert!(md.contains("## Structure"), "structure header");
        assert!(md.contains("**file**: 2"), "type count file=2\n{md}");
        assert!(md.contains("**document**: 1"), "type count document=1\n{md}");
        assert!(md.contains("**rust**: 2"), "language count rust=2\n{md}");
        assert!(md.contains("**markdown**: 1"), "language count markdown=1\n{md}");

        // Recent changes WITH DATE (the scan ts must appear).
        assert!(md.contains("## Recent changes"), "changes header");
        assert!(md.contains("2026-07-02T09:30:00Z"), "scan date present\n{md}");
        assert!(md.contains("`file:src/lib.rs` — added"), "per-file dated change\n{md}");
        assert!(md.contains("`file:src/main.rs` — modified"), "per-file modified change\n{md}");

        // Top hubs (degree ranking). main.rs has degree 2 (both edges touch it).
        assert!(md.contains("## Top files (hubs)"), "hubs header");
        assert!(md.contains("`file:src/main.rs`"), "hub present\n{md}");
        assert!(md.contains("connections)"), "hub connection count present\n{md}");
    }

    /// DETERMINISM: same inputs → byte-identical output (no HashMap iteration order
    /// leaking; we sort types/languages/hubs/changes).
    #[test]
    fn digest_is_deterministic() {
        let a = build_digest(SAMPLE_GRAPH, "2026-07-02T12:00:00Z", &sample_history());
        let b = build_digest(SAMPLE_GRAPH, "2026-07-02T12:00:00Z", &sample_history());
        assert_eq!(a, b, "digest must be byte-identical for identical inputs");
    }

    /// Empty history is handled gracefully (no scans yet → explicit note, no crash).
    #[test]
    fn digest_handles_no_history() {
        let md = build_digest(SAMPLE_GRAPH, "2026-07-02T12:00:00Z", &[]);
        assert!(md.contains("No scan history recorded yet."), "empty-history note\n{md}");
        // Structure + hubs still present.
        assert!(md.contains("**file**: 2"));
        assert!(md.contains("## Top files (hubs)"));
    }

    /// Garbage/empty graph JSON does not crash the builder.
    #[test]
    fn digest_handles_empty_graph() {
        let md = build_digest("not json", "2026-07-02T12:00:00Z", &[]);
        assert!(md.contains("0 nodes, 0 edges, 0 lines"), "empty graph totals\n{md}");
        assert!(md.contains("_No nodes._"), "empty structure note");
    }

    /// Filename slug is filesystem-safe.
    #[test]
    fn slug_is_fs_safe() {
        assert_eq!(slug("My Project!"), "My-Project");
        assert_eq!(slug("a/b\\c:d"), "a-b-c-d");
        assert_eq!(slug("---"), "project");
        assert_eq!(slug("clean_name-1"), "clean_name-1");
    }
}
