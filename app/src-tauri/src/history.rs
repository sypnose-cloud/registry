//! Temporal memory: snapshot + diff history in SQLite (M3).
//!
//! Every indexation (manual `index_project` OR a live watcher re-index) records
//! a SNAPSHOT of the emitted graph JSON plus a DIFF against the previous scan.
//! A time-slider in the UI reconstructs the graph as it was at any past scan by
//! reading the stored snapshot (NOT re-indexing disk).
//!
//! Design decisions (see PLAN-MEJORAS-EJECUCION.md § M3 + SM hard constraints):
//!  - STORAGE: SQLite via rusqlite `bundled` — no system SQLite needed. The db
//!    lives at `<folder>/graphify-out/history.db`. `graphify-out/` is already
//!    excluded from the watcher (indexer::is_ignored_path), and `.db`/`.db-wal`/
//!    `.db-shm` suffixes are excluded too — so WRITING the snapshot NEVER triggers
//!    a re-index (the M3 loop-breaker; proven by tests in `watcher.rs`/`indexer.rs`
//!    and `history::tests::db_path_is_watcher_excluded`).
//!  - FULL SNAPSHOT PER SCAN (v1): we store the EXACT emitted graph JSON string
//!    per scan. Reconstructing any date is then a trivial, byte-identical read —
//!    no fragile delta-chains. The SM's integrity test (reconstruct A byte-for-byte
//!    after later changes) mandates this robustness over storage efficiency.
//!  - DIFF DERIVED: on insert we compute added/removed/modified entities (nodes by
//!    `id`, edges by `id`; modified = same id, different lines/hash) against the
//!    previous scan and store them as `change_events` for the slider's overlay.
//!  - Best-effort: if the folder is read-only (e.g. C:\Program Files) the db can't
//!    be created — we swallow the error so indexing still works (history just off).

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;

/// Where the history db lives for a given project root. Inside `graphify-out/`,
/// which the watcher ignores — writing here must not cause a re-index loop.
pub fn history_db_path(root: &Path) -> PathBuf {
    root.join("graphify-out").join("history.db")
}

/// A scan row summary (for the slider's tick list).
#[derive(Serialize, Clone, Debug)]
pub struct ScanSummary {
    pub scan_id: i64,
    pub ts: String,
    pub node_count: i64,
    pub edge_count: i64,
    /// Diff counters vs the previous scan (0 for the first scan).
    pub added: i64,
    pub removed: i64,
    pub modified: i64,
}

/// A single change event (for the slider overlay: green/amber/red).
#[derive(Serialize, Clone, Debug)]
pub struct ChangeEvent {
    pub entity_id: String,
    pub entity_kind: String, // "node" | "edge"
    pub change_type: String, // "added" | "removed" | "modified"
    pub payload_json: String,
}

/// Open (creating if needed) the history db and ensure the schema exists.
fn open_db(root: &Path) -> Result<Connection, String> {
    let db_path = history_db_path(root);
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create graphify-out dir: {}", e))?;
    }
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open history.db: {}", e))?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS scans (
            scan_id       INTEGER PRIMARY KEY AUTOINCREMENT,
            ts            TEXT    NOT NULL,
            project_path  TEXT    NOT NULL,
            node_count    INTEGER NOT NULL,
            edge_count    INTEGER NOT NULL,
            snapshot_json TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS change_events (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            scan_id      INTEGER NOT NULL,
            entity_id    TEXT    NOT NULL,
            entity_kind  TEXT    NOT NULL,
            change_type  TEXT    NOT NULL,
            payload_json TEXT    NOT NULL,
            FOREIGN KEY (scan_id) REFERENCES scans(scan_id)
        );

        CREATE INDEX IF NOT EXISTS idx_scans_project_ts ON scans(project_path, ts);
        CREATE INDEX IF NOT EXISTS idx_events_scan ON change_events(scan_id);
        "#,
    )
    .map_err(|e| format!("Failed to init schema: {}", e))
}

