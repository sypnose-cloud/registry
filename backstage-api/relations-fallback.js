// ============================================================================
// relations-fallback.js — deriva components_relations por análisis estático de imports
// cuando el analysis.json tiene < 2 relaciones.
//
// ESM (igual que el resto del proyecto).
// Exporta: deriveRelations(analysisPath, projectRoot)
// CLI:     node relations-fallback.js <ruta-proyecto>
// ============================================================================
import fs from 'fs';
import path from 'path';

// Extensiones de código que se leen (binarios y assets ignorados).
const SOURCE_EXTS = new Set(['.py', '.js', '.ts', '.tsx', '.rs', '.go', '.java', '.php', '.cs']);
const MAX_FILE_BYTES = 256 * 1024; // 256 KB

// ── Patrones de imports por lenguaje ─────────────────────────────────────────

/**
 * Extrae módulos importados desde el contenido de un archivo de código fuente.
 * @param {string} content
 * @param {string} ext  e.g. ".py" | ".js" | ".ts"
 * @returns {string[]}  lista de identificadores importados (nombres de módulo / fichero)
 */
function extractImports(content, ext) {
  const mods = new Set();

  if (ext === '.py') {
    // from .foo import ... | from foo.bar.baz import ...
    // Emit ALL segments so "from src.pipeline import X" also matches "pipeline"
    for (const m of content.matchAll(/^from\s+([\w.]+)\s+import/gm)) {
      const stripped = m[1].replace(/^\.+/, '');
      for (const seg of stripped.split('.')) { if (seg) mods.add(seg); }
    }
    // import foo | import foo.bar
    for (const m of content.matchAll(/^import\s+([\w.]+)/gm)) {
      const stripped = m[1].replace(/^\.+/, '');
      for (const seg of stripped.split('.')) { if (seg) mods.add(seg); }
    }
  } else if (['.js', '.ts', '.tsx'].includes(ext)) {
    // import ... from '...' | import('...')
    for (const m of content.matchAll(/(?:import\s.*?from\s+['"]|import\s*\(\s*['"])([\w./\-@]+)['"]/g)) {
      mods.add(path.basename(m[1]).replace(/\.(js|ts|tsx)$/, ''));
    }
    // require('...')
    for (const m of content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\)/g)) {
      mods.add(path.basename(m[1]).replace(/\.(js|ts|tsx)$/, ''));
    }
  } else if (ext === '.rs') {
    // use foo::bar; | mod foo;
    for (const m of content.matchAll(/^(?:use|mod)\s+([\w:]+)/gm)) {
      mods.add(m[1].split('::')[0]);
    }
  } else if (ext === '.go') {
    // import "foo/bar" | import ( "foo/bar" )
    for (const m of content.matchAll(/"([^"]+)"/g)) {
      mods.add(path.basename(m[1]));
    }
  } else if (ext === '.java') {
    // import com.foo.Bar;
    for (const m of content.matchAll(/^import\s+([\w.]+);/gm)) {
      const parts = m[1].split('.');
      mods.add(parts[parts.length - 1]);
    }
  } else if (ext === '.php') {
    // require/include '...' | use Foo\Bar
    for (const m of content.matchAll(/(?:require|include)(?:_once)?\s*['"]([^'"]+)['"]/g)) {
      mods.add(path.basename(m[1]).replace(/\.php$/, ''));
    }
    for (const m of content.matchAll(/^use\s+([\w\\]+)/gm)) {
      const parts = m[1].split('\\');
      mods.add(parts[parts.length - 1]);
    }
  } else if (ext === '.cs') {
    // using Foo.Bar;
    for (const m of content.matchAll(/^using\s+([\w.]+);/gm)) {
      const parts = m[1].split('.');
      mods.add(parts[parts.length - 1]);
    }
  }

  mods.delete('');
  return [...mods];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Lee un archivo respetando el límite de tamaño. Devuelve '' si binario o muy grande.
 */
