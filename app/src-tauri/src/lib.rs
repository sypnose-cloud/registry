mod indexer;
mod ai_bridge;
mod watcher;
mod history;
mod chat;
mod export;

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct RecentProject {
    path: String,
    name: String,
    last_opened: String,
    file_count: Option<u32>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct AppConfig {
    recent_projects: Vec<RecentProject>,
}

fn config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    Ok(home.join(".registry-app").join("config.json"))
}

fn load_config() -> AppConfig {
    let path = match config_path() {
        Ok(p) => p,
        Err(_) => return AppConfig { recent_projects: vec![] },
    };
    let contents = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return AppConfig { recent_projects: vec![] },
    };
    serde_json::from_str(&contents).unwrap_or(AppConfig { recent_projects: vec![] })
}

fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&path, json)
        .map_err(|e| format!("Failed to write config file: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn open_folder_dialog() -> Result<Option<String>, String> {
    let folder = rfd::AsyncFileDialog::new().pick_folder().await;
    Ok(folder.map(|p| p.path().to_string_lossy().to_string()))
}

#[tauri::command]
fn read_graph_json(path: String, bridge: tauri::State<'_, Arc<ai_bridge::AiBridge>>) -> Result<String, String> {
    let base = PathBuf::from(&path);

    let candidates = [
        base.join("graphify-out").join("graph.json"),
        base.join(".drift").join("graph.json"),
    ];

    for candidate in &candidates {
        if candidate.exists() {
            let json = fs::read_to_string(candidate)
                .map_err(|e| format!("Failed to read {}: {}", candidate.display(), e))?;

            // Update AI Bridge with loaded graph
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
            let nodes = parsed.get("nodes").and_then(|n| n.as_array()).map(|a| a.len()).unwrap_or(0);
            let edges = parsed.get("edges").and_then(|e| e.as_array()).map(|a| a.len()).unwrap_or(0);
            let comms = parsed.get("metadata").and_then(|m| m.get("communities")).and_then(|c| c.as_object()).map(|o| o.len()).unwrap_or(0);
            let name = path.split(['/', '\\']).filter(|s| !s.is_empty()).last().unwrap_or("Project");
            bridge.update_graph(name, &path, &json, nodes, edges, comms);

            return Ok(json);
        }
    }

    Err(format!(
        "No graph.json found in '{}'. Looked for: graphify-out/graph.json, .drift/graph.json",
        path
    ))
}

#[tauri::command]
fn index_project(path: String, bridge: tauri::State<'_, Arc<ai_bridge::AiBridge>>) -> Result<String, String> {
    let root = PathBuf::from(&path);
    if !root.exists() || !root.is_dir() {
        return Err(format!("Path does not exist or is not a directory: {}", path));
    }

    let graph = indexer::index_project(&root)?;
    let json = serde_json::to_string(&graph)
        .map_err(|e| format!("Failed to serialize indexed graph: {}", e))?;

    // Update AI Bridge
    let name = path.split(['/', '\\']).filter(|s| !s.is_empty()).last().unwrap_or("Project");
    bridge.update_graph(name, &path, &json, graph.nodes.len(), graph.edges.len(),
        graph.metadata.communities.len());

    // M3: record a temporal snapshot (+ diff). Best-effort — a read-only folder
    // just means no history; indexing still succeeds.
    if let Err(e) = history::record_index(&root, &json, &path) {
        eprintln!("[history] snapshot skipped for {}: {}", path, e);
    }

    Ok(json)
}

/// M3: list all recorded scans for a project (slider tick data).
#[tauri::command]
fn list_snapshots(path: String) -> Result<Vec<history::ScanSummary>, String> {
    history::list_scans(&PathBuf::from(path))
}

/// M3: reconstruct the exact graph JSON stored for a scan (time travel — no disk re-index).
#[tauri::command]
fn get_snapshot(path: String, scan_id: i64) -> Result<String, String> {
    history::get_snapshot(&PathBuf::from(path), scan_id)
}

/// M3: change events for a scan (slider overlay: added/removed/modified vs previous).
#[tauri::command]
fn get_changes(path: String, scan_id: i64) -> Result<Vec<history::ChangeEvent>, String> {
    history::get_changes(&PathBuf::from(path), scan_id)
}

/// M4: ask Claude a question grounded in the given graph JSON (the graph currently
/// visible — live or a historical snapshot). Returns the answer text. Errors with
/// "NO_API_KEY: ..." if the user has not configured their Anthropic key.
#[tauri::command]
async fn ask_claude(question: String, graph_json: String) -> Result<String, String> {
    chat::ask_claude(&question, &graph_json).await
}

/// M4: store the user's Anthropic API key (Settings UI). Empty string clears it.
/// The key is written to `~/.registry-app/settings.json` — never to the repo/git.
#[tauri::command]
fn set_api_key(key: String) -> Result<(), String> {
    chat::set_api_key(&key)
}

/// M4: whether an API key is configured. Returns only { configured, hint } — the
/// full key is NEVER returned through this command (hint is masked to last 4 chars).
#[tauri::command]
fn get_api_key_status() -> Result<chat::ApiKeyStatus, String> {
    Ok(chat::api_key_status())
}

/// M5: export a Markdown digest of the currently-visible graph (structure, dated
/// recent changes, hub files) to a folder Carlos syncs with Google Drive. Returns
/// the absolute path of the written .md. `dest_dir` is optional: if omitted, the
/// saved digest folder is used, else the default `~/RegistryDigests/`.
#[tauri::command]
fn export_digest(path: String, graph_json: String, dest_dir: Option<String>) -> Result<String, String> {
    export::write_digest(&path, &graph_json, dest_dir)
}

/// v2.2 wizard: everything the NotebookLM setup screen needs, in one call.
#[tauri::command]
fn nb_get_state() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "drive_detected": export::detect_drive_dir(),
        "digest_dir": chat::get_digest_dir(),
        "connected": chat::get_nb_connected(),
    }))
}

