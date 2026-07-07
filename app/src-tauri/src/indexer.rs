use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct IndexedGraph {
    pub nodes: Vec<IndexedNode>,
    pub edges: Vec<IndexedEdge>,
    pub metadata: GraphMetadata,
}

#[derive(Serialize, Clone)]
pub struct IndexedNode {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub language: Option<String>,
    pub path: Option<String>,
    pub lines: Option<u32>,
    pub size_bytes: Option<u64>,
    pub community: Option<u32>,
    #[serde(rename = "communityName")]
    pub community_name: Option<String>,
    pub exported: Option<bool>,
}

#[derive(Serialize, Clone)]
pub struct IndexedEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub edge_type: String,
    pub weight: Option<f32>,
}

#[derive(Serialize, Clone)]
pub struct GraphMetadata {
    pub communities: HashMap<String, CommunityMeta>,
    pub project_name: String,
    pub total_files: u32,
    pub scanned_at: String,
}

#[derive(Serialize, Clone)]
pub struct CommunityMeta {
    pub name: String,
    pub color: String,
    pub size: u32,
}

// Dirs to skip (case-insensitive comparison)
const IGNORE_DIRS: &[&str] = &[
    "node_modules", ".git", ".next", ".nuxt", "dist", "target",
    "__pycache__", ".venv", "venv", ".cache", ".turbo", "vendor", "coverage",
    ".idea", ".vscode", ".pytest_cache", ".mypy_cache",
    ".parcel-cache", ".gradle", ".terraform", "bower_components",
    ".pnpm-store", ".svelte-kit", ".output", ".vercel",
    // Windows system/profile dirs
    "appdata", "application data", ".npm", ".cargo", ".rustup", ".local",
    ".conda", ".docker", ".kube", ".android",
    "programdata", "program files", "program files (x86)", "windows",
    "$recycle.bin", "system volume information",
    // Our own output
    ".brain", ".claude", "graphify-out",
    // CodeBoarding external analysis — must not trigger re-index loop when CI/CodeBoarding writes here
    ".codeboarding",
];

const MAX_FILES: usize = 50_000;
const MAX_DEPTH: usize = 20;

const COMMUNITY_COLORS: &[&str] = &[
    "#2563eb", "#16a34a", "#d97706", "#dc2626", "#9333ea",
    "#ea580c", "#0d9488", "#db2777", "#0284c7", "#65a30d",
    "#7c3aed", "#059669", "#ca8a04", "#e11d48", "#4f46e5",
];

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum FileCategory {
    Code,
    Document,
    Data,
    Config,
    Asset,
    Other,
}

fn classify_extension(ext: &str) -> (FileCategory, &'static str) {
    match ext.to_lowercase().as_str() {
        // Code
        "ts" | "tsx" => (FileCategory::Code, "typescript"),
        "js" | "jsx" | "mjs" | "cjs" => (FileCategory::Code, "javascript"),
        "py" | "pyw" => (FileCategory::Code, "python"),
        "rs" => (FileCategory::Code, "rust"),
        "go" => (FileCategory::Code, "go"),
        "java" | "kt" | "kts" => (FileCategory::Code, "java"),
        "cs" => (FileCategory::Code, "csharp"),
        "cpp" | "cc" | "cxx" | "hpp" | "h" | "c" => (FileCategory::Code, "cpp"),
        "swift" => (FileCategory::Code, "swift"),
        "dart" => (FileCategory::Code, "dart"),
        "rb" | "erb" => (FileCategory::Code, "ruby"),
        "php" => (FileCategory::Code, "php"),
        "vue" | "svelte" => (FileCategory::Code, "javascript"),
        "lua" => (FileCategory::Code, "lua"),
        "r" => (FileCategory::Code, "r"),
        "scala" => (FileCategory::Code, "scala"),
        "ex" | "exs" => (FileCategory::Code, "elixir"),
        "zig" => (FileCategory::Code, "zig"),
        "sh" | "bash" | "zsh" | "fish" => (FileCategory::Code, "shell"),
        "ps1" | "psm1" | "psd1" => (FileCategory::Code, "powershell"),
        "bat" | "cmd" => (FileCategory::Code, "batch"),
        "sql" => (FileCategory::Code, "sql"),
        "css" | "scss" | "less" | "sass" => (FileCategory::Code, "css"),
        "html" | "htm" => (FileCategory::Code, "html"),

        // Documents
        "md" | "markdown" => (FileCategory::Document, "markdown"),
        "txt" | "text" => (FileCategory::Document, "text"),
        "pdf" => (FileCategory::Document, "pdf"),
        "doc" | "docx" => (FileCategory::Document, "word"),
        "rtf" => (FileCategory::Document, "rtf"),
        "odt" => (FileCategory::Document, "opendocument"),
        "tex" | "latex" => (FileCategory::Document, "latex"),
        "rst" => (FileCategory::Document, "restructuredtext"),
        "adoc" | "asciidoc" => (FileCategory::Document, "asciidoc"),
        "log" => (FileCategory::Document, "log"),

        // Data
        "json" => (FileCategory::Data, "json"),
        "jsonl" | "ndjson" => (FileCategory::Data, "jsonl"),
        "csv" | "tsv" => (FileCategory::Data, "csv"),
        "xml" => (FileCategory::Data, "xml"),
        "yaml" | "yml" => (FileCategory::Data, "yaml"),
        "xlsx" | "xls" => (FileCategory::Data, "excel"),
        "parquet" => (FileCategory::Data, "parquet"),
        "sqlite" | "db" | "sqlite3" => (FileCategory::Data, "database"),
        "graphql" | "gql" => (FileCategory::Data, "graphql"),
        "proto" => (FileCategory::Data, "protobuf"),

        // Config
        "toml" => (FileCategory::Config, "toml"),
        "ini" | "cfg" => (FileCategory::Config, "ini"),
        "conf" => (FileCategory::Config, "conf"),
        "env" => (FileCategory::Config, "env"),
        "properties" => (FileCategory::Config, "properties"),
        "editorconfig" => (FileCategory::Config, "editorconfig"),
        "lock" => (FileCategory::Config, "lockfile"),

        // Assets
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "tiff" => (FileCategory::Asset, "image"),
        "svg" => (FileCategory::Asset, "svg"),
        "mp4" | "avi" | "mov" | "mkv" | "webm" => (FileCategory::Asset, "video"),
        "mp3" | "wav" | "ogg" | "flac" | "aac" => (FileCategory::Asset, "audio"),
        "woff" | "woff2" | "ttf" | "otf" | "eot" => (FileCategory::Asset, "font"),
        "zip" | "tar" | "gz" | "7z" | "rar" | "bz2" => (FileCategory::Asset, "archive"),

        _ => (FileCategory::Other, "unknown"),
    }
}