/// Minimal node/edge shape parsed from the emitted graph JSON for diffing.
/// We deliberately parse from the raw JSON (untyped) so history stays decoupled
/// from indexer struct changes — the snapshot we STORE is the exact emitted string.
struct ParsedGraph {
    /// node id -> a stable fingerprint for "modified" detection (lines + type).
    nodes: std::collections::HashMap<String, String>,
    /// edge id -> fingerprint (source|target|type).
    edges: std::collections::HashMap<String, String>,
    /// raw node payloads by id (for change_event payloads).
    node_payloads: std::collections::HashMap<String, String>,
    edge_payloads: std::collections::HashMap<String, String>,
    node_count: i64,
    edge_count: i64,
}

fn parse_graph(json: &str) -> Result<ParsedGraph, String> {
    let v: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| format!("history: cannot parse graph json: {}", e))?;

    let mut nodes = std::collections::HashMap::new();
    let mut node_payloads = std::collections::HashMap::new();
    if let Some(arr) = v.get("nodes").and_then(|n| n.as_array()) {
        for n in arr {
            let id = n.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
            if id.is_empty() {
                continue;
            }
            // Fingerprint: fields that define "the node changed". lines + type +
            // label capture code edits (line count) and structural changes.
            let lines = n.get("lines").map(|x| x.to_string()).unwrap_or_default();
            let ty = n.get("type").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let label = n.get("label").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let fp = format!("{}|{}|{}", ty, label, lines);
            nodes.insert(id.clone(), fp);
            node_payloads.insert(id, n.to_string());
        }
    }

    let mut edges = std::collections::HashMap::new();
    let mut edge_payloads = std::collections::HashMap::new();
    if let Some(arr) = v.get("edges").and_then(|e| e.as_array()) {
        for e in arr {
            let id = e.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
            if id.is_empty() {
                continue;
            }
            let src = e.get("source").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let tgt = e.get("target").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let ty = e.get("type").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let fp = format!("{}|{}|{}", src, tgt, ty);
            edges.insert(id.clone(), fp);
            edge_payloads.insert(id, e.to_string());
        }
    }

    let node_count = nodes.len() as i64;
    let edge_count = edges.len() as i64;
    Ok(ParsedGraph { nodes, edges, node_payloads, edge_payloads, node_count, edge_count })
}

/// Compute change events between the previous graph and the current one.
///
/// FIRST SCAN (prev = None): returns EMPTY. There is no prior state to diff
/// against, so painting the whole graph green ("everything added") would be
/// misleading overlay noise. The slider shows change overlays only from the
/// SECOND scan onward, where "what changed vs the previous scan" is meaningful.
fn compute_diff(prev: Option<&ParsedGraph>, cur: &ParsedGraph) -> Vec<ChangeEvent> {
    let prev = match prev {
        Some(p) => p,
        None => return Vec::new(),
    };

    let mut events = Vec::new();
    let prev_nodes = &prev.nodes;
    let prev_edges = &prev.edges;

    // Nodes: added / modified
    for (id, fp) in &cur.nodes {
        match prev_nodes.get(id) {
            None => events.push(ChangeEvent {
                entity_id: id.clone(),
                entity_kind: "node".into(),
                change_type: "added".into(),
                payload_json: cur.node_payloads.get(id).cloned().unwrap_or_default(),
            }),
            Some(prev_fp) if prev_fp != fp => events.push(ChangeEvent {
                entity_id: id.clone(),
                entity_kind: "node".into(),
                change_type: "modified".into(),
                payload_json: cur.node_payloads.get(id).cloned().unwrap_or_default(),
            }),
            _ => {}
        }
    }
    // Nodes: removed
    for id in prev_nodes.keys() {
        if !cur.nodes.contains_key(id) {
            events.push(ChangeEvent {
                entity_id: id.clone(),
                entity_kind: "node".into(),
                change_type: "removed".into(),
                payload_json: String::new(),
            });
        }
    }

    // Edges: added / modified
    for (id, fp) in &cur.edges {
        match prev_edges.get(id) {
            None => events.push(ChangeEvent {
                entity_id: id.clone(),
                entity_kind: "edge".into(),
                change_type: "added".into(),
                payload_json: cur.edge_payloads.get(id).cloned().unwrap_or_default(),
            }),
            Some(prev_fp) if prev_fp != fp => events.push(ChangeEvent {
                entity_id: id.clone(),
                entity_kind: "edge".into(),
                change_type: "modified".into(),
                payload_json: cur.edge_payloads.get(id).cloned().unwrap_or_default(),
            }),
            _ => {}
        }
    }
    // Edges: removed
    for id in prev_edges.keys() {
        if !cur.edges.contains_key(id) {
            events.push(ChangeEvent {
                entity_id: id.clone(),
                entity_kind: "edge".into(),
                change_type: "removed".into(),
                payload_json: String::new(),
            });
        }
    }

    events
}