function safeReadFile(absPath) {
  try {
    const stat = fs.statSync(absPath);
    if (stat.size > MAX_FILE_BYTES) return '';
    return fs.readFileSync(absPath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Dado el reference_file de un key_entity, devuelve los identificadores (nombre base
 * sin extensión, nombre con extensión, stem del path) que se pueden reconocer en imports.
 */
function entityIdentifiers(referenceFile) {
  const base = path.basename(referenceFile);
  const ext = path.extname(base);
  const stem = base.slice(0, -ext.length); // sin extensión
  return new Set([base, stem, referenceFile.replace(/\\/g, '/')]);
}

// ── Core ──────────────────────────────────────────────────────────────────────

/**
 * Deriva relaciones entre componentes por análisis estático de imports.
 *
 * @param {string} analysisPath  Ruta al analysis.json
 * @param {string} projectRoot   Raíz del proyecto (para resolver rutas de archivos)
 * @returns {number}             Número de relaciones generadas
 */
export async function deriveRelations(analysisPath, projectRoot) {
  const raw = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));

  const components = raw.components || [];
  const existingRelations = raw.components_relations || [];

  if (existingRelations.length >= 2) {
    console.log(`[relations-fallback] ${path.basename(projectRoot)}: ya tiene ${existingRelations.length} relaciones — sin cambios`);
    return existingRelations.length;
  }

  console.log(`[relations-fallback] ${path.basename(projectRoot)}: ${existingRelations.length} relaciones → derivando por imports...`);

  // Construir mapa: identificador → component_id (para los destinos)
  // Para cada componente, los identificadores son los basenames/stems de sus key_entities.
  const idToComp = new Map(); // identificador (stem/base) → component_id
  for (const comp of components) {
    for (const ent of (comp.key_entities || [])) {
      for (const id of entityIdentifiers(ent.reference_file)) {
        idToComp.set(id, comp.component_id);
      }
    }
  }

  const relations = [];
  const seen = new Set(); // dedup por "srcId:dstId:moduleName"

  for (const srcComp of components) {
    // Leer los archivos fuente de este componente
    for (const ent of (srcComp.key_entities || [])) {
      const ext = path.extname(ent.reference_file);
      if (!SOURCE_EXTS.has(ext)) continue;

      const absPath = path.join(projectRoot, ent.reference_file);
      const content = safeReadFile(absPath);
      if (!content) continue;

      const imports = extractImports(content, ext);

      for (const mod of imports) {
        const dstId = idToComp.get(mod);
        if (!dstId || dstId === srcComp.component_id) continue; // sin auto-referencias

        const dedupeKey = `${srcComp.component_id}:${dstId}:${mod}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        relations.push({
          src_id: srcComp.component_id,
          dst_id: dstId,
          relation: `imports ${mod}`,
        });
      }
    }
  }

  // Reescribir el analysis.json con las relaciones derivadas
  raw.components_relations = relations;
  fs.writeFileSync(analysisPath, JSON.stringify(raw, null, 2), 'utf8');

  console.log(`[relations-fallback] ${path.basename(projectRoot)}: ${relations.length} relaciones derivadas → escrito en ${analysisPath}`);
  return relations.length;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

async function main() {
  const projectRoot = process.argv[2];
  if (!projectRoot) {
    console.error('Uso: node relations-fallback.js <ruta-proyecto>');
    process.exit(1);
  }

  // Buscar analysis.json: primero .codeboarding/, luego graphify-out/
  const candidates = [
    path.join(projectRoot, '.codeboarding', 'analysis.json'),
    path.join(projectRoot, 'graphify-out', 'analysis.json'),
  ];

  let analysisPath = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) { analysisPath = c; break; }
  }

  if (!analysisPath) {
    console.error(`[relations-fallback] No se encontró analysis.json en ${projectRoot}`);
    process.exit(1);
  }

  const count = await deriveRelations(analysisPath, projectRoot);
  console.log(`[relations-fallback] Total relaciones: ${count}`);
}

// Ejecutar si es el módulo principal
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace('file:///', '').replace(/^\/([A-Z]:)/, '$1'))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