/// v2.2 wizard: persist that the user completed the one-time NotebookLM setup.
#[tauri::command]
fn nb_set_connected(connected: bool) -> Result<(), String> {
    chat::set_nb_connected(connected)
}

/// v2.2 wizard: open NotebookLM in the default browser (a URL, so this is safe
/// with the opener — nothing local is executed).
#[tauri::command]
async fn open_notebooklm(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url("https://notebooklm.google.com", None::<&str>)
        .map_err(|e| e.to_string())
}

/// M5: open a folder picker so the user chooses (once) their Drive-synced digest
/// folder. Persists and returns the chosen path (None if the dialog was cancelled).
#[tauri::command]
async fn pick_digest_dir() -> Result<Option<String>, String> {
    let folder = rfd::AsyncFileDialog::new().pick_folder().await;
    match folder {
        Some(f) => {
            let dir = f.path().to_string_lossy().to_string();
            chat::set_digest_dir(&dir)?;
            Ok(Some(dir))
        }
        None => Ok(None),
    }
}

/// M5: the currently-saved digest destination folder ("" if never chosen).
#[tauri::command]
fn get_digest_dir() -> Result<String, String> {
    Ok(chat::get_digest_dir())
}

/// M5 (Vía B, EXPERIMENTAL): report whether the optional `notebooklm-py` CLI is
/// installed. Never uploads — the supported path is Vía A (Drive-synced folder).
/// Uses UNOFFICIAL Google APIs; kept opt-in and off by default.
#[tauri::command]
fn notebooklm_status() -> Result<export::NotebookLmStatus, String> {
    Ok(export::notebooklm_status())
}

/// Start (or restart) the live watcher on `path`. Any previously-active watcher
/// is torn down first, so opening another folder never leaves an orphan watcher.
#[tauri::command]
fn start_watch(
    path: String,
    state: tauri::State<'_, Arc<watcher::WatcherState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    state.start(PathBuf::from(path), app)
}

/// Stop the live watcher (Live toggle off, or leaving the project).
#[tauri::command]
fn stop_watch(state: tauri::State<'_, Arc<watcher::WatcherState>>) -> Result<(), String> {
    state.stop();
    Ok(())
}