fn category_to_node_type(cat: FileCategory) -> &'static str {
    match cat {
        FileCategory::Code => "file",
        FileCategory::Document => "document",
        FileCategory::Data => "data",
        FileCategory::Config => "config",
        FileCategory::Asset => "asset",
        FileCategory::Other => "file",
    }
}

fn should_ignore(name: &str) -> bool {
    let lower = name.to_lowercase();
    IGNORE_DIRS.iter().any(|d| *d == lower)
}

/// Database file suffixes that must NEVER trigger a re-index.
/// M3 will write `graphify-out/history.db` (+ SQLite WAL/SHM sidecars).
/// The watcher observes the whole folder, so a change to any of these files
/// could otherwise start an infinite re-index loop (index -> write db ->
/// db change event -> index -> ...). Excluded here as a single source of truth.
const IGNORE_FILE_SUFFIXES: &[&str] = &[".db", ".db-wal", ".db-shm", ".sqlite", ".sqlite3"];

/// Shared exclusion filter used by BOTH the indexer walk and the live watcher.
/// Returns true if a filesystem path should be ignored (not indexed / not a
/// re-index trigger). A path is ignored if ANY of its components is an ignored
/// directory (e.g. `graphify-out`, `node_modules`, `.git`, `dist`, `target`)
/// or if the final filename is a hidden dir or a database file.
///
/// `graphify-out` is excluded to avoid an INFINITE RE-INDEX LOOP: the indexer
/// writes its output (graph.json, and later history.db) into `graphify-out/`,
/// so observing that directory would make every index trigger another index.
pub fn is_ignored_path(path: &Path, root: &Path) -> bool {
    // Any ignored directory anywhere in the relative path -> ignore.
    let rel = path.strip_prefix(root).unwrap_or(path);
    for comp in rel.components() {
        if let std::path::Component::Normal(os) = comp {
            let name = os.to_string_lossy().to_lowercase();
            if IGNORE_DIRS.iter().any(|d| *d == name) {
                return true;
            }
            // Hidden directories/files (except we still index some dotfiles by
            // name inside the walk; for the WATCHER a change to a dot-dir is noise).
            if name.starts_with('.') && name != ".gitignore" && name != ".env" {
                // Only treat as ignored if it's clearly a directory-style dotpath
                // segment that isn't the final known-config file. Keep it simple:
                // ignore any dot-prefixed path segment that is itself a directory.
                // (Final dotfiles that ARE known configs are still handled by the
                // indexer's own logic; the watcher re-indexes the whole folder
                // regardless, so a false-ignore of one dotfile event is harmless.)
            }
        }
    }

    // Database / sqlite sidecar files -> never a re-index trigger.
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        let lower = name.to_lowercase();
        if IGNORE_FILE_SUFFIXES.iter().any(|suf| lower.ends_with(suf)) {
            return true;
        }
    }

    false
}

// Known config filenames without extension
fn is_known_config_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    matches!(lower.as_str(),
        "dockerfile" | "makefile" | "rakefile" | "gemfile" | "procfile" |
        ".gitignore" | ".gitattributes" | ".dockerignore" | ".npmignore" |
        ".eslintrc" | ".prettierrc" | ".babelrc" | ".browserslistrc" |
        ".editorconfig" | ".env" | ".env.local" | ".env.production" |
        "license" | "licence" | "readme" | "changelog" | "contributing" |
        "cargo.toml" | "cargo.lock" | "package.json" | "package-lock.json" |
        "tsconfig.json" | "pyproject.toml" | "setup.py" | "setup.cfg" |
        "go.mod" | "go.sum" | "requirements.txt" | "pipfile" |
        "composer.json" | "pom.xml" | "build.gradle" |
        "flake.nix" | "flake.lock" | "justfile" | "taskfile.yml"
    )
}

struct ScannedFile {
    path: PathBuf,
    rel_path: String,
    category: FileCategory,
    format: String,
    size_bytes: u64,
}

struct CodeAnalysis {
    lines: u32,
    imports: Vec<String>,
    exports: Vec<String>,
    functions: Vec<String>,
    classes: Vec<String>,
}

