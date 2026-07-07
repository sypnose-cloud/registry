//! M10 — analysis.rs: CodeBoarding-schema organigrama (autocontenido, sin servidor).
//!
//! Esquema compartido con CodeBoarding (contrato — NO cambiar sin §11 report):
//! ```json
//! {
//!   "components": [{
//!     "component_id": <str|num>,
//!     "name": str,
//!     "description": str,
//!     "key_entities": [{
//!       "reference_file": str (relativo),
//!       "reference_start_line": num,
//!       "reference_end_line": num
//!     }]
//!   }],
//!   "components_relations": [{
//!     "src_id": <str|num>, "dst_id": <str|num>,
//!     "src_name"?: str, "dst_name"?: str,
//!     "relation": str
//!   }]
//! }
//! ```
//!
//! Lectura de analysis.json (interop): prioridad `.codeboarding/` > `graphify-out/`.
//! Generación estática sin LLM: siempre funciona. Enriquecimiento LLM: opcional
//!   (fallback silencioso al estático si no hay key). Sin key → NO es error.
//!
//! read_project_file: confinado a la raíz del proyecto (patrón arch.js líneas 53-65).
//! Anti-bucle: .codeboarding en IGNORE_DIRS (junto a graphify-out).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, MAIN_SEPARATOR};

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ─────────────────────────────────────────────────────────────
// Path normalisation helper (shared across merge + build)
// ─────────────────────────────────────────────────────────────

/// Normalise a file path so that `/`- and `\`-separated versions compare equal.
fn normalise_path(p: &str) -> String {
    p.replace('\\', "/")
}