/// Path currently being watched, if any (used by tests / UI state).
#[tauri::command]
fn watched_path(state: tauri::State<'_, Arc<watcher::WatcherState>>) -> Result<Option<String>, String> {
    Ok(state.watched_path().map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn get_recent_projects() -> Result<Vec<RecentProject>, String> {
    let config = load_config();
    Ok(config.recent_projects)
}

#[tauri::command]
fn save_recent_project(path: String, name: String) -> Result<(), String> {
    let mut config = load_config();

    // Remove existing entry for this path if any
    config.recent_projects.retain(|p| p.path != path);

    let now = chrono::Utc::now().to_rfc3339();
    config.recent_projects.insert(
        0,
        RecentProject {
            path,
            name,
            last_opened: now,
            file_count: None,
        },
    );

    // Keep max 10 recent projects
    config.recent_projects.truncate(10);

    save_config(&config)
}

#[tauri::command]
async fn open_file_in_os(path: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    // SECURITY: "Open" must be a READ action, never an EXECUTE action. With the
    // OS default association, double-click semantics RUN .py/.bat/.cmd/.vbs/.js
    // (and .exe & friends). A user exploring their graph must never execute code
    // by clicking "Open" on a node.
    match open_strategy(&path) {
        OpenStrategy::RevealOnly => {
            // Executable binaries: opening = running. Show in Explorer instead.
            return reveal_in_explorer(path).await;
        }
        OpenStrategy::TextEditor => {
            // Scripts are text: open them for READING in an editor.
            #[cfg(target_os = "windows")]
            {
                return std::process::Command::new("notepad.exe")
                    .arg(&path)
                    .spawn()
                    .map(|_| ())
                    .map_err(|e| e.to_string());
            }
            #[cfg(not(target_os = "windows"))]
            {
                // Non-Windows: default association for scripts is an editor.
            }
        }
        OpenStrategy::Default => {}
    }

    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[derive(PartialEq, Debug)]
enum OpenStrategy {
    /// Safe to open with the OS default app (docs, images, most code files).
    Default,
    /// Script whose double-click association may EXECUTE it — open in a text editor.
    TextEditor,
    /// Executable binary — never open; reveal in Explorer instead.
    RevealOnly,
}

#[cfg(test)]
mod open_strategy_tests {
    use super::*;

    #[test]
    fn scripts_open_in_editor_never_execute() {
        for p in [r"C:\x\run.py", r"C:\x\deploy.BAT", "/x/setup.sh", r"C:\x\a.vbs",
                  r"C:\x\legacy.js", r"C:\x\task.CMD", r"C:\x\prov.ps1"] {
            assert_eq!(open_strategy(p), OpenStrategy::TextEditor, "{}", p);
        }
    }

    #[test]
    fn binaries_are_reveal_only() {
        for p in [r"C:\x\app.exe", r"C:\x\setup.MSI", r"C:\x\tool.jar", r"C:\x\a.lnk"] {
            assert_eq!(open_strategy(p), OpenStrategy::RevealOnly, "{}", p);
        }
    }

    #[test]
    fn docs_code_and_media_keep_default_open() {
        for p in [r"C:\x\README.md", r"C:\x\main.rs", r"C:\x\app.tsx", r"C:\x\a.pdf",
                  r"C:\x\logo.png", r"C:\x\data.json", r"C:\x\noext"] {
            assert_eq!(open_strategy(p), OpenStrategy::Default, "{}", p);
        }
    }
}

/// Pure classification so it can be unit-tested. Case-insensitive on extension.
fn open_strategy(path: &str) -> OpenStrategy {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        // Binaries: double-click = run. Reveal only.
        "exe" | "com" | "scr" | "msi" | "msix" | "jar" | "lnk" | "application" => {
            OpenStrategy::RevealOnly
        }
        // Scripts: text files whose default association may execute them
        // (.py → python, .bat/.cmd → cmd, .vbs/.js/.wsf → Windows Script Host,
        //  .ps1 is editor-by-default but keep it consistent: read, don't risk).
        "py" | "pyw" | "bat" | "cmd" | "ps1" | "psm1" | "vbs" | "vbe" | "js"
        | "jse" | "wsf" | "wsh" | "sh" => OpenStrategy::TextEditor,
        _ => OpenStrategy::Default,
    }
}

#[tauri::command]
fn get_ai_status(bridge: tauri::State<'_, Arc<ai_bridge::AiBridge>>) -> Result<serde_json::Value, String> {
    let connected = bridge.is_ai_connected();
    let highlights = bridge.highlights.lock().unwrap();
    Ok(serde_json::json!({
        "connected": connected,
        "highlight_count": highlights.len(),
        "port": 44444,
    }))
}

#[tauri::command]
fn get_ai_highlights(bridge: tauri::State<'_, Arc<ai_bridge::AiBridge>>) -> Result<serde_json::Value, String> {
    let highlights = bridge.highlights.lock().unwrap();
    Ok(serde_json::to_value(&*highlights).unwrap_or(serde_json::Value::Array(vec![])))
}

#[tauri::command]
async fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.replace('/', "\\")))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(std::path::Path::new(&path).parent().unwrap_or(std::path::Path::new(&path)).to_str().unwrap_or(&path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let bridge = Arc::new(ai_bridge::AiBridge::new());
    bridge.start(44444);

    let watcher_state = Arc::new(watcher::WatcherState::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(bridge)
        .manage(watcher_state)
        .invoke_handler(tauri::generate_handler![
            open_folder_dialog,
            read_graph_json,
            index_project,
            start_watch,
            stop_watch,
            watched_path,
            list_snapshots,
            get_snapshot,
            get_changes,
            ask_claude,
            set_api_key,
            get_api_key_status,
            export_digest,
            pick_digest_dir,
            nb_get_state,
            nb_set_connected,
            open_notebooklm,
            get_digest_dir,
            notebooklm_status,
            get_recent_projects,
            save_recent_project,
            open_file_in_os,
            reveal_in_explorer,
            get_ai_status,
            get_ai_highlights
        ])
        .setup(|_app| {
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