fn collect_all_files(root: &Path) -> Vec<ScannedFile> {
    let mut files = Vec::new();
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];

    while let Some((dir, depth)) = stack.pop() {
        if depth > MAX_DEPTH || files.len() >= MAX_FILES {
            break;
        }

        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            if files.len() >= MAX_FILES {
                break;
            }

            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden dirs (except .git-related config files)
            if name.starts_with('.') && path.is_dir() {
                continue;
            }

            if path.is_dir() {
                if !should_ignore(&name) {
                    stack.push((path, depth + 1));
                }
                continue;
            }

            if !path.is_file() {
                continue;
            }

            let rel_path = match path.strip_prefix(root) {
                Ok(r) => r.to_string_lossy().to_string().replace('\\', "/"),
                Err(_) => continue,
            };

            let size_bytes = path.metadata().map(|m| m.len()).unwrap_or(0);

            // Skip very large files (>10MB)
            if size_bytes > 10_000_000 {
                continue;
            }

            // Classify by extension
            let (category, format) = if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                let (cat, fmt) = classify_extension(ext);
                if cat == FileCategory::Other {
                    // Check if it's a known config file by name
                    if is_known_config_file(&name) {
                        (FileCategory::Config, "config")
                    } else {
                        continue; // Skip truly unknown files (.exe, .dll, etc.)
                    }
                } else {
                    (cat, fmt)
                }
            } else {
                // No extension — check known filenames
                if is_known_config_file(&name) {
                    (FileCategory::Config, "config")
                } else if name.to_lowercase() == "readme" || name.to_lowercase() == "license" {
                    (FileCategory::Document, "text")
                } else {
                    continue;
                }
            };

            files.push(ScannedFile {
                path,
                rel_path,
                category,
                format: format.to_string(),
                size_bytes,
            });
        }
    }

    files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    files
}

fn analyze_code(path: &Path, ext: &str) -> Option<CodeAnalysis> {
    let content = fs::read_to_string(path).ok()?;
    if content.len() > 500_000 {
        return Some(CodeAnalysis {
            lines: content.lines().count() as u32,
            imports: vec![], exports: vec![], functions: vec![], classes: vec![],
        });
    }

    let lines = content.lines().count() as u32;

    let imports = match ext {
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "vue" | "svelte" => extract_imports_ts(&content),
        "py" | "pyw" => extract_imports_python(&content),
        "rs" => extract_imports_rust(&content),
        "go" => extract_imports_go(&content),
        "cs" => extract_imports_csharp(&content),
        _ => vec![],
    };

    let exports = match ext {
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" => extract_exports_ts(&content),
        _ => vec![],
    };

    let functions = match ext {
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "vue" | "svelte" => extract_functions_ts(&content),
        "py" | "pyw" => extract_functions_python(&content),
        "rs" => extract_functions_rust(&content),
        "cs" => extract_functions_csharp(&content),
        _ => vec![],
    };

    let classes = match ext {
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" => extract_classes_ts(&content),
        "py" | "pyw" => extract_classes_python(&content),
        "cs" => extract_classes_csharp(&content),
        _ => vec![],
    };

    Some(CodeAnalysis { lines, imports, exports, functions, classes })
}

fn count_lines_for_text(path: &Path) -> Option<u32> {
    let content = fs::read_to_string(path).ok()?;
    Some(content.lines().count() as u32)
}

// --- Import/export/function extractors (unchanged) ---

fn extract_imports_ts(content: &str) -> Vec<String> {
    let mut imports = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("import ") {
            if let Some(from_pos) = trimmed.find(" from ") {
                let rest = &trimmed[from_pos + 6..];
                let cleaned = rest.trim().trim_end_matches(';').trim_matches('\'').trim_matches('"');
                if !cleaned.is_empty() {
                    imports.push(cleaned.to_string());
                }
            }
        }
        if let Some(req_pos) = trimmed.find("require(") {
            let rest = &trimmed[req_pos + 8..];
            if let Some(end) = rest.find(')') {
                let module = rest[..end].trim_matches('\'').trim_matches('"');
                if !module.is_empty() {
                    imports.push(module.to_string());
                }
            }
        }
    }
    imports
}

fn extract_imports_python(content: &str) -> Vec<String> {
    let mut imports = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("import ") {
            let module = trimmed[7..].split_whitespace().next().unwrap_or("");
            let module = module.split(" as ").next().unwrap_or(module);
            if !module.is_empty() {
                imports.push(module.to_string());
            }
        } else if trimmed.starts_with("from ") {
            if let Some(imp_pos) = trimmed.find(" import ") {
                let module = trimmed[5..imp_pos].trim();
                if !module.is_empty() {
                    imports.push(module.to_string());
                }
            }
        }
    }
    imports
}

fn extract_imports_rust(content: &str) -> Vec<String> {
    let mut imports = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("use ") {
            let rest = trimmed[4..].trim_end_matches(';');
            if let Some(first) = rest.split("::").next() {
                if !first.is_empty() && first != "std" && first != "core" && first != "alloc" {
                    imports.push(first.to_string());
                }
            }
        }
        if trimmed.starts_with("mod ") && !trimmed.contains('{') {
            let module = trimmed[4..].trim_end_matches(';').trim();
            if !module.is_empty() {
                imports.push(module.to_string());
            }
        }
    }
    imports
}

fn extract_imports_go(content: &str) -> Vec<String> {
    let mut imports = Vec::new();
    let mut in_import_block = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "import (" {
            in_import_block = true;
            continue;
        }
        if in_import_block {
            if trimmed == ")" {
                in_import_block = false;
                continue;
            }
            let cleaned = trimmed.trim_matches('"').trim();
            if !cleaned.is_empty() {
                imports.push(cleaned.to_string());
            }
        } else if trimmed.starts_with("import \"") {
            let module = trimmed[8..].trim_end_matches('"');
            if !module.is_empty() {
                imports.push(module.to_string());
            }
        }
    }
    imports
}