// ─────────────────────────────────────────────────────────────
// Schema types (CodeBoarding contract)
// ─────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct KeyEntity {
    pub reference_file: String,
    pub reference_start_line: u32,
    pub reference_end_line: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AnalysisComponent {
    pub component_id: Value, // str or num — preserve as-is
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub key_entities: Vec<KeyEntity>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AnalysisRelation {
    pub src_id: Value, // str or num
    pub dst_id: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub src_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dst_name: Option<String>,
    pub relation: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Analysis {
    pub components: Vec<AnalysisComponent>,
    pub components_relations: Vec<AnalysisRelation>,
}

// ─────────────────────────────────────────────────────────────
// get_analysis — priority: .codeboarding/ > graphify-out/
// ─────────────────────────────────────────────────────────────

/// Read `<path>/.codeboarding/analysis.json` if it exists (interop with external
/// CodeBoarding/CI); falls back to `<path>/graphify-out/analysis.json` (generated
/// by this app). Returns the raw JSON string or None if neither exists.
///
/// ## On-the-fly merge (graph_json is Some)
///
/// When the caller supplies `graph_json` **and** the stored analysis has fewer
/// than 2 `components_relations` entries, this function derives additional
/// `imports` relations by:
/// 1. Mapping each `key_entity.reference_file` → the component it belongs to
///    (path normalised: `/` == `\`).
/// 2. Walking every `type = "imports"` edge in the graph, resolving source/target
///    node `path` → component id.
/// 3. Aggregating cross-component import counts.
/// 4. Appending the resulting relations to the in-memory analysis and returning
///    the enriched JSON.
///
/// **The file on disk is never modified by this function.** The merge lives only
/// in the returned string.
///
/// Backward-compat: passing `None` preserves the previous behaviour exactly.
pub fn get_analysis(path: &str, graph_json: Option<&str>) -> Option<String> {
    let root = Path::new(path);

    // ── 1. Read raw JSON from disk ─────────────────────────────
    let raw = {
        let codeboarding = root.join(".codeboarding").join("analysis.json");
        if codeboarding.exists() {
            if let Ok(s) = fs::read_to_string(&codeboarding) {
                if !s.trim().is_empty() { Some(s) } else { None }
            } else { None }
        } else {
            None
        }
    }.or_else(|| {
        let app_generated = root.join("graphify-out").join("analysis.json");
        if app_generated.exists() {
            if let Ok(s) = fs::read_to_string(&app_generated) {
                if !s.trim().is_empty() { Some(s) } else { None }
            } else { None }
        } else {
            None
        }
    })?;

    // ── 2. If no graph or already >=2 relations → return as-is ─
    let graph_str = match graph_json {
        Some(g) if !g.trim().is_empty() => g,
        _ => return Some(raw),
    };

    // Parse stored analysis — on any parse error return raw unchanged.
    let mut analysis: Analysis = match serde_json::from_str(&raw) {
        Ok(a) => a,
        Err(_) => return Some(raw),
    };

    if analysis.components_relations.len() >= 2 {
        return Some(raw);
    }

    // ── 3. Merge static relations from graph ───────────────────
    if let Some(merged) = merge_relations_from_graph(&mut analysis, graph_str) {
        serde_json::to_string_pretty(&merged).ok().or(Some(raw))
    } else {
        Some(raw)
    }
}

/// Derive cross-component `imports` relations from `graph_json` and append them
/// to `analysis.components_relations` (which had <2 entries).
/// Returns `Some(&Analysis)` after mutation, or `None` if the graph is unparseable
/// or yields no new relations (caller should fall back to raw).
fn merge_relations_from_graph<'a>(analysis: &'a mut Analysis, graph_str: &str) -> Option<&'a Analysis> {
    let graph: Value = serde_json::from_str(graph_str).ok()?;

    let nodes = graph.get("nodes").and_then(|n| n.as_array())?;
    let edges = graph.get("edges").and_then(|e| e.as_array())?;

    // ── Build: normalised_path → component_id ─────────────────
    // For each component, map all its key_entity paths to that component id.
    let mut path_to_comp: HashMap<String, String> = HashMap::new();
    for comp in &analysis.components {
        let cid = match &comp.component_id {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            other => serde_json::to_string(other).unwrap_or_default(),
        };
        for entity in &comp.key_entities {
            let norm = normalise_path(&entity.reference_file);
            path_to_comp.insert(norm, cid.clone());
        }
    }

    // ── Build: node_id → normalised_path ──────────────────────
    let mut node_path: HashMap<String, String> = HashMap::new();
    for node in nodes {
        if let (Some(id), Some(p)) = (
            node.get("id").and_then(|v| v.as_str()),
            node.get("path").and_then(|v| v.as_str()),
        ) {
            node_path.insert(id.to_string(), normalise_path(p));
        }
    }

    // ── Walk edges, count cross-component imports ──────────────
    let mut cross: HashMap<(String, String), usize> = HashMap::new();
    for edge in edges {
        if edge.get("type").and_then(|v| v.as_str()) != Some("imports") {
            continue;
        }
        let src_id = edge.get("source").and_then(|v| v.as_str()).unwrap_or("");
        let tgt_id = edge.get("target").and_then(|v| v.as_str()).unwrap_or("");

        let src_path = match node_path.get(src_id) { Some(p) => p, None => continue };
        let tgt_path = match node_path.get(tgt_id) { Some(p) => p, None => continue };

        let src_comp = match path_to_comp.get(src_path.as_str()) { Some(c) => c.clone(), None => continue };
        let tgt_comp = match path_to_comp.get(tgt_path.as_str()) { Some(c) => c.clone(), None => continue };

        if src_comp != tgt_comp {
            *cross.entry((src_comp, tgt_comp)).or_insert(0) += 1;
        }
    }

    if cross.is_empty() {
        return None; // nothing to add
    }

    // Build a quick lookup: component_id → name (for src_name/dst_name)
    let id_to_name: HashMap<String, String> = analysis.components.iter().map(|c| {
        let cid = match &c.component_id {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            other => serde_json::to_string(other).unwrap_or_default(),
        };
        (cid, c.name.clone())
    }).collect();

    // Collect existing relation pairs so we don't duplicate
    let existing: std::collections::HashSet<(String, String)> = analysis.components_relations.iter()
        .map(|r| {
            let s = match &r.src_id { Value::String(s) => s.clone(), Value::Number(n) => n.to_string(), other => serde_json::to_string(other).unwrap_or_default() };
            let d = match &r.dst_id { Value::String(s) => s.clone(), Value::Number(n) => n.to_string(), other => serde_json::to_string(other).unwrap_or_default() };
            (s, d)
        })
        .collect();

    let mut added = false;
    for ((src_comm, dst_comm), count) in &cross {
        if existing.contains(&(src_comm.clone(), dst_comm.clone())) {
            continue;
        }
        let src_name = id_to_name.get(src_comm).cloned();
        let dst_name = id_to_name.get(dst_comm).cloned();
        analysis.components_relations.push(AnalysisRelation {
            src_id: Value::String(src_comm.clone()),
            dst_id: Value::String(dst_comm.clone()),
            src_name,
            dst_name,
            relation: format!("imports (x{})", count),
        });
        added = true;
    }

    if added { Some(analysis) } else { None }
}

// ─────────────────────────────────────────────────────────────
// generate_analysis — static (always) + optional LLM (BYOK)
// ─────────────────────────────────────────────────────────────

