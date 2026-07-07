//! v2.4 — Vía C: push the digest straight into a user-run Open Notebook
//! instance (open-source NotebookLM alternative, github.com/lfnovo/open-notebook).
//!
//! Store-safety rationale: the app only TALKS to an instance the user already
//! runs (localhost:5055 by default, or a remote URL). Nothing is bundled or
//! downloaded — no Docker, no SurrealDB, no Python inside the package — so the
//! Microsoft Store packaging is unaffected.
//!
//! API surface used (confirmed against a running instance):
//!   GET    {base}/api/notebooks      → list of notebooks ({id, name, ...})
//!   POST   {base}/api/sources        → {notebook_id, type:"text", title, content}
//!   DELETE {base}/api/sources/{id}   → best-effort cleanup of the PREVIOUS digest
//!          source before re-pushing. Unlike Vía A (one stable file that Drive
//!          re-syncs), every POST creates a NEW source; without the delete the
//!          notebook would accumulate stale digests on every "Update now".

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

/// Default instance URL shown by the wizard (the docker-compose default port).
pub const DEFAULT_URL: &str = "http://127.0.0.1:5055";

/// Join base + path tolerating trailing/leading slashes in either part.
fn api_url(base: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base.trim().trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

#[derive(Serialize, Clone, Debug)]
pub struct NotebookInfo {
    pub id: String,
    pub name: String,
}

/// Tolerant parse of the notebooks listing: accepts a bare array or an object
/// wrapping it under "notebooks" / "items" / "data" (API shape may evolve).
/// Entries without an id are skipped; a missing name gets a readable fallback.
fn parse_notebooks(body: &str) -> Result<Vec<NotebookInfo>, String> {
    let v: Value = serde_json::from_str(body)
        .map_err(|e| format!("Open Notebook returned non-JSON: {}", e))?;
    let arr = v
        .as_array()
        .cloned()
        .or_else(|| v.get("notebooks").and_then(|x| x.as_array()).cloned())
        .or_else(|| v.get("items").and_then(|x| x.as_array()).cloned())
        .or_else(|| v.get("data").and_then(|x| x.as_array()).cloned())
        .ok_or_else(|| "Unexpected /api/notebooks response shape".to_string())?;

    Ok(arr
        .iter()
        .filter_map(|n| {
            let id = n.get("id").and_then(|x| x.as_str())?.to_string();
            let name = n
                .get("name")
                .and_then(|x| x.as_str())
                .unwrap_or("(unnamed notebook)")
                .to_string();
            Some(NotebookInfo { id, name })
        })
        .collect())
}

/// Extract the created source id from a POST /api/sources response.
/// Tolerant: {"id": ...} at the top level or nested under "source".
fn parse_source_id(body: &str) -> Option<String> {
    let v: Value = serde_json::from_str(body).ok()?;
    v.get("id")
        .and_then(|x| x.as_str())
        .or_else(|| v.get("source").and_then(|s| s.get("id")).and_then(|x| x.as_str()))
        .map(|s| s.to_string())
}

/// List the notebooks of the instance at `base`. Also serves as the reachability
/// probe for the wizard ("is Open Notebook running here?") — hence the short timeout.
pub async fn list_notebooks(base: &str) -> Result<Vec<NotebookInfo>, String> {
    let url = api_url(base, "api/notebooks");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(&url).send().await.map_err(|e| {
        format!("ON_UNREACHABLE: no Open Notebook instance at {} ({})", base.trim(), e)
    })?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read Open Notebook response: {}", e))?;
    if !status.is_success() {
        return Err(format!("Open Notebook API error {}: {}", status.as_u16(), text));
    }
    parse_notebooks(&text)
}

/// Push the digest as a text source into `notebook_id`. Deletes the previously
/// pushed source first (best-effort: a failure there only means one extra stale
/// source, never a failed push). Returns the new source id.
pub async fn push_source(
    base: &str,
    notebook_id: &str,
    title: &str,
    content: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let prev = crate::chat::get_on_last_source_id();
    if !prev.is_empty() {
        let _ = client
            .delete(api_url(base, &format!("api/sources/{}", prev)))
            .send()
            .await;
    }

    let payload = serde_json::json!({
        "notebook_id": notebook_id,
        "type": "text",
        "title": title,
        "content": content,
    });
    let resp = client
        .post(api_url(base, "api/sources"))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("ON_UNREACHABLE: push to {} failed ({})", base.trim(), e))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read Open Notebook response: {}", e))?;
    if !status.is_success() {
        return Err(format!("Open Notebook API error {}: {}", status.as_u16(), text));
    }

    let source_id = parse_source_id(&text).unwrap_or_default();
    if !source_id.is_empty() {
        // Remember it so the NEXT push replaces instead of accumulating.
        let _ = crate::chat::set_on_last_source_id(&source_id);
    }
    Ok(source_id)
}