fn extract_exports_ts(content: &str) -> Vec<String> {
    let mut exports = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("export ") { continue; }

        if trimmed.starts_with("export default ") {
            exports.push("default".to_string());
        } else if trimmed.starts_with("export function ") || trimmed.starts_with("export async function ") {
            let rest = if trimmed.starts_with("export async function ") { &trimmed[22..] } else { &trimmed[16..] };
            if let Some(end) = rest.find(|c: char| c == '(' || c == '<' || c == ' ') {
                let name = &rest[..end];
                if !name.is_empty() { exports.push(name.to_string()); }
            }
        } else if trimmed.starts_with("export const ") || trimmed.starts_with("export let ") || trimmed.starts_with("export var ") {
            let start = if trimmed.starts_with("export const ") { 13 } else { 11 };
            let rest = &trimmed[start..];
            if let Some(end) = rest.find(|c: char| c == ' ' || c == '=' || c == ':' || c == ';') {
                let name = &rest[..end];
                if !name.is_empty() { exports.push(name.to_string()); }
            }
        } else if trimmed.starts_with("export class ") || trimmed.starts_with("export interface ") || trimmed.starts_with("export type ") {
            let start = if trimmed.starts_with("export class ") { 13 }
                else if trimmed.starts_with("export interface ") { 17 }
                else { 12 };
            let rest = &trimmed[start..];
            if let Some(end) = rest.find(|c: char| c == ' ' || c == '{' || c == '<' || c == '=') {
                let name = &rest[..end];
                if !name.is_empty() { exports.push(name.to_string()); }
            }
        }
    }
    exports
}

fn extract_functions_ts(content: &str) -> Vec<String> {
    let mut funcs = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        let is_func = trimmed.starts_with("function ")
            || trimmed.starts_with("export function ")
            || trimmed.starts_with("export async function ")
            || trimmed.starts_with("async function ")
            || trimmed.starts_with("export default function ");
        if is_func {
            let rest = if let Some(pos) = trimmed.find("function ") { &trimmed[pos + 9..] } else { continue };
            if let Some(end) = rest.find(|c: char| c == '(' || c == '<') {
                let name = rest[..end].trim();
                if !name.is_empty() { funcs.push(name.to_string()); }
            }
        }
        if (trimmed.starts_with("const ") || trimmed.starts_with("export const ")) && trimmed.contains("=>") {
            let start = if trimmed.starts_with("export const ") { 13 } else { 6 };
            let rest = &trimmed[start..];
            if let Some(end) = rest.find(|c: char| c == ' ' || c == '=' || c == ':') {
                let name = &rest[..end];
                if !name.is_empty() && name.chars().next().map_or(false, |c| c.is_alphabetic()) {
                    funcs.push(name.to_string());
                }
            }
        }
    }
    funcs
}

fn extract_classes_ts(content: &str) -> Vec<String> {
    let mut classes = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("class ") || trimmed.starts_with("export class ") {
            let rest = if trimmed.starts_with("export class ") { &trimmed[13..] } else { &trimmed[6..] };
            if let Some(end) = rest.find(|c: char| c == ' ' || c == '{' || c == '<') {
                let name = &rest[..end];
                if !name.is_empty() { classes.push(name.to_string()); }
            }
        }
    }
    classes
}

fn extract_functions_python(content: &str) -> Vec<String> {
    let mut funcs = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("def ") || trimmed.starts_with("async def ") {
            let rest = if trimmed.starts_with("async def ") { &trimmed[10..] } else { &trimmed[4..] };
            if let Some(end) = rest.find('(') {
                let name = rest[..end].trim();
                if !name.is_empty() && name != "__init__" { funcs.push(name.to_string()); }
            }
        }
    }
    funcs
}

fn extract_classes_python(content: &str) -> Vec<String> {
    let mut classes = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("class ") {
            let rest = &trimmed[6..];
            if let Some(end) = rest.find(|c: char| c == '(' || c == ':' || c == ' ') {
                let name = &rest[..end];
                if !name.is_empty() { classes.push(name.to_string()); }
            }
        }
    }
    classes
}

fn extract_functions_rust(content: &str) -> Vec<String> {
    let mut funcs = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.contains("fn ") {
            let fn_pos = trimmed.find("fn ").unwrap();
            let rest = &trimmed[fn_pos + 3..];
            if let Some(end) = rest.find(|c: char| c == '(' || c == '<') {
                let name = rest[..end].trim();
                if !name.is_empty() && name != "main" { funcs.push(name.to_string()); }
            }
        }
    }
    funcs
}

// --- C# extractors (same line-based style as the others) ---

fn extract_imports_csharp(content: &str) -> Vec<String> {
    let mut imports = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        // `using System.IO;` / `using static X.Y;` / `global using X;`
        // Skip using-statements (`using (var x = ...)`) and aliases keep the target.
        let rest = if let Some(r) = trimmed.strip_prefix("global using ") {
            r
        } else if let Some(r) = trimmed.strip_prefix("using static ") {
            r
        } else if let Some(r) = trimmed.strip_prefix("using ") {
            r
        } else {
            continue;
        };
        if rest.starts_with('(') {
            continue; // using-statement, not an import
        }
        // Alias form: `using Alias = Some.Namespace;` -> keep the namespace.
        let target = match rest.split_once('=') {
            Some((_, ns)) => ns,
            None => rest,
        };
        let ns = target.trim().trim_end_matches(';').trim();
        // Root namespace only, consistent with extract_imports_rust (skip System).
        if let Some(root) = ns.split('.').next() {
            if !root.is_empty() && root != "System" {
                imports.push(root.to_string());
            }
        }
    }
    imports
}