/// Load the most recent scan's snapshot JSON (for diffing the next one).
fn last_snapshot_json(conn: &Connection) -> Option<String> {
    conn.query_row(
        "SELECT snapshot_json FROM scans ORDER BY scan_id DESC LIMIT 1",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

/// Record an indexation: store the exact `graph_json` as a snapshot and the diff
/// vs the previous scan. Returns the new scan_id. Best-effort at call sites: a
/// read-only folder makes this Err, which callers may ignore.
pub fn record_index(root: &Path, graph_json: &str, project_path: &str) -> Result<i64, String> {
    let conn = open_db(root)?;

    let cur = parse_graph(graph_json)?;
    let prev_json = last_snapshot_json(&conn);
    let prev_parsed = match &prev_json {
        Some(j) => parse_graph(j).ok(),
        None => None,
    };
    let events = compute_diff(prev_parsed.as_ref(), &cur);

    let ts = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO scans (ts, project_path, node_count, edge_count, snapshot_json)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![ts, project_path, cur.node_count, cur.edge_count, graph_json],
    )
    .map_err(|e| format!("Failed to insert scan: {}", e))?;

    let scan_id = conn.last_insert_rowid();

    for ev in &events {
        conn.execute(
            "INSERT INTO change_events (scan_id, entity_id, entity_kind, change_type, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![scan_id, ev.entity_id, ev.entity_kind, ev.change_type, ev.payload_json],
        )
        .map_err(|e| format!("Failed to insert change_event: {}", e))?;
    }

    Ok(scan_id)
}

/// List all scans for the slider (oldest first), with diff counters.
pub fn list_scans(root: &Path) -> Result<Vec<ScanSummary>, String> {
    let db_path = history_db_path(root);
    if !db_path.exists() {
        return Ok(vec![]); // No history yet.
    }
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open history.db: {}", e))?;
    // If schema somehow missing (corrupt/empty), treat as no history.
    if init_schema(&conn).is_err() {
        return Ok(vec![]);
    }

    let mut stmt = conn
        .prepare(
            "SELECT s.scan_id, s.ts, s.node_count, s.edge_count,
                    COALESCE(SUM(CASE WHEN e.change_type='added'    THEN 1 ELSE 0 END), 0) AS added,
                    COALESCE(SUM(CASE WHEN e.change_type='removed'  THEN 1 ELSE 0 END), 0) AS removed,
                    COALESCE(SUM(CASE WHEN e.change_type='modified' THEN 1 ELSE 0 END), 0) AS modified
             FROM scans s
             LEFT JOIN change_events e ON e.scan_id = s.scan_id
             GROUP BY s.scan_id
             ORDER BY s.scan_id ASC",
        )
        .map_err(|e| format!("Failed to prepare list_scans: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ScanSummary {
                scan_id: row.get(0)?,
                ts: row.get(1)?,
                node_count: row.get(2)?,
                edge_count: row.get(3)?,
                added: row.get(4)?,
                removed: row.get(5)?,
                modified: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to query scans: {}", e))?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("Row error: {}", e))?);
    }
    Ok(out)
}

/// Reconstruct the exact graph JSON stored for a scan. This is the byte-identical
/// snapshot that was emitted at that time — the core of the integrity guarantee.
pub fn get_snapshot(root: &Path, scan_id: i64) -> Result<String, String> {
    let db_path = history_db_path(root);
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open history.db: {}", e))?;
    conn.query_row(
        "SELECT snapshot_json FROM scans WHERE scan_id = ?1",
        rusqlite::params![scan_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| format!("Snapshot {} not found: {}", scan_id, e))
}

/// Change events for a scan (the slider overlay: what changed vs the previous scan).
pub fn get_changes(root: &Path, scan_id: i64) -> Result<Vec<ChangeEvent>, String> {
    let db_path = history_db_path(root);
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open history.db: {}", e))?;
    let mut stmt = conn
        .prepare(
            "SELECT entity_id, entity_kind, change_type, payload_json
             FROM change_events WHERE scan_id = ?1",
        )
        .map_err(|e| format!("Failed to prepare get_changes: {}", e))?;
    let rows = stmt
        .query_map(rusqlite::params![scan_id], |row| {
            Ok(ChangeEvent {
                entity_id: row.get(0)?,
                entity_kind: row.get(1)?,
                change_type: row.get(2)?,
                payload_json: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to query changes: {}", e))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("Row error: {}", e))?);
    }
    Ok(out)
}

// ─────────────────────────────────────────────────────────────
// M3 Gate tests — the integrity test is the heart of the gate.
// ─────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use crate::indexer;

    /// A throwaway project dir under target/ (writable, unlike some tempdirs in CI).
    fn scratch(name: &str) -> PathBuf {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("history-test")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn graph_a() -> &'static str {
        r#"{"nodes":[{"id":"file:a.py","label":"a.py","type":"file","lines":10},{"id":"file:b.py","label":"b.py","type":"file","lines":20}],"edges":[{"id":"e0","source":"file:a.py","target":"file:b.py","type":"imports"}],"metadata":{"communities":{},"project_name":"P","total_files":2,"scanned_at":"2026-07-02T00:00:00Z"}}"#
    }
    fn graph_b() -> &'static str {
        // b.py grew to 25 lines (modified), c.py added, edge to c added.
        r#"{"nodes":[{"id":"file:a.py","label":"a.py","type":"file","lines":10},{"id":"file:b.py","label":"b.py","type":"file","lines":25},{"id":"file:c.py","label":"c.py","type":"file","lines":5}],"edges":[{"id":"e0","source":"file:a.py","target":"file:b.py","type":"imports"},{"id":"e1","source":"file:b.py","target":"file:c.py","type":"imports"}],"metadata":{"communities":{},"project_name":"P","total_files":3,"scanned_at":"2026-07-02T00:01:00Z"}}"#
    }

    /// ★ THE INTEGRITY TEST (SM gate corazón):
    /// snapshot A → change to B → snapshot B → reconstruct A must be BYTE-IDENTICAL
    /// to the original A, even after B was recorded on top.
    #[test]
    fn integrity_snapshot_a_reconstructs_after_b() {
        let root = scratch("integrity");

        let a_id = record_index(&root, graph_a(), "P").expect("record A");
        let _b_id = record_index(&root, graph_b(), "P").expect("record B");

        let reconstructed_a = get_snapshot(&root, a_id).expect("get snapshot A");
        assert_eq!(
            reconstructed_a,
            graph_a(),
            "reconstructed snapshot A must be byte-identical to original A"
        );

        // And B is independently intact.
        let reconstructed_b = get_snapshot(&root, _b_id).expect("get snapshot B");
        assert_eq!(reconstructed_b, graph_b(), "snapshot B must be intact too");

        eprintln!("INTEGRITY: PASS — snapshot A byte-identical after B recorded on top");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// ★ DIFF test: A→B must report c.py added, b.py modified, e1 added, nothing removed.
    #[test]
    fn diff_reports_added_modified_removed() {
        let root = scratch("diff");

        let _a = record_index(&root, graph_a(), "P").expect("record A");
        let b = record_index(&root, graph_b(), "P").expect("record B");

        let changes = get_changes(&root, b).expect("get changes B");

        let added: Vec<_> = changes.iter().filter(|c| c.change_type == "added").collect();
        let modified: Vec<_> = changes.iter().filter(|c| c.change_type == "modified").collect();
        let removed: Vec<_> = changes.iter().filter(|c| c.change_type == "removed").collect();

        // c.py node + e1 edge added
        assert!(added.iter().any(|c| c.entity_id == "file:c.py" && c.entity_kind == "node"), "c.py added");
        assert!(added.iter().any(|c| c.entity_id == "e1" && c.entity_kind == "edge"), "e1 added");
        // b.py modified (lines 20 -> 25)
        assert!(modified.iter().any(|c| c.entity_id == "file:b.py"), "b.py modified");
        // nothing removed
        assert!(removed.is_empty(), "nothing should be removed A->B, got {:?}", removed);

        eprintln!(
            "DIFF: PASS — added={} modified={} removed={} (c.py+e1 added, b.py modified)",
            added.len(), modified.len(), removed.len()
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// First scan has no previous → zero change events (no overlay noise),
    /// one scan row with the correct node count.
    #[test]
    fn first_scan_has_no_diff() {
        let root = scratch("first");
        let a = record_index(&root, graph_a(), "P").expect("record A");
        let changes = get_changes(&root, a).expect("get changes");
        assert!(changes.is_empty(), "first scan must have 0 change events (no prior to diff)");

        let scans = list_scans(&root).expect("list scans");
        assert_eq!(scans.len(), 1);
        assert_eq!(scans[0].added, 0);
        assert_eq!(scans[0].node_count, 2);
        eprintln!("FIRST-SCAN: PASS — 0 diff events, node_count=2");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Border: missing/absent db → list_scans returns empty, no crash.
    #[test]
    fn missing_db_is_graceful() {
        let root = scratch("missing");
        // Do NOT record anything; graphify-out/history.db does not exist.
        let scans = list_scans(&root).expect("list_scans on missing db must not error");
        assert!(scans.is_empty());
        eprintln!("MISSING-DB: PASS — empty history, no crash");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// ★ LOOP-BREAKER: the history db path is inside graphify-out/ AND ends in .db,
    /// so the watcher's is_ignored_path drops any event on it → no re-index loop.
    #[test]
    fn db_path_is_watcher_excluded() {
        let root = scratch("loopbreak");
        let db = history_db_path(&root);

        assert!(indexer::is_ignored_path(&db, &root), "history.db must be watcher-excluded");
        // SQLite sidecars too:
        let wal = db.with_extension("db-wal");
        let shm = db.with_extension("db-shm");
        assert!(indexer::is_ignored_path(&wal, &root), "history.db-wal must be excluded");
        assert!(indexer::is_ignored_path(&shm, &root), "history.db-shm must be excluded");

        eprintln!("LOOP-BREAKER: PASS — history.db + .db-wal + .db-shm all watcher-excluded");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Real-index round-trip: index src/ twice, second snapshot reconstructs intact.
    #[test]
    fn real_index_snapshot_roundtrip() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
        // Use a SEPARATE scratch db so we don't pollute src/graphify-out.
        // record_index writes into root/graphify-out — for src/ that's undesirable,
        // so we index src/ but store into a scratch root by copying the json.
        let graph = indexer::index_project(&root).expect("index src/");
        let json = serde_json::to_string(&graph).expect("serialize");

        let scratch_root = scratch("roundtrip");
        let id = record_index(&scratch_root, &json, "src").expect("record");
        let got = get_snapshot(&scratch_root, id).expect("get");
        assert_eq!(got, json, "real graph snapshot must round-trip byte-identical");
        eprintln!("REAL-ROUNDTRIP: PASS — {} nodes snapshot round-trips", graph.nodes.len());
        let _ = std::fs::remove_dir_all(&scratch_root);
    }
}