// ─────────────────────────────────────────────────────────────
// Tests — pure helpers only (no network, no settings file).
// ─────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_url_tolerates_slashes() {
        assert_eq!(api_url("http://x:5055", "api/notebooks"), "http://x:5055/api/notebooks");
        assert_eq!(api_url("http://x:5055/", "/api/notebooks"), "http://x:5055/api/notebooks");
        assert_eq!(api_url("  http://x:5055/ ", "api/sources/abc"), "http://x:5055/api/sources/abc");
    }

    #[test]
    fn parse_notebooks_accepts_bare_array_and_wrappers() {
        let bare = r#"[{"id":"nb1","name":"Proyecto"},{"id":"nb2"}]"#;
        let got = parse_notebooks(bare).unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].id, "nb1");
        assert_eq!(got[0].name, "Proyecto");
        assert_eq!(got[1].name, "(unnamed notebook)");

        for wrapper in ["notebooks", "items", "data"] {
            let wrapped = format!(r#"{{"{}":[{{"id":"a","name":"N"}}]}}"#, wrapper);
            let got = parse_notebooks(&wrapped).unwrap();
            assert_eq!(got.len(), 1, "wrapper {}", wrapper);
            assert_eq!(got[0].id, "a");
        }
    }

    #[test]
    fn parse_notebooks_rejects_garbage_cleanly() {
        assert!(parse_notebooks("not json").is_err());
        assert!(parse_notebooks(r#"{"detail":"error"}"#).is_err());
        // Entries without id are skipped, not a crash.
        let got = parse_notebooks(r#"[{"name":"sin id"}]"#).unwrap();
        assert!(got.is_empty());
    }

    #[test]
    fn parse_source_id_top_level_and_nested() {
        assert_eq!(parse_source_id(r#"{"id":"src1"}"#), Some("src1".into()));
        assert_eq!(parse_source_id(r#"{"source":{"id":"src2"}}"#), Some("src2".into()));
        assert_eq!(parse_source_id(r#"{"ok":true}"#), None);
        assert_eq!(parse_source_id("not json"), None);
    }

    /// Full HTTP round-trip against a one-shot mock server: correct path is hit
    /// and the JSON body is parsed. Covers the reqwest wiring, not just parsing.
    #[tokio::test]
    async fn list_notebooks_end_to_end_against_mock_server() {
        use std::io::{Read as _, Write as _};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 2048];
            let n = stream.read(&mut buf).unwrap();
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let body = r#"[{"id":"nb1","name":"Demo"}]"#;
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(resp.as_bytes()).unwrap();
            req
        });

        let got = list_notebooks(&format!("http://{}", addr)).await.unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].id, "nb1");
        assert_eq!(got[0].name, "Demo");

        let req = server.join().unwrap();
        let first_line = req.lines().next().unwrap_or("").to_string();
        assert!(first_line.starts_with("GET /api/notebooks"), "hit: {}", first_line);
    }

    /// Unreachable instance → clean ON_UNREACHABLE error (drives the wizard hint).
    #[tokio::test]
    async fn unreachable_instance_yields_on_unreachable_error() {
        // Port 9 (discard) is never an HTTP server; connection is refused fast.
        let err = list_notebooks("http://127.0.0.1:9").await.unwrap_err();
        assert!(err.starts_with("ON_UNREACHABLE:"), "got: {}", err);
    }
}