/// Build a CodeBoarding-schema analysis.json from the indexed graph.
///
/// Without LLM (always): components = top-level folder modules / community hubs
///   derived from the existing `architecture::build_static` data.
///   component_id = stable community id, name = folder/module, description = heuristic,
///   key_entities = files from the graph with reference_start_line=1/end=1.
///   components_relations = import edges AGGREGATED between components.
///
/// With BYOK: a single LLM call (same pipeline as chat.rs) rewrites names/descriptions
///   in Spanish on top of the static result. If the call fails or no key → keeps static,
///   NOT an error. Persists to `<path>/graphify-out/analysis.json`.
pub async fn generate_analysis(path: &str, graph_json: &str) -> Result<String, String> {
    let root = Path::new(path);

    // Build static base unconditionally.
    let mut analysis = build_static_analysis(root, graph_json)?;

    // Try LLM enrichment (optional — never fails the caller).
    if let Err(reason) = try_enrich_analysis(&mut analysis, graph_json).await {
        // Only log when it's not a "no key" situation to avoid noise.
        if !reason.starts_with("NO_API_KEY") {
            eprintln!("[analysis] LLM enrichment skipped: {}", reason);
        }
        // Fallback: static already in `analysis`.
    }

    // Persist.
    let json = serde_json::to_string_pretty(&analysis)
        .map_err(|e| format!("Cannot serialise analysis: {}", e))?;
    let out_dir = root.join("graphify-out");
    fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Cannot create graphify-out: {}", e))?;
    fs::write(out_dir.join("analysis.json"), &json)
        .map_err(|e| format!("Cannot write analysis.json: {}", e))?;

    Ok(json)
}

// ─────────────────────────────────────────────────────────────
// Static builder — no LLM
// ─────────────────────────────────────────────────────────────