fn extract_functions_csharp(content: &str) -> Vec<String> {
    let mut funcs = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        // Heuristic: an access modifier + a `(` on the same line, not a type decl
        // and not a control-flow keyword. Covers `public void Foo(`,
        // `private static async Task<int> Bar(`, `internal string Baz(` ...
        let has_modifier = trimmed.starts_with("public ")
            || trimmed.starts_with("private ")
            || trimmed.starts_with("protected ")
            || trimmed.starts_with("internal ")
            || trimmed.starts_with("static ");
        if !has_modifier || !trimmed.contains('(') {
            continue;
        }
        if trimmed.contains(" class ") || trimmed.contains(" interface ")
            || trimmed.contains(" record ") || trimmed.contains(" struct ")
            || trimmed.contains(" enum ") || trimmed.contains(" delegate ")
            || trimmed.contains('=') && trimmed.find('=') < trimmed.find('(')
        {
            continue;
        }
        // Name = LAST identifier before the '(' (return types like `Task<int>`
        // are earlier words, so take the last word FIRST, then strip generics
        // from the method name itself: `GetName<T>` -> `GetName`).
        let head = &trimmed[..trimmed.find('(').unwrap()];
        if let Some(name) = head.split_whitespace().last() {
            let name = name.split('<').next().unwrap_or(name).trim();
            let is_ident = !name.is_empty()
                && name.chars().all(|c| c.is_alphanumeric() || c == '_')
                && name.chars().next().is_some_and(|c| c.is_alphabetic() || c == '_');
            // Skip constructors-of-keywords like `if/for/while/switch/using/catch`.
            let is_keyword = matches!(name, "if" | "for" | "foreach" | "while"
                | "switch" | "using" | "catch" | "lock" | "return" | "new");
            if is_ident && !is_keyword {
                funcs.push(name.to_string());
            }
        }
    }
    funcs
}

fn extract_classes_csharp(content: &str) -> Vec<String> {
    let mut classes = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        for kw in ["class ", "interface ", "record ", "struct "] {
            if let Some(pos) = trimmed.find(kw) {
                // Must be a declaration (start of line or after modifiers), not a
                // mention inside a comment/string — cheap check: what precedes the
                // keyword must be only modifier-ish words.
                let before = &trimmed[..pos];
                let ok_before = before.split_whitespace().all(|w| matches!(w,
                    "public" | "private" | "protected" | "internal" | "static"
                    | "abstract" | "sealed" | "partial" | "readonly" | "ref" | "new"));
                if !ok_before {
                    continue;
                }
                let rest = &trimmed[pos + kw.len()..];
                let name: String = rest
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                if !name.is_empty() {
                    classes.push(name);
                }
                break; // one declaration per line
            }
        }
    }
    classes
}

fn resolve_import(import_path: &str, source_dir: &str, file_map: &HashMap<String, String>) -> Option<String> {
    if !import_path.starts_with('.') {
        return None;
    }

    let mut parts: Vec<&str> = source_dir.split('/').filter(|s| !s.is_empty()).collect();
    for segment in import_path.split('/') {
        match segment {
            "." => {}
            ".." => { parts.pop(); }
            s => parts.push(s),
        }
    }

    let resolved = parts.join("/");

    let candidates = [
        resolved.clone(),
        format!("{}.ts", resolved), format!("{}.tsx", resolved),
        format!("{}.js", resolved), format!("{}.jsx", resolved),
        format!("{}/index.ts", resolved), format!("{}/index.tsx", resolved),
        format!("{}/index.js", resolved), format!("{}/index.jsx", resolved),
        format!("{}.py", resolved), format!("{}.rs", resolved), format!("{}.go", resolved),
    ];

    for candidate in &candidates {
        if file_map.contains_key(candidate) {
            return Some(file_map[candidate].clone());
        }
    }

    None
}

fn assign_communities(files: &[ScannedFile]) -> HashMap<String, (u32, String)> {
    let mut dir_to_community: HashMap<String, u32> = HashMap::new();
    let mut community_names: HashMap<u32, String> = HashMap::new();
    let mut next_id: u32 = 0;

    for file in files {
        let dir = if let Some(pos) = file.rel_path.rfind('/') {
            let d = &file.rel_path[..pos];
            d.split('/').next().unwrap_or(d).to_string()
        } else {
            "root".to_string()
        };

        if !dir_to_community.contains_key(&dir) {
            dir_to_community.insert(dir.clone(), next_id);
            let name = dir.split('/').last().unwrap_or(&dir).to_string();
            let display_name = match name.as_str() {
                "src" => "Source".to_string(),
                "app" => "App".to_string(),
                "components" => "Components".to_string(),
                "lib" => "Library".to_string(),
                "utils" | "helpers" => "Utilities".to_string(),
                "api" => "API".to_string(),
                "pages" | "views" => "Pages".to_string(),
                "hooks" => "Hooks".to_string(),
                "stores" | "store" => "State".to_string(),
                "types" => "Types".to_string(),
                "styles" => "Styles".to_string(),
                "tests" | "test" | "__tests__" => "Tests".to_string(),
                "docs" | "documentation" => "Docs".to_string(),
                "scripts" => "Scripts".to_string(),
                "config" | "configs" | "conf" => "Config".to_string(),
                "assets" | "images" | "img" | "media" | "static" | "public" => "Assets".to_string(),
                "data" => "Data".to_string(),
                "root" => "Root".to_string(),
                other => {
                    let mut chars = other.chars();
                    match chars.next() {
                        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
                        None => other.to_string(),
                    }
                }
            };
            community_names.insert(next_id, display_name);
            next_id += 1;
        }
    }

    let mut result = HashMap::new();
    for file in files {
        let dir = if let Some(pos) = file.rel_path.rfind('/') {
            let d = &file.rel_path[..pos];
            d.split('/').next().unwrap_or(d).to_string()
        } else {
            "root".to_string()
        };
        let id = dir_to_community[&dir];
        let name = community_names[&id].clone();
        result.insert(file.rel_path.clone(), (id, name));
    }

    result
}

