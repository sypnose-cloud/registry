import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// §11 adaptación local: misma fuente que routes/registry.js — respeta REGISTRY_DATA,
// con fallback a ~/.registry-data/ (idéntico al 67, que usa el home del servidor).
const DATA_DIR = process.env.REGISTRY_DATA || path.join(os.homedir(), '.registry-data');
const PROJECTS_JSON = path.join(DATA_DIR, 'projects.json');

// §11 adaptación local: normalización de shape copiada de registry.js (asProjectArray):
// acepta [ ... ] | { projects: [ ... ] } | { data: [ ... ] } — el scanner local varía.
function loadProjects() {
  try {
    const d = JSON.parse(fs.readFileSync(PROJECTS_JSON, 'utf8'));
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.projects)) return d.projects;
    if (d && Array.isArray(d.data)) return d.data;
    return [];
  } catch {
    return [];
  }
}

function projectPath(name) {
  const p = loadProjects().find((x) => x.name === name);
  return p && p.path ? p.path : null;
}

export function createArchRouter() {
  const router = express.Router();

  // Datos del organigrama: el analysis.json generado por CodeBoarding en el propio repo.
  router.get('/:project/data', (req, res) => {
    const root = projectPath(req.params.project);
    if (!root) return res.status(404).json({ error: 'unknown project' });
    const f = path.join(root, '.codeboarding', 'analysis.json');
    if (!fs.existsSync(f)) {
      return res.status(404).json({ error: 'no analysis yet', project: req.params.project });
    }
    try {
      const analysis = JSON.parse(fs.readFileSync(f, 'utf8'));
      res.json({ project: req.params.project, analysis });
    } catch {
      res.status(500).json({ error: 'bad analysis.json' });
    }
  });

  // Visor de archivos: solo lectura, confinado a la raiz del proyecto.
  // path.resolve + startsWith(root + sep) bloquea traversal también en Windows.
  router.get('/:project/file', (req, res) => {
    const root = projectPath(req.params.project);
    if (!root) return res.status(404).send('unknown project');
    const rel = String(req.query.path || '');
    const abs = path.resolve(root, rel);
    if (abs !== path.resolve(root) && !abs.startsWith(path.resolve(root) + path.sep)) {
      return res.status(400).send('bad path');
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return res.status(404).send('not found');
    if (fs.statSync(abs).size > 512 * 1024) return res.status(413).send('file too large');
    res.type('text/plain').send(fs.readFileSync(abs, 'utf8'));
  });

  // Lista de proyectos con/sin organigrama.
  router.get('/list', (_req, res) => {
    const items = loadProjects().map((p) => ({
      name: p.name,
      hasArch: !!(p.path && fs.existsSync(path.join(p.path, '.codeboarding', 'analysis.json'))),
    }));
    res.json(items);
  });

  // Portada: todas las apps con su estado de organigrama.
  router.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'arch-index.html'));
  });

  router.get('/:project', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'arch.html'));
  });

  return router;
}