fn build_static_analysis(project_root: &Path, graph_json: &str) -> Result<Analysis, String> {
    let graph: Value = serde_json::from_str(graph_json)
        .map_err(|e| format!("Invalid graph JSON: {}", e))?;

    let nodes = graph
        .get("nodes")
        .and_then(|n| n.as_array())
        .cloned()
        .unwrap_or_default();

    let edges = graph
        .get("edges")
        .and_then(|e| e.as_array())
        .cloned()
        .unwrap_or_default();

    // node_id -> path
    let node_paths: HashMap<String, String> = nodes
        .iter()
        .filter_map(|n| {
            let id = n.get("id").and_then(|v| v.as_str())?;
            let p = n.get("path").and_then(|v| v.as_str()).unwrap_or("");
            Some((id.to_string(), p.to_string()))
        })
        .collect();

    // node_id -> community id
    let node_community: HashMap<String, String> = nodes
        .iter()
        .filter_map(|n| {
            let id = n.get("id").and_then(|v| v.as_str())?;
            let comm = n.get("community").and_then(|v| v.as_u64())?.to_string();
            Some((id.to_string(), comm))
        })
        .collect();

    // Degrees per node
    let mut degrees: HashMap<String, u32> = HashMap::new();
    for e in &edges {
        if let Some(s) = e.get("source").and_then(|v| v.as_str()) {
            *degrees.entry(s.to_string()).or_insert(0) += 1;
        }
        if let Some(t) = e.get("target").and_then(|v| v.as_str()) {
            *degrees.entry(t.to_string()).or_insert(0) += 1;
        }
    }

    // Community -> nodes sorted by degree desc (file-like only)
    let mut community_nodes: HashMap<String, Vec<String>> = HashMap::new();
    for n in &nodes {
        let id = match n.get("id").and_then(|v| v.as_str()) { Some(s) => s, None => continue };
        let ntype = n.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if !matches!(ntype, "file" | "document" | "data" | "config" | "asset") { continue; }
        let comm = match node_community.get(id) { Some(c) => c.clone(), None => continue };
        community_nodes.entry(comm).or_default().push(id.to_string());
    }
    for members in community_nodes.values_mut() {
        members.sort_by(|a, b| {
            degrees.get(b).copied().unwrap_or(0).cmp(&degrees.get(a).copied().unwrap_or(0))
        });
    }

    // Community name + color from metadata (or default)
    let communities: HashMap<String, String> = {
        let mut map = HashMap::new();
        if let Some(comms) = graph.get("metadata").and_then(|m| m.get("communities")).and_then(|c| c.as_object()) {
            for (id, meta) in comms {
                let name = meta.get("name").and_then(|v| v.as_str()).unwrap_or(id);
                map.insert(id.clone(), name.to_string());
            }
        }
        if map.is_empty() {
            if let Some(comms) = graph.get("communities").and_then(|c| c.as_array()) {
                for c in comms {
                    let id = c.get("id").map(|v| match v {
                        Value::Number(n) => n.to_string(),
                        Value::String(s) => s.clone(),
                        _ => String::new(),
                    }).unwrap_or_default();
                    if id.is_empty() { continue; }
                    let name = c.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string();
                    map.insert(id, name);
                }
            }
        }
        map
    };

    // Import edges set for relation aggregation
    let import_edges: Vec<(String, String)> = edges.iter()
        .filter(|e| e.get("type").and_then(|v| v.as_str()) == Some("imports"))
        .filter_map(|e| {
            let s = e.get("source").and_then(|v| v.as_str())?;
            let t = e.get("target").and_then(|v| v.as_str())?;
            Some((s.to_string(), t.to_string()))
        })
        .collect();

    // Ordered community ids
    let mut comm_ids: Vec<String> = community_nodes.keys().cloned().collect();
    comm_ids.sort_by(|a, b| {
        let na = a.parse::<u64>().unwrap_or(u64::MAX);
        let nb = b.parse::<u64>().unwrap_or(u64::MAX);
        na.cmp(&nb)
    });

    const MAX_ENTITIES: usize = 8;

    let mut components: Vec<AnalysisComponent> = Vec::new();
    // comm_id -> component index (for relation lookup)
    let mut comm_to_idx: HashMap<String, usize> = HashMap::new();
    // comm_id -> set of node_ids (for relation aggregation)
    let mut comp_nodes: Vec<(String, Vec<String>)> = Vec::new(); // (comm_id, nodes)

    for comm_id in &comm_ids {
        let members = match community_nodes.get(comm_id) {
            Some(m) if !m.is_empty() => m.clone(),
            _ => continue,
        };
        let comm_name = communities.get(comm_id).cloned().unwrap_or_else(|| format!("Module {}", comm_id));

        // Heuristic description from the top-degree file
        let description = {
            let top_node_id = members.first().map(|s| s.as_str()).unwrap_or("");
            let top_path = node_paths.get(top_node_id).cloned().unwrap_or_default();
            heuristic_description(project_root, &top_path, members.len(), &comm_name)
        };

        // key_entities: top MAX_ENTITIES files by degree
        let key_entities: Vec<KeyEntity> = members.iter().take(MAX_ENTITIES).filter_map(|node_id| {
            let rel_path = node_paths.get(node_id)?;
            if rel_path.is_empty() { return None; }
            Some(KeyEntity {
                reference_file: rel_path.clone(),
                reference_start_line: 1,
                reference_end_line: 1,
            })
        }).collect();

        let idx = components.len();
        comm_to_idx.insert(comm_id.clone(), idx);
        comp_nodes.push((comm_id.clone(), members.clone()));

        components.push(AnalysisComponent {
            component_id: Value::String(comm_id.clone()),
            name: comm_name,
            description,
            key_entities,
        });
    }

    // Build relations: aggregate imports between communities
    // Count cross-community import edges
    let mut cross: HashMap<(String, String), usize> = HashMap::new();
    for (src, tgt) in &import_edges {
        let sc = node_community.get(src).cloned();
        let tc = node_community.get(tgt).cloned();
        if let (Some(sc), Some(tc)) = (sc, tc) {
            if sc != tc {
                *cross.entry((sc, tc)).or_insert(0) += 1;
            }
        }
    }

    let mut components_relations: Vec<AnalysisRelation> = Vec::new();
    for ((src_comm, dst_comm), count) in &cross {
        // Only emit if both communities are in our component list
        if comm_to_idx.contains_key(src_comm) && comm_to_idx.contains_key(dst_comm) {
            let src_name = components.iter().find(|c| c.component_id == Value::String(src_comm.clone())).map(|c| c.name.clone());
            let dst_name = components.iter().find(|c| c.component_id == Value::String(dst_comm.clone())).map(|c| c.name.clone());
            components_relations.push(AnalysisRelation {
                src_id: Value::String(src_comm.clone()),
                dst_id: Value::String(dst_comm.clone()),
                src_name,
                dst_name,
                relation: format!("imports (x{})", count),
            });
        }
    }

    Ok(Analysis { components, components_relations })
}