const COMPACT_THRESHOLD: usize = 5000;

struct DirSummary {
    path: String,
    file_count: u32,
    total_size: u64,
    by_category: HashMap<FileCategory, u32>,
    dominant_category: FileCategory,
}

fn build_compact_graph(all_files: &[ScannedFile], project_name: &str) -> IndexedGraph {
    let mut dir_map: HashMap<String, DirSummary> = HashMap::new();

    for sf in all_files {
        let dir = if let Some(pos) = sf.rel_path.rfind('/') {
            // Use first 2 levels max for grouping
            let full_dir = &sf.rel_path[..pos];
            let parts: Vec<&str> = full_dir.split('/').collect();
            if parts.len() > 2 {
                parts[..2].join("/")
            } else {
                full_dir.to_string()
            }
        } else {
            "(root)".to_string()
        };

        let summary = dir_map.entry(dir.clone()).or_insert_with(|| DirSummary {
            path: dir.clone(),
            file_count: 0,
            total_size: 0,
            by_category: HashMap::new(),
            dominant_category: FileCategory::Other,
        });

        summary.file_count += 1;
        summary.total_size += sf.size_bytes;
        *summary.by_category.entry(sf.category).or_insert(0) += 1;
    }

    // Determine dominant category per dir
    for summary in dir_map.values_mut() {
        let mut best_cat = FileCategory::Other;
        let mut best_count = 0u32;
        for (cat, count) in &summary.by_category {
            if *count > best_count {
                best_count = *count;
                best_cat = *cat;
            }
        }
        summary.dominant_category = best_cat;
    }

    let mut nodes: Vec<IndexedNode> = Vec::new();
    let mut edges: Vec<IndexedEdge> = Vec::new();
    let mut edge_id: u32 = 0;

    let mut community_id: u32 = 0;
    let mut top_dir_to_comm: HashMap<String, u32> = HashMap::new();
    let mut community_meta: HashMap<String, CommunityMeta> = HashMap::new();

    let mut dir_list: Vec<&DirSummary> = dir_map.values().collect();
    dir_list.sort_by(|a, b| b.file_count.cmp(&a.file_count));

    for summary in &dir_list {
        let top_dir = summary.path.split('/').next().unwrap_or(&summary.path).to_string();
        let comm_id = *top_dir_to_comm.entry(top_dir.clone()).or_insert_with(|| {
            let id = community_id;
            let color_idx = (id as usize) % COMMUNITY_COLORS.len();
            let display_name = {
                let mut chars = top_dir.chars();
                match chars.next() {
                    Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
                    None => top_dir.clone(),
                }
            };
            community_meta.insert(
                id.to_string(),
                CommunityMeta {
                    name: display_name,
                    color: COMMUNITY_COLORS[color_idx].to_string(),
                    size: 0,
                },
            );
            community_id += 1;
            id
        });

        if let Some(cm) = community_meta.get_mut(&comm_id.to_string()) {
            cm.size += 1;
        }

        let node_type = category_to_node_type(summary.dominant_category);

        // Build label with file breakdown
        let mut breakdown_parts: Vec<String> = Vec::new();
        let mut cats: Vec<(FileCategory, u32)> = summary.by_category.iter().map(|(k,v)| (*k,*v)).collect();
        cats.sort_by(|a,b| b.1.cmp(&a.1));
        for (cat, count) in &cats {
            let cat_name = match cat {
                FileCategory::Code => "code",
                FileCategory::Document => "docs",
                FileCategory::Data => "data",
                FileCategory::Config => "config",
                FileCategory::Asset => "assets",
                FileCategory::Other => "other",
            };
            breakdown_parts.push(format!("{} {}", count, cat_name));
        }
        let label = format!("{} ({})",
            summary.path.split('/').last().unwrap_or(&summary.path),
            breakdown_parts.join(", ")
        );

        let node_id = format!("dir:{}", summary.path);

        nodes.push(IndexedNode {
            id: node_id,
            label,
            node_type: node_type.to_string(),
            language: None,
            path: Some(summary.path.clone()),
            lines: Some(summary.file_count),
            size_bytes: Some(summary.total_size),
            community: Some(comm_id),
            community_name: community_meta.get(&comm_id.to_string()).map(|c| c.name.clone()),
            exported: None,
        });
    }

    // Add edges between parent/child dirs
    let mut seen_edges: HashSet<(String, String)> = HashSet::new();
    for summary in &dir_list {
        let parts: Vec<&str> = summary.path.split('/').collect();
        if parts.len() > 1 {
            let parent = parts[..parts.len()-1].join("/");
            let parent_id = format!("dir:{}", parent);
            let child_id = format!("dir:{}", summary.path);

            if dir_map.contains_key(&parent) {
                let edge_key = (parent_id.clone(), child_id.clone());
                if seen_edges.insert(edge_key) {
                    edges.push(IndexedEdge {
                        id: format!("e{}", edge_id),
                        source: parent_id,
                        target: child_id,
                        edge_type: "contains".to_string(),
                        weight: Some(summary.file_count as f32),
                    });
                    edge_id += 1;
                }
            }
        }
    }

    IndexedGraph {
        nodes,
        edges,
        metadata: GraphMetadata {
            communities: community_meta,
            project_name: project_name.to_string(),
            total_files: all_files.len() as u32,
            scanned_at: chrono::Utc::now().to_rfc3339(),
        },
    }
}

