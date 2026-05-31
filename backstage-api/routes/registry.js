import { Router } from 'express';
import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Base directory where the scanner writes its JSON inventory.
// Override with REGISTRY_DATA, otherwise ~/.registry-data/
const DATA_DIR = process.env.REGISTRY_DATA || join(homedir(), '.registry-data');

const SERVER_SCAN = 'server-scan.json';
const PROJECTS = 'projects.json';

// Read + parse a JSON file inside DATA_DIR without crashing.
// Returns { ok, data, error, mtimeMs }:
//  - file missing      -> { ok:false, missing:true, error }
//  - JSON parse error  -> { ok:false, error }
//  - success           -> { ok:true, data, mtimeMs }
function readJson(filename) {
  const filePath = join(DATA_DIR, filename);
  if (!existsSync(filePath)) {
    return { ok: false, missing: true, error: 'no scan yet, run scanner (' + filename + ' not found in ' + DATA_DIR + ')' };
  }
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    return { ok: true, data, mtimeMs: statSync(filePath).mtimeMs };
  } catch (e) {
    return { ok: false, error: 'failed to read/parse ' + filename + ': ' + e.message };
  }
}

// Normalize projects.json into an array no matter how the scanner shaped it.
// Accepts: [ ... ] | { projects: [ ... ] } | { data: [ ... ] }
function asProjectArray(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.projects)) return data.projects;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

export function createRegistryRouter() {
  const router = Router();

  // GET /registry/ -- list of available endpoints
  router.get('/', (_req, res) => {
    res.json({
      service: 'registry',
      data_dir: DATA_DIR,
      endpoints: ['/', '/server', '/projects', '/saas', '/project/:name', '/summary'],
    });
  });

  // GET /registry/server -- raw server scan (services, ports, containers, repos)
  router.get('/server', (_req, res) => {
    const r = readJson(SERVER_SCAN);
    if (!r.ok) return res.status(r.missing ? 404 : 500).json({ error: r.missing ? 'no scan yet, run scanner' : r.error });
    res.json(r.data);
  });

  // GET /registry/projects -- array of classified projects
  router.get('/projects', (_req, res) => {
    const r = readJson(PROJECTS);
    if (!r.ok) return res.status(r.missing ? 404 : 500).json({ error: r.error });
    const projects = asProjectArray(r.data);
    res.json({ count: projects.length, projects });
  });

  // GET /registry/saas -- only projects where type is saas
  router.get('/saas', (_req, res) => {
    const r = readJson(PROJECTS);
    if (!r.ok) return res.status(r.missing ? 404 : 500).json({ error: r.error });
    const saas = asProjectArray(r.data).filter(p => p && typeof p.type === 'string' && p.type.toLowerCase() === 'saas');
    res.json({ count: saas.length, projects: saas });
  });

  // GET /registry/project/:name -- detail of one project (case-insensitive)
  router.get('/project/:name', (req, res) => {
    const r = readJson(PROJECTS);
    if (!r.ok) return res.status(r.missing ? 404 : 500).json({ error: r.error });
    const wanted = String(req.params.name || '').toLowerCase();
    const project = asProjectArray(r.data).find(p => p && typeof p.name === 'string' && p.name.toLowerCase() === wanted);
    if (!project) return res.status(404).json({ error: 'project not found: ' + req.params.name });
    res.json(project);
  });

  // GET /registry/summary -- rollup over server-scan + projects
  router.get('/summary', (_req, res) => {
    const server = readJson(SERVER_SCAN);
    const projects = readJson(PROJECTS);
    if (!server.ok && !projects.ok) return res.status(404).json({ error: 'no scan yet, run scanner' });

    const projArr = projects.ok ? asProjectArray(projects.data) : [];
    const by_type = {};
    for (const p of projArr) {
      const t = p && typeof p.type === 'string' ? p.type.toLowerCase() : 'unknown';
      by_type[t] = (by_type[t] || 0) + 1;
    }
    for (const k of ['saas', 'api', 'bot', 'scraper', 'web']) if (!(k in by_type)) by_type[k] = 0;

    const sd = server.ok ? server.data : {};
    const services = sd.services ?? sd.processes ?? [];
    const repos = sd.repos ?? sd.repositories ?? [];
    const scanned_at = sd.scanned_at ?? sd.timestamp ?? sd.scannedAt ?? null;
    let data_age_seconds = null;
    if (server.ok && typeof server.mtimeMs === 'number') {
      data_age_seconds = Math.max(0, Math.round((Date.now() - server.mtimeMs) / 1000));
    }

    res.json({
      hostname: sd.hostname ?? null,
      n_services: Array.isArray(services) ? services.length : 0,
      n_repos: Array.isArray(repos) ? repos.length : 0,
      by_type,
      scanned_at,
      data_age_seconds,
      sources: {
        server_scan: server.ok ? 'ok' : (server.missing ? 'missing' : 'error'),
        projects: projects.ok ? 'ok' : (projects.missing ? 'missing' : 'error'),
      },
    });
  });

  return router;
}

export default createRegistryRouter;