/// Heuristic description for a community/module component.
fn heuristic_description(project_root: &Path, top_path: &str, member_count: usize, module_name: &str) -> String {
    if !top_path.is_empty() {
        let full = project_root.join(top_path);
        // Try manifest in same directory
        if let Some(dir) = full.parent() {
            for manifest in &["package.json", "Cargo.toml", "pyproject.toml", "go.mod"] {
                let mp = dir.join(manifest);
                if let Ok(content) = fs::read_to_string(&mp) {
                    if let Some(desc) = extract_manifest_description(&content, manifest) {
                        return truncate(&desc, 200);
                    }
                }
            }
            // Try README
            for readme in &["README.md", "readme.md", "README.txt", "README"] {
                let rp = dir.join(readme);
                if let Ok(content) = fs::read_to_string(&rp) {
                    if let Some(summary) = extract_readme_summary(&content) {
                        return truncate(&summary, 200);
                    }
                }
            }
        }
    }
    format!("Módulo '{}' — {} archivos", module_name, member_count)
}

fn extract_manifest_description(content: &str, filename: &str) -> Option<String> {
    let name_lc = filename.to_lowercase();
    if name_lc == "package.json" || name_lc.ends_with(".json") {
        let v: Value = serde_json::from_str(content).ok()?;
        return v.get("description").and_then(|d| d.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string());
    }
    if name_lc.ends_with(".toml") {
        for line in content.lines() {
            let t = line.trim();
            if let Some(rest) = t.strip_prefix("description") {
                if let Some(eq) = rest.find('=') {
                    let val = rest[eq+1..].trim().trim_matches('"').trim_matches('\'');
                    if !val.is_empty() { return Some(val.to_string()); }
                }
            }
        }
    }
    None
}

fn extract_readme_summary(content: &str) -> Option<String> {
    let mut past_h1 = false;
    let mut buf = String::new();
    for line in content.lines() {
        let t = line.trim();
        if t.is_empty() {
            if past_h1 && !buf.is_empty() { break; }
            continue;
        }
        if t.starts_with("# ") { past_h1 = true; continue; }
        if past_h1 { if !buf.is_empty() { buf.push(' '); } buf.push_str(t); }
    }
    if buf.is_empty() {
        for line in content.lines() {
            let t = line.trim();
            if t.starts_with("# ") { break; }
            if !t.is_empty() && !t.starts_with("<!--") { buf.push_str(t); break; }
        }
    }
    if buf.is_empty() { None } else { Some(buf) }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max { s.to_string() } else { format!("{}…", &s[..max]) }
}

// ─────────────────────────────────────────────────────────────
// LLM enrichment (optional, BYOK)
// ─────────────────────────────────────────────────────────────

/// Try to enrich the analysis with LLM-written Spanish descriptions.
/// On any failure (no key, network error, bad JSON) → returns Err but leaves
/// `analysis` unchanged (caller keeps static). NEVER panics.
async fn try_enrich_analysis(analysis: &mut Analysis, graph_json: &str) -> Result<(), String> {
    use crate::chat;

    let status = chat::api_key_status();
    if !status.configured {
        return Err("NO_API_KEY: no key configured".to_string());
    }

    // Build compact context
    let context = build_enrich_context(analysis, graph_json);

    let prompt = format!(
        "Eres un arquitecto de software. Analiza estos componentes y reescribe en ESPAÑOL sus \
         nombres y descripciones de forma clara y profesional. \
         Responde ÚNICAMENTE con JSON estricto con esta estructura:\n\
         {{\"components\":[{{\"component_id\":\"<id>\",\"name\":\"<nombre>\",\"description\":\"<2-3 frases>\"}}]}}\n\n\
         COMPONENTES:\n{context}"
    );

    let answer = chat::ask_claude(&prompt, graph_json).await
        .map_err(|e| format!("LLM call failed: {}", e))?;

    // Extract and apply — best-effort
    let json_str = extract_json_block(&answer).unwrap_or(answer.clone());
    let v: Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("LLM returned non-JSON: {} — raw: {:.200}", e, answer))?;

    if let Some(comps_arr) = v.get("components").and_then(|c| c.as_array()) {
        for c_val in comps_arr {
            let cid_str = c_val.get("component_id").and_then(|v| v.as_str()).unwrap_or("");
            if let Some(comp) = analysis.components.iter_mut()
                .find(|c| c.component_id == Value::String(cid_str.to_string()))
            {
                if let Some(name) = c_val.get("name").and_then(|v| v.as_str()) {
                    if !name.is_empty() { comp.name = name.to_string(); }
                }
                if let Some(desc) = c_val.get("description").and_then(|v| v.as_str()) {
                    if !desc.is_empty() { comp.description = desc.to_string(); }
                }
            }
        }
    }

    Ok(())
}

