use std::sync::{Arc, Mutex};
use std::thread;
use tiny_http::{Server, Response, Header};
use serde::{Serialize, Deserialize};

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct SharedGraph {
    pub project_name: String,
    pub project_path: String,
    pub graph_json: String,
    pub node_count: usize,
    pub edge_count: usize,
    pub community_count: usize,
}

#[derive(Clone, Serialize)]
pub struct AiHighlight {
    node_id: String,
    color: String,
    label: String,
    timestamp: String,
}

pub struct AiBridge {
    pub graph: Arc<Mutex<Option<SharedGraph>>>,
    pub highlights: Arc<Mutex<Vec<AiHighlight>>>,
    pub last_ai_ping: Arc<Mutex<Option<std::time::Instant>>>,
}

impl AiBridge {
    pub fn new() -> Self {
        AiBridge {
            graph: Arc::new(Mutex::new(None)),
            highlights: Arc::new(Mutex::new(Vec::new())),
            last_ai_ping: Arc::new(Mutex::new(None)),
        }
    }

    pub fn start(&self, port: u16) {
        let graph = self.graph.clone();
        let highlights = self.highlights.clone();
        let last_ping = self.last_ai_ping.clone();

        thread::spawn(move || {
            let addr = format!("127.0.0.1:{}", port);
            let server = match Server::http(&addr) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[AI Bridge] Failed to start on {}: {}", addr, e);
                    return;
                }
            };
            eprintln!("[AI Bridge] Listening on http://{}", addr);

            for mut request in server.incoming_requests() {
                let url = request.url().to_string();
                let method = request.method().to_string();

                let cors = Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
                let cors_headers = Header::from_bytes("Access-Control-Allow-Headers", "Content-Type").unwrap();
                let cors_methods = Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS").unwrap();
                let content_type = Header::from_bytes("Content-Type", "application/json").unwrap();

                if method == "OPTIONS" {
                    let resp = Response::empty(200)
                        .with_header(cors.clone())
                        .with_header(cors_headers)
                        .with_header(cors_methods);
                    let _ = request.respond(resp);
                    continue;
                }

                // Record AI ping
                if let Ok(mut ping) = last_ping.lock() {
                    *ping = Some(std::time::Instant::now());
                }

                let (status, body) = match (method.as_str(), url.as_str()) {
                    ("GET", "/") => {
                        (200, serde_json::json!({
                            "service": "Sypnose Registry AI Bridge",
                            "version": "1.0.0",
                            "endpoints": [
                                {"method": "GET", "path": "/status", "description": "Current project status and stats"},
                                {"method": "GET", "path": "/graph", "description": "Full graph JSON (nodes, edges, communities)"},
                                {"method": "GET", "path": "/nodes", "description": "All nodes with metadata"},
                                {"method": "GET", "path": "/edges", "description": "All edges (imports, contains)"},
                                {"method": "GET", "path": "/search?q=term", "description": "Search nodes by label or path"},
                                {"method": "GET", "path": "/node/:id", "description": "Single node detail with connections"},
                                {"method": "GET", "path": "/architecture", "description": "Project architecture summary"},
                                {"method": "POST", "path": "/highlight", "description": "Highlight a node in the UI (body: {node_id, color?, label?})"},
                                {"method": "GET", "path": "/highlights", "description": "Current highlights"},
                                {"method": "POST", "path": "/clear-highlights", "description": "Clear all highlights"},
                            ]
                        }).to_string())
                    }

                    ("GET", "/status") => {
                        let g = graph.lock().unwrap();
                        match g.as_ref() {
                            Some(sg) => (200, serde_json::json!({
                                "connected": true,
                                "project_name": sg.project_name,
                                "project_path": sg.project_path,
                                "node_count": sg.node_count,
                                "edge_count": sg.edge_count,
                                "community_count": sg.community_count,
                            }).to_string()),
                            None => (200, serde_json::json!({
                                "connected": true,
                                "project_name": serde_json::Value::Null,
                                "message": "No project loaded. Open a folder in Registry first."
                            }).to_string()),
                        }
                    }

                    ("GET", "/graph") => {
                        let g = graph.lock().unwrap();
                        match g.as_ref() {
                            Some(sg) => (200, sg.graph_json.clone()),
                            None => (404, r#"{"error":"No project loaded"}"#.to_string()),
                        }
                    }

                    ("GET", "/nodes") => {
                        let g = graph.lock().unwrap();
                        match g.as_ref() {
                            Some(sg) => {
                                let parsed: serde_json::Value = serde_json::from_str(&sg.graph_json).unwrap_or_default();
                                let nodes = parsed.get("nodes").cloned().unwrap_or(serde_json::Value::Array(vec![]));
                                (200, nodes.to_string())
                            }
                            None => (404, r#"{"error":"No project loaded"}"#.to_string()),
                        }
                    }

                    ("GET", "/edges") => {
                        let g = graph.lock().unwrap();
                        match g.as_ref() {
                            Some(sg) => {
                                let parsed: serde_json::Value = serde_json::from_str(&sg.graph_json).unwrap_or_default();
                                let edges = parsed.get("edges").cloned().unwrap_or(serde_json::Value::Array(vec![]));
                                (200, edges.to_string())
                            }
                            None => (404, r#"{"error":"No project loaded"}"#.to_string()),
                        }
                    }

                    ("GET", "/architecture") => {
                        let g = graph.lock().unwrap();
                        match g.as_ref() {
                            Some(sg) => {
                                let parsed: serde_json::Value = serde_json::from_str(&sg.graph_json).unwrap_or_default();
                                let nodes = parsed.get("nodes").and_then(|n| n.as_array()).cloned().unwrap_or_default();
                                let edges = parsed.get("edges").and_then(|e| e.as_array()).cloned().unwrap_or_default();

                                // Count by type
                                let mut type_counts = std::collections::HashMap::new();
                                let mut lang_counts = std::collections::HashMap::new();
                                let mut total_lines: u64 = 0;
                                for node in &nodes {
                                    let t = node.get("type").and_then(|v| v.as_str()).unwrap_or("unknown");
                                    *type_counts.entry(t.to_string()).or_insert(0u32) += 1;
                                    if let Some(lang) = node.get("language").and_then(|v| v.as_str()) {
                                        if !lang.is_empty() {
                                            *lang_counts.entry(lang.to_string()).or_insert(0u32) += 1;
                                        }
                                    }
                                    if let Some(lines) = node.get("lines").and_then(|v| v.as_u64()) {
                                        total_lines += lines;
                                    }
                                }

                                // Count edge types
                                let mut edge_type_counts = std::collections::HashMap::new();
                                for edge in &edges {
                                    let t = edge.get("type").and_then(|v| v.as_str()).unwrap_or("unknown");
                                    *edge_type_counts.entry(t.to_string()).or_insert(0u32) += 1;
                                }

                                // Communities
                                let communities = parsed.get("metadata")
                                    .and_then(|m| m.get("communities"))
                                    .cloned()
                                    .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

                                // Top hub nodes (highest degree)
                                let mut degree_map: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
                                for edge in &edges {
                                    if let Some(src) = edge.get("source").and_then(|v| v.as_str()) {
                                        *degree_map.entry(src.to_string()).or_insert(0) += 1;
                                    }
                                    if let Some(tgt) = edge.get("target").and_then(|v| v.as_str()) {
                                        *degree_map.entry(tgt.to_string()).or_insert(0) += 1;
                                    }
                                }
                                let mut hubs: Vec<_> = degree_map.into_iter().collect();
                                hubs.sort_by(|a, b| b.1.cmp(&a.1));
                                let top_hubs: Vec<_> = hubs.into_iter().take(10).map(|(id, degree)| {
                                    let label = nodes.iter()
                                        .find(|n| n.get("id").and_then(|v| v.as_str()) == Some(&id))
                                        .and_then(|n| n.get("label").and_then(|v| v.as_str()))
                                        .unwrap_or("?");
                                    serde_json::json!({"id": id, "label": label, "connections": degree})
                                }).collect();

                                (200, serde_json::json!({
                                    "project_name": sg.project_name,
                                    "project_path": sg.project_path,
                                    "total_nodes": nodes.len(),
                                    "total_edges": edges.len(),
                                    "total_lines": total_lines,
                                    "node_types": type_counts,
                                    "languages": lang_counts,
                                    "edge_types": edge_type_counts,
                                    "communities": communities,
                                    "top_hubs": top_hubs,
                                }).to_string())
                            }
                            None => (404, r#"{"error":"No project loaded"}"#.to_string()),
                        }
                    }

                    ("GET", path) if path.starts_with("/search") => {
                        let query = url.split("q=").nth(1).unwrap_or("").to_lowercase();
                        let query = urldecode(&query);
                        let g = graph.lock().unwrap();
                        match g.as_ref() {
                            Some(sg) => {
                                let parsed: serde_json::Value = serde_json::from_str(&sg.graph_json).unwrap_or_default();
                                let nodes = parsed.get("nodes").and_then(|n| n.as_array()).cloned().unwrap_or_default();
                                let results: Vec<_> = nodes.into_iter().filter(|n| {
                                    let label = n.get("label").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
                                    let path = n.get("path").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
                                    let id = n.get("id").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
                                    label.contains(&query) || path.contains(&query) || id.contains(&query)
                                }).take(50).collect();
                                (200, serde_json::json!({"query": query, "count": results.len(), "results": results}).to_string())
                            }
                            None => (404, r#"{"error":"No project loaded"}"#.to_string()),
                        }
                    }

                    ("GET", path) if path.starts_with("/node/") => {
                        let node_id = urldecode(&path[6..]);
                        let g = graph.lock().unwrap();
                        match g.as_ref() {
                            Some(sg) => {
                                let parsed: serde_json::Value = serde_json::from_str(&sg.graph_json).unwrap_or_default();
                                let nodes = parsed.get("nodes").and_then(|n| n.as_array()).cloned().unwrap_or_default();
                                let edges = parsed.get("edges").and_then(|e| e.as_array()).cloned().unwrap_or_default();

                                let node = nodes.iter().find(|n| {
                                    n.get("id").and_then(|v| v.as_str()) == Some(&node_id)
                                });

                                match node {
                                    Some(n) => {
                                        let incoming: Vec<_> = edges.iter().filter(|e| {
                                            e.get("target").and_then(|v| v.as_str()) == Some(&node_id)
                                        }).cloned().collect();
                                        let outgoing: Vec<_> = edges.iter().filter(|e| {
                                            e.get("source").and_then(|v| v.as_str()) == Some(&node_id)
                                        }).cloned().collect();

                                        (200, serde_json::json!({
                                            "node": n,
                                            "incoming": incoming,
                                            "outgoing": outgoing,
                                            "in_degree": incoming.len(),
                                            "out_degree": outgoing.len(),
                                        }).to_string())
                                    }
                                    None => (404, serde_json::json!({"error": format!("Node '{}' not found", node_id)}).to_string()),
                                }
                            }
                            None => (404, r#"{"error":"No project loaded"}"#.to_string()),
                        }
                    }

                    ("POST", "/highlight") => {
                        let mut body = String::new();
                        let mut reader = request.as_reader();
                        let _ = std::io::Read::read_to_string(&mut reader, &mut body);
                        match serde_json::from_str::<serde_json::Value>(&body) {
                            Ok(val) => {
                                let node_id = val.get("node_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let color = val.get("color").and_then(|v| v.as_str()).unwrap_or("#ff6b00").to_string();
                                let label = val.get("label").and_then(|v| v.as_str()).unwrap_or("AI highlight").to_string();
                                if node_id.is_empty() {
                                    let resp = Response::from_string(r#"{"error":"node_id required"}"#)
                                        .with_status_code(400)
                                        .with_header(content_type)
                                        .with_header(cors);
                                    let _ = request.respond(resp);
                                    continue;
                                }
                                let h = AiHighlight {
                                    node_id: node_id.clone(),
                                    color,
                                    label,
                                    timestamp: chrono::Utc::now().to_rfc3339(),
                                };
                                let mut hl = highlights.lock().unwrap();
                                hl.retain(|x| x.node_id != node_id);
                                hl.push(h);
                                (200, serde_json::json!({"ok": true, "highlights": hl.len()}).to_string())
                            }
                            Err(e) => (400, serde_json::json!({"error": format!("Invalid JSON: {}", e)}).to_string()),
                        }
                    }

                    ("GET", "/highlights") => {
                        let hl = highlights.lock().unwrap();
                        (200, serde_json::to_string(&*hl).unwrap_or("[]".to_string()))
                    }

                    ("POST", "/clear-highlights") => {
                        let mut hl = highlights.lock().unwrap();
                        hl.clear();
                        (200, r#"{"ok": true}"#.to_string())
                    }

                    _ => {
                        (404, r#"{"error":"Not found. GET / for available endpoints."}"#.to_string())
                    }
                };

                let resp = Response::from_string(body)
                    .with_status_code(status as u16)
                    .with_header(content_type)
                    .with_header(cors);
                let _ = request.respond(resp);
            }
        });
    }

    pub fn update_graph(&self, project_name: &str, project_path: &str, json: &str, nodes: usize, edges: usize, communities: usize) {
        let mut g = self.graph.lock().unwrap();
        *g = Some(SharedGraph {
            project_name: project_name.to_string(),
            project_path: project_path.to_string(),
            graph_json: json.to_string(),
            node_count: nodes,
            edge_count: edges,
            community_count: communities,
        });
    }

    pub fn is_ai_connected(&self) -> bool {
        if let Ok(ping) = self.last_ai_ping.lock() {
            if let Some(t) = *ping {
                return t.elapsed().as_secs() < 30;
            }
        }
        false
    }
}

fn urldecode(s: &str) -> String {
    let mut result = String::new();
    let mut chars = s.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let h1 = chars.next().unwrap_or(b'0');
            let h2 = chars.next().unwrap_or(b'0');
            let hex = format!("{}{}", h1 as char, h2 as char);
            if let Ok(val) = u8::from_str_radix(&hex, 16) {
                result.push(val as char);
            }
        } else if b == b'+' {
            result.push(' ');
        } else {
            result.push(b as char);
        }
    }
    result
}
