#!/usr/bin/env node
/**
 * build-frontend-api-map.mjs (portable)
 * Scans frontend .tsx/.ts files under <repo>/app/ (excluding app/api/) and extracts
 * API endpoint paths called via fetch(). Cross-references against route.ts files in app/api/.
 * Outputs: frontend-api-map.json in the repo root.
 *
 * Usage: node build-frontend-api-map.mjs /path/to/repo
 *        (if no arg given, uses the parent of this script's dir)
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Repo root: 1st CLI arg, or env, or parent of this script's dir.
const PROJECT_ROOT = process.argv[2] || process.env.REGISTRY_REPO || join(__dirname, '..');
const APP_DIR = join(PROJECT_ROOT, 'app');
const API_DIR = join(APP_DIR, 'api');
const OUTPUT_FILE = join(PROJECT_ROOT, 'frontend-api-map.json');

function walkDir(dir, results = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) walkDir(full, results);
    else if (/\.(tsx?|jsx?)$/.test(entry)) results.push(full);
  }
  return results;
}

// Collect known API routes from app/api/**/route.ts -> URL path
function collectApiRoutes() {
  const routes = new Set();
  if (!existsSync(API_DIR)) return routes;
  for (const f of walkDir(API_DIR)) {
    if (!/route\.(ts|js)$/.test(f)) continue;
    // app/api/v2/clientes/route.ts -> /api/v2/clientes
    let p = relative(APP_DIR, dirname(f)).replace(/\\/g, '/');
    routes.add('/' + p);
  }
  return routes;
}

// Extract fetch('/api/...') string literals from a frontend file
const FETCH_RE = /fetch\(\s*[`'"](\/api\/[^`'"?\s]+)/g;

function main() {
  if (!existsSync(APP_DIR)) {
    console.error(`[frontend-api-map] no app/ dir in ${PROJECT_ROOT} - skipping (not a Next.js app).`);
    writeFileSync(OUTPUT_FILE, JSON.stringify({}, null, 2));
    return;
  }
  const apiRoutes = collectApiRoutes();
  const map = {};
  for (const file of walkDir(APP_DIR)) {
    if (file.includes(`${APP_DIR}/api/`.replace(/\\/g, '/')) || file.replace(/\\/g,'/').includes('/app/api/')) continue;
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    const eps = new Set();
    let m;
    while ((m = FETCH_RE.exec(src)) !== null) eps.add(m[1]);
    if (eps.size) {
      const rel = relative(PROJECT_ROOT, file).replace(/\\/g, '/');
      map[rel] = [...eps];
    }
  }
  writeFileSync(OUTPUT_FILE, JSON.stringify(map, null, 2));
  console.log(`[frontend-api-map] ${Object.keys(map).length} pages -> endpoints. ${apiRoutes.size} API routes known. Wrote ${OUTPUT_FILE}`);
}

main();