fn build_enrich_context(analysis: &Analysis, graph_json: &str) -> String {
    let mut lines = Vec::new();
    let node_count = serde_json::from_str::<Value>(graph_json)
        .ok()
        .and_then(|v| v.get("nodes").and_then(|n| n.as_array()).map(|a| a.len()))
        .unwrap_or(0);
    lines.push(format!("Nodos totales: {}", node_count));
    for c in &analysis.components {
        let paths: Vec<String> = c.key_entities.iter().map(|e| e.reference_file.clone()).collect();
        lines.push(format!(
            "ID={} name={} files=[{}]",
            serde_json::to_string(&c.component_id).unwrap_or_default(),
            c.name,
            paths.join(", ")
        ));
    }
    lines.join("\n")
}

fn extract_json_block(s: &str) -> Option<String> {
    // Try to find ```json ... ``` or ``` ... ``` or first { ... }
    if let Some(start) = s.find("```json") {
        let after = &s[start + 7..];
        if let Some(end) = after.find("```") {
            return Some(after[..end].trim().to_string());
        }
    }
    if let Some(start) = s.find("```") {
        let after = &s[start + 3..];
        if let Some(end) = after.find("```") {
            return Some(after[..end].trim().to_string());
        }
    }
    // Try first { to last }
    if let (Some(start), Some(end)) = (s.find('{'), s.rfind('}')) {
        if start < end {
            return Some(s[start..=end].to_string());
        }
    }
    None
}

// ─────────────────────────────────────────────────────────────
// read_project_file — path-traversal-safe file reader
// ─────────────────────────────────────────────────────────────