pub fn index_project(root: &Path) -> Result<IndexedGraph, String> {
    let project_name = root.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Project".to_string());

    let all_files = collect_all_files(root);
    if all_files.is_empty() {
        return Err("No files found in the selected folder.".to_string());
    }

    // Large folders: compact mode (1 node per directory)
    if all_files.len() > COMPACT_THRESHOLD {
        let graph = build_compact_graph(&all_files, &project_name);

        // Best-effort write — skip silently for read-only folders (e.g. C:\Program Files)
        let out_dir = root.join("graphify-out");
        if fs::create_dir_all(&out_dir).is_ok() {
            if let Ok(json) = serde_json::to_string_pretty(&graph) {
                let _ = fs::write(out_dir.join("graph.json"), &json);
            }
        }

        return Ok(graph);
    }

    let communities = assign_communities(&all_files);

    let mut nodes: Vec<IndexedNode> = Vec::new();
    let mut edges: Vec<IndexedEdge> = Vec::new();
    let mut edge_id: u32 = 0;
    let mut seen_edges: HashSet<(String, String)> = HashSet::new();

    let mut file_map: HashMap<String, String> = HashMap::new();
    let mut code_analyses: HashMap<String, CodeAnalysis> = HashMap::new();

    for sf in &all_files {
        let node_id = format!("{}:{}", category_to_node_type(sf.category), sf.rel_path);
        file_map.insert(sf.rel_path.clone(), node_id.clone());

        let (comm_id, comm_name) = communities.get(&sf.rel_path)
            .cloned()
            .unwrap_or((0, "Root".to_string()));

        let label = sf.rel_path.split('/').last().unwrap_or(&sf.rel_path).to_string();

        let mut lines = None;

        if sf.category == FileCategory::Code {
            if let Some(ext) = sf.path.extension().and_then(|e| e.to_str()) {
                if let Some(analysis) = analyze_code(&sf.path, ext) {
                    lines = Some(analysis.lines);
                    code_analyses.insert(sf.rel_path.clone(), analysis);
                }
            }
        } else if matches!(sf.category, FileCategory::Document | FileCategory::Data | FileCategory::Config) {
            if sf.size_bytes < 1_000_000 {
                lines = count_lines_for_text(&sf.path);
            }
        }

        nodes.push(IndexedNode {
            id: node_id,
            label,
            node_type: category_to_node_type(sf.category).to_string(),
            language: Some(sf.format.clone()),
            path: Some(sf.rel_path.clone()),
            lines,
            size_bytes: Some(sf.size_bytes),
            community: Some(comm_id),
            community_name: Some(comm_name),
            exported: None,
        });
    }

    for sf in &all_files {
        if sf.category != FileCategory::Code {
            continue;
        }

        let file_node_id = file_map.get(&sf.rel_path).cloned().unwrap_or_default();
        let (comm_id, comm_name) = communities.get(&sf.rel_path)
            .cloned()
            .unwrap_or((0, "Root".to_string()));

        if let Some(analysis) = code_analyses.get(&sf.rel_path) {
            for func in &analysis.functions {
                let func_id = format!("fn:{}:{}", sf.rel_path, func);
                let exported = analysis.exports.contains(func);
                nodes.push(IndexedNode {
                    id: func_id.clone(),
                    label: func.clone(),
                    node_type: "function".to_string(),
                    language: Some(sf.format.clone()),
                    path: Some(sf.rel_path.clone()),
                    lines: None,
                    size_bytes: None,
                    community: Some(comm_id),
                    community_name: Some(comm_name.clone()),
                    exported: Some(exported),
                });

                let edge_key = (file_node_id.clone(), func_id.clone());
                if seen_edges.insert(edge_key) {
                    edges.push(IndexedEdge {
                        id: format!("e{}", edge_id),
                        source: file_node_id.clone(),
                        target: func_id,
                        edge_type: "contains".to_string(),
                        weight: Some(1.0),
                    });
                    edge_id += 1;
                }
            }

            for class in &analysis.classes {
                let class_id = format!("class:{}:{}", sf.rel_path, class);
                let exported = analysis.exports.contains(class);
                nodes.push(IndexedNode {
                    id: class_id.clone(),
                    label: class.clone(),
                    node_type: "class".to_string(),
                    language: Some(sf.format.clone()),
                    path: Some(sf.rel_path.clone()),
                    lines: None,
                    size_bytes: None,
                    community: Some(comm_id),
                    community_name: Some(comm_name.clone()),
                    exported: Some(exported),
                });

                let edge_key = (file_node_id.clone(), class_id.clone());
                if seen_edges.insert(edge_key) {
                    edges.push(IndexedEdge {
                        id: format!("e{}", edge_id),
                        source: file_node_id.clone(),
                        target: class_id,
                        edge_type: "contains".to_string(),
                        weight: Some(1.0),
                    });
                    edge_id += 1;
                }
            }

            let source_dir = if let Some(pos) = sf.rel_path.rfind('/') {
                &sf.rel_path[..pos]
            } else {
                ""
            };

            for import in &analysis.imports {
                if let Some(target_id) = resolve_import(import, source_dir, &file_map) {
                    let edge_key = (file_node_id.clone(), target_id.clone());
                    if seen_edges.insert(edge_key) {
                        edges.push(IndexedEdge {
                            id: format!("e{}", edge_id),
                            source: file_node_id.clone(),
                            target: target_id,
                            edge_type: "imports".to_string(),
                            weight: Some(1.0),
                        });
                        edge_id += 1;
                    }
                }
            }
        }
    }

    // Build community metadata
    let mut community_meta: HashMap<String, CommunityMeta> = HashMap::new();
    let mut community_counts: HashMap<u32, (String, u32)> = HashMap::new();
    for (_, (id, name)) in &communities {
        let entry = community_counts.entry(*id).or_insert_with(|| (name.clone(), 0));
        entry.1 += 1;
    }
    for (id, (name, count)) in &community_counts {
        let color_idx = (*id as usize) % COMMUNITY_COLORS.len();
        community_meta.insert(
            id.to_string(),
            CommunityMeta {
                name: name.clone(),
                color: COMMUNITY_COLORS[color_idx].to_string(),
                size: *count,
            },
        );
    }

    let total_files = all_files.len() as u32;

    let graph = IndexedGraph {
        nodes,
        edges,
        metadata: GraphMetadata {
            communities: community_meta,
            project_name,
            total_files,
            scanned_at: chrono::Utc::now().to_rfc3339(),
        },
    };

    // Best-effort write — skip silently for read-only folders (e.g. C:\Program Files)
    let out_dir = root.join("graphify-out");
    if fs::create_dir_all(&out_dir).is_ok() {
        if let Ok(json) = serde_json::to_string_pretty(&graph) {
            let _ = fs::write(out_dir.join("graph.json"), &json);
        }
    }

    Ok(graph)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> PathBuf {
        PathBuf::from(if cfg!(windows) { r"C:\proj" } else { "/proj" })
    }

    // ---- C# extractors (v2.1: C# was classified but never parsed) ----

    const CSHARP_SAMPLE: &str = r#"
using System;
using System.IO;
using MultiInstanceClaudeDesktop.Core;
using static System.Math;
global using Xunit;
using Alias = Newtonsoft.Json.Linq;

namespace Demo
{
    public sealed partial class InstanceStore
    {
        public static InstanceInfo CreateInstance(string name) { return null; }
        private async Task<int> LoadAsync() { return 0; }
        internal string GetName<T>(T x) { return ""; }
        protected void OnChange() { }
        // not methods:
        public string Name = "x";
        if (foo) { }
    }

    public interface IWidget { }
    internal record CopyResult(bool Success);
    public struct Point { }
}
"#;

    #[test]
    fn csharp_imports_extracts_root_namespaces_not_system() {
        let imports = extract_imports_csharp(CSHARP_SAMPLE);
        assert!(imports.contains(&"MultiInstanceClaudeDesktop".to_string()),
            "project namespace must be extracted, got {:?}", imports);
        assert!(imports.contains(&"Xunit".to_string()), "global using must count");
        assert!(imports.contains(&"Newtonsoft".to_string()), "alias target must count");
        assert!(!imports.iter().any(|i| i == "System"),
            "System must be skipped (like std in rust), got {:?}", imports);
        eprintln!("CSHARP-IMPORTS: PASS {:?}", imports);
    }

    #[test]
    fn csharp_functions_extracts_methods_not_fields_or_keywords() {
        let funcs = extract_functions_csharp(CSHARP_SAMPLE);
        for expected in ["CreateInstance", "LoadAsync", "GetName", "OnChange"] {
            assert!(funcs.contains(&expected.to_string()),
                "{} must be extracted, got {:?}", expected, funcs);
        }
        assert!(!funcs.contains(&"Name".to_string()), "field must NOT be a function");
        assert!(!funcs.contains(&"if".to_string()), "keywords must NOT be functions");
        eprintln!("CSHARP-FUNCTIONS: PASS {:?}", funcs);
    }

    #[test]
    fn csharp_classes_extracts_types() {
        let classes = extract_classes_csharp(CSHARP_SAMPLE);
        for expected in ["InstanceStore", "IWidget", "CopyResult", "Point"] {
            assert!(classes.contains(&expected.to_string()),
                "{} must be extracted, got {:?}", expected, classes);
        }
        eprintln!("CSHARP-CLASSES: PASS {:?}", classes);
    }

    // ---- Loop-breaker: graphify-out must ALWAYS be ignored ----
    #[test]
    fn graphify_out_is_ignored() {
        let r = root();
        assert!(is_ignored_path(&r.join("graphify-out").join("graph.json"), &r));
        assert!(is_ignored_path(&r.join("graphify-out"), &r));
        // nested deeper
        assert!(is_ignored_path(&r.join("graphify-out").join("history").join("x.json"), &r));
    }

    // ---- Loop-breaker: db sidecars (M3 history.db) must be ignored ----
    #[test]
    fn db_files_are_ignored() {
        let r = root();
        assert!(is_ignored_path(&r.join("graphify-out").join("history.db"), &r));
        assert!(is_ignored_path(&r.join("history.db"), &r));
        assert!(is_ignored_path(&r.join("history.db-wal"), &r));
        assert!(is_ignored_path(&r.join("history.db-shm"), &r));
        assert!(is_ignored_path(&r.join("data.sqlite"), &r));
        assert!(is_ignored_path(&r.join("data.sqlite3"), &r));
    }

    // ---- Noise dirs ignored ----
    #[test]
    fn noise_dirs_are_ignored() {
        let r = root();
        assert!(is_ignored_path(&r.join(".git").join("HEAD"), &r));
        assert!(is_ignored_path(&r.join("node_modules").join("react").join("index.js"), &r));
        assert!(is_ignored_path(&r.join("dist").join("bundle.js"), &r));
        assert!(is_ignored_path(&r.join("target").join("debug").join("app.exe"), &r));
    }

    // ---- Real source files are NOT ignored (must trigger re-index) ----
    #[test]
    fn real_source_files_are_not_ignored() {
        let r = root();
        assert!(!is_ignored_path(&r.join("src").join("main.rs"), &r));
        assert!(!is_ignored_path(&r.join("App.tsx"), &r));
        assert!(!is_ignored_path(&r.join("lib").join("util.py"), &r));
        // A .db substring in a normal name must NOT false-match (endswith only)
        assert!(!is_ignored_path(&r.join("dbschema.md"), &r));
    }
}