/// Read a file relative to `project_root` for the code viewer.
///
/// Security contract (mirrors arch.js lines 53-65):
///   - Resolves the path and checks it starts with root + sep (blocks traversal).
///   - Maximum 512 KB.
///   - Read-only.
pub fn read_project_file(project_root: &str, rel_path: &str) -> Result<String, String> {
    let root = Path::new(project_root)
        .canonicalize()
        .map_err(|e| format!("Cannot canonicalize root: {}", e))?;

    // Resolve relative to root. Use join + canonicalize; if the path doesn't
    // exist yet, we resolve manually to still block traversal.
    let candidate = root.join(rel_path);
    let abs = candidate
        .canonicalize()
        .map_err(|_| format!("File not found: {}", rel_path))?;

    // Traversal guard: abs must start with root + separator.
    // This blocks ../ sequences AND symlinks that escape the root.
    let root_str = root.to_string_lossy().to_string();
    let abs_str = abs.to_string_lossy().to_string();
    let prefix = format!("{}{}", root_str, MAIN_SEPARATOR);
    if abs_str != root_str && !abs_str.starts_with(&prefix) {
        return Err(format!("Access denied: path outside project root: {}", rel_path));
    }

    if !abs.is_file() {
        return Err(format!("Not a file: {}", rel_path));
    }

    let meta = fs::metadata(&abs).map_err(|e| format!("Cannot stat file: {}", e))?;
    if meta.len() > 512 * 1024 {
        return Err(format!("File too large ({}B > 512KB): {}", meta.len(), rel_path));
    }

    fs::read_to_string(&abs).map_err(|e| format!("Cannot read file: {}", e))
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    // Minimal graph JSON for tests.
    // Note: hex colors use \u{23} for '#' to avoid confusing the raw-string scanner.
    fn test_graph() -> &'static str {
        r###"{
        "nodes":[
            {"id":"file:src/main.rs","label":"main.rs","type":"file","language":"rust","path":"src/main.rs","community":0},
            {"id":"file:src/lib.rs","label":"lib.rs","type":"file","language":"rust","path":"src/lib.rs","community":0},
            {"id":"file:web/app.ts","label":"app.ts","type":"file","language":"typescript","path":"web/app.ts","community":1}
        ],
        "edges":[
            {"id":"e0","source":"file:src/main.rs","target":"file:src/lib.rs","type":"imports"},
            {"id":"e1","source":"file:web/app.ts","target":"file:src/lib.rs","type":"imports"}
        ],
        "metadata":{
            "communities":{"0":{"name":"Rust Core","color":"blue","size":2},"1":{"name":"Web","color":"green","size":1}},
            "project_name":"TestProj","total_files":3,"scanned_at":"2026-07-07T00:00:00Z"
        }
    }"###
    }

    /// generate_analysis (static, no key) produces valid schema with reference_files
    /// that exist in the graph.
    #[tokio::test]
    async fn static_generate_produces_valid_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap();
        let result = generate_analysis(path, test_graph()).await;
        assert!(result.is_ok(), "generate should not fail without key: {:?}", result.err());
        let json: Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert!(json.get("components").and_then(|c| c.as_array()).is_some(), "components array required");
        assert!(json.get("components_relations").and_then(|c| c.as_array()).is_some(), "relations array required");
        let comps = json["components"].as_array().unwrap();
        // Each component must have component_id, name, description, key_entities
        for c in comps {
            assert!(c.get("component_id").is_some(), "component_id missing");
            assert!(c.get("name").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false), "name empty");
            assert!(c.get("description").is_some(), "description missing");
            let entities = c.get("key_entities").and_then(|e| e.as_array()).unwrap();
            // reference_files must match paths from the graph
            for e in entities {
                let rf = e["reference_file"].as_str().unwrap_or("");
                assert!(!rf.is_empty(), "reference_file empty");
                // Must be a path that was in the graph
                let in_graph = test_graph().contains(rf);
                assert!(in_graph, "reference_file '{}' not from graph", rf);
            }
        }
    }

    /// Schema round-trip: can serialize then deserialize Analysis
    #[test]
    fn schema_roundtrip() {
        let a = Analysis {
            components: vec![AnalysisComponent {
                component_id: Value::String("0".to_string()),
                name: "Core".to_string(),
                description: "Core module".to_string(),
                key_entities: vec![KeyEntity {
                    reference_file: "src/main.rs".to_string(),
                    reference_start_line: 1,
                    reference_end_line: 42,
                }],
            }],
            components_relations: vec![AnalysisRelation {
                src_id: Value::String("0".to_string()),
                dst_id: Value::String("1".to_string()),
                src_name: Some("Core".to_string()),
                dst_name: None,
                relation: "imports (x3)".to_string(),
            }],
        };
        let json = serde_json::to_string(&a).unwrap();
        let a2: Analysis = serde_json::from_str(&json).unwrap();
        assert_eq!(a2.components.len(), 1);
        assert_eq!(a2.components_relations.len(), 1);
    }

    /// read_project_file blocks path traversal with ../
    #[test]
    fn traversal_blocked() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        let result = read_project_file(root, "../../etc/passwd");
        assert!(result.is_err(), "traversal must be blocked");
        let msg = result.unwrap_err();
        assert!(msg.contains("denied") || msg.contains("not found") || msg.contains("outside"),
            "unexpected error: {}", msg);
    }

    /// read_project_file blocks Windows-style traversal
    #[test]
    fn traversal_blocked_windows_style() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        let result = read_project_file(root, r"..\..\..\Windows\System32\drivers\etc\hosts");
        assert!(result.is_err(), "Windows traversal must be blocked: {:?}", result.ok());
    }

    /// read_project_file reads a real file correctly
    #[test]
    fn read_file_ok() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("hello.txt");
        let mut f = fs::File::create(&file_path).unwrap();
        writeln!(f, "Hello, world!").unwrap();
        let content = read_project_file(dir.path().to_str().unwrap(), "hello.txt").unwrap();
        assert!(content.contains("Hello, world!"));
    }

    /// get_analysis prefers .codeboarding/ over graphify-out/
    #[test]
    fn get_analysis_priority() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        // Create graphify-out/analysis.json
        fs::create_dir_all(root.join("graphify-out")).unwrap();
        fs::write(root.join("graphify-out").join("analysis.json"), r#"{"components":[],"components_relations":[],"_source":"app"}"#).unwrap();

        // Without .codeboarding — should read graphify-out
        let r = get_analysis(root.to_str().unwrap(), None);
        assert!(r.is_some());
        assert!(r.as_ref().unwrap().contains("app"));

        // With .codeboarding — should prefer it
        fs::create_dir_all(root.join(".codeboarding")).unwrap();
        fs::write(root.join(".codeboarding").join("analysis.json"), r#"{"components":[],"components_relations":[],"_source":"codeboarding"}"#).unwrap();
        let r2 = get_analysis(root.to_str().unwrap(), None);
        assert!(r2.is_some());
        assert!(r2.as_ref().unwrap().contains("codeboarding"), "should prefer .codeboarding: {:?}", r2);
    }

    /// .codeboarding dir must be treated as ignored by is_ignored_path
    #[test]
    fn codeboarding_is_in_ignore_dirs() {
        use crate::indexer;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert!(
            indexer::is_ignored_path(&root.join(".codeboarding").join("analysis.json"), root),
            ".codeboarding/analysis.json must be ignored"
        );
        assert!(
            indexer::is_ignored_path(&root.join(".codeboarding"), root),
            ".codeboarding must be ignored"
        );
        // normal files must NOT be ignored
        assert!(
            !indexer::is_ignored_path(&root.join("src").join("main.rs"), root),
            "src/main.rs must NOT be ignored"
        );
    }

    /// generate_analysis without key does NOT return Err (static fallback works)
    #[tokio::test]
    async fn no_key_does_not_fail() {
        // Regardless of whether a key is configured, generate_analysis must return Ok
        // (it only TRIES LLM, never fails on missing key).
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap();
        let result = generate_analysis(path, test_graph()).await;
        assert!(result.is_ok(), "static fallback must always succeed: {:?}", result.err());
    }

    // ── Merge tests ─────────────────────────────────────────────────────────────

    /// Graph with 2-component imports: stored analysis has 0 relations → merge
    /// must produce >=1 relation.
    #[test]
    fn merge_produces_relation_when_zero_stored() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        // Analysis with 2 components, each referencing 1 file, 0 relations
        let analysis_json = r#"{
            "components": [
                {
                    "component_id": "0",
                    "name": "Rust Core",
                    "description": "Core",
                    "key_entities": [{"reference_file":"src/main.rs","reference_start_line":1,"reference_end_line":1}]
                },
                {
                    "component_id": "1",
                    "name": "Web",
                    "description": "Web",
                    "key_entities": [{"reference_file":"web/app.ts","reference_start_line":1,"reference_end_line":1}]
                }
            ],
            "components_relations": []
        }"#;

        // Graph: web/app.ts imports src/main.rs (cross-component edge)
        let graph_json = r#"{
            "nodes":[
                {"id":"n1","type":"file","path":"src/main.rs","community":0},
                {"id":"n2","type":"file","path":"web/app.ts","community":1}
            ],
            "edges":[
                {"id":"e0","source":"n2","target":"n1","type":"imports"}
            ],
            "metadata":{}
        }"#;

        fs::create_dir_all(root.join(".codeboarding")).unwrap();
        fs::write(root.join(".codeboarding").join("analysis.json"), analysis_json).unwrap();

        let result = get_analysis(root.to_str().unwrap(), Some(graph_json));
        assert!(result.is_some(), "should return Some");
        let val: Value = serde_json::from_str(&result.unwrap()).unwrap();
        let rels = val["components_relations"].as_array().unwrap();
        assert!(rels.len() >= 1, "merge must produce >=1 relation, got 0");
    }

    /// Analysis already has >=2 relations → get_analysis must NOT touch them
    /// (no extra merge, returned JSON unchanged for relations field).
    #[test]
    fn no_merge_when_two_or_more_relations_stored() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        let analysis_json = r#"{
            "components": [
                {
                    "component_id": "0", "name": "A", "description": "A",
                    "key_entities": [{"reference_file":"a.rs","reference_start_line":1,"reference_end_line":1}]
                },
                {
                    "component_id": "1", "name": "B", "description": "B",
                    "key_entities": [{"reference_file":"b.rs","reference_start_line":1,"reference_end_line":1}]
                }
            ],
            "components_relations": [
                {"src_id":"0","dst_id":"1","relation":"imports (x2)"},
                {"src_id":"1","dst_id":"0","relation":"imports (x1)"}
            ]
        }"#;

        let graph_json = r#"{
            "nodes":[
                {"id":"n1","type":"file","path":"a.rs","community":0},
                {"id":"n2","type":"file","path":"b.rs","community":1}
            ],
            "edges":[{"id":"e0","source":"n1","target":"n2","type":"imports"}],
            "metadata":{}
        }"#;

        fs::create_dir_all(root.join(".codeboarding")).unwrap();
        fs::write(root.join(".codeboarding").join("analysis.json"), analysis_json).unwrap();

        let result = get_analysis(root.to_str().unwrap(), Some(graph_json));
        assert!(result.is_some());
        let val: Value = serde_json::from_str(&result.unwrap()).unwrap();
        let rels = val["components_relations"].as_array().unwrap();
        // Must stay exactly 2 — no extra merge
        assert_eq!(rels.len(), 2, "relations must remain 2 when already >=2, got {}", rels.len());
    }

    /// No graph supplied → response is identical to what is stored on disk.
    #[test]
    fn no_graph_returns_raw_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        let analysis_json = r#"{"components":[],"components_relations":[],"_marker":"intact"}"#;
        fs::create_dir_all(root.join(".codeboarding")).unwrap();
        fs::write(root.join(".codeboarding").join("analysis.json"), analysis_json).unwrap();

        let result = get_analysis(root.to_str().unwrap(), None);
        assert!(result.is_some(), "should return Some even without graph");
        let s = result.unwrap();
        // The raw string must contain our marker — no transformation applied
        assert!(s.contains("intact"), "content must be returned as-is when no graph: got {:?}", s);
    }
}
