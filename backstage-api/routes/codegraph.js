import { Router } from 'express';
import Database from 'better-sqlite3';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function findLatestDb() {
  try {
    if (process.env.CODEGRAPH_DB) return process.env.CODEGRAPH_DB;
    const indexDir = join(homedir(), '.trace-mcp', 'index');
    const dbs = readdirSync(indexDir).filter(f => f.endsWith('.db'));
    if (dbs.length === 0) return null;
    dbs.sort((a, b) => statSync(join(indexDir, b)).mtimeMs - statSync(join(indexDir, a)).mtimeMs);
    return join(indexDir, dbs[0]);
  } catch {
    return null;
  }
}

function getDb() {
  const dbPath = findLatestDb();
  if (!dbPath) return null;
  return new Database(dbPath, { readonly: true });
}

function notAvailable(_req, res) {
  res.status(503).json({ available: false, reason: 'trace-mcp index not found - run registry-build.sh first' });
}

export function createCodeGraphRouter() {
  const router = Router();

  router.get('/', (_req, res) => {
    const available = findLatestDb() !== null;
    res.json({ available, endpoints: ['/routes', '/routes-with-tables', '/route/:path', '/summary'] });
  });

  // GET /codegraph/routes — all route handlers (next_entry_point edges)
  router.get('/routes', async (_req, res) => {
    const db = getDb();
    if (!db) return notAvailable(_req, res);
    try {
      const routes = db.prepare(`
        SELECT f.path, s.name, s.kind,
               json_extract(e.metadata, '$.method') as http_method
        FROM edges e
        JOIN edge_types et ON e.edge_type_id = et.id AND et.name = 'next_entry_point'
        JOIN nodes n_file ON e.source_node_id = n_file.id
        JOIN files f ON n_file.ref_id = f.id
        JOIN nodes n_sym ON e.target_node_id = n_sym.id
        JOIN symbols s ON n_sym.ref_id = s.id
        ORDER BY f.path
      `).all();
      db.close();
      res.json({ count: routes.length, routes });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /codegraph/routes-with-tables — routes that directly call .from('table')
  router.get('/routes-with-tables', async (_req, res) => {
    const db = getDb();
    if (!db) return notAvailable(_req, res);
    try {
      const chains = db.prepare(`
        SELECT f.path as route_path, s.name as handler_name,
               json_extract(sq.metadata, '$.op') as db_op,
               json_extract(sq.metadata, '$.table') as table_name,
               json_extract(sq.metadata, '$.line') as line_number
        FROM edges ep
        JOIN edge_types et_ep ON ep.edge_type_id = et_ep.id AND et_ep.name = 'next_entry_point'
        JOIN nodes n_file ON ep.source_node_id = n_file.id
        JOIN files f ON n_file.ref_id = f.id
        JOIN nodes n_sym ON ep.target_node_id = n_sym.id
        JOIN symbols s ON n_sym.ref_id = s.id
        JOIN edges sq ON sq.source_node_id = ep.target_node_id
        JOIN edge_types et_sq ON sq.edge_type_id = et_sq.id AND et_sq.name = 'supabase_query'
        ORDER BY f.path
      `).all();
      db.close();
      res.json({ count: chains.length, chains });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /codegraph/route/:path — calls chain for a specific route file
  // Usage: /codegraph/route/app%2Fapi%2Fclientes%2Froute.ts (URL-encoded path)
  router.get('/route/:path(*)', async (req, res) => {
    const db = getDb();
    if (!db) return notAvailable(req, res);
    try {
      const routePath = req.params.path;

      // Get the route handler
      const handler = db.prepare(`
        SELECT n_sym.id as node_id, f.path, s.name, s.kind
        FROM edges ep
        JOIN edge_types et ON ep.edge_type_id = et.id AND et.name = 'next_entry_point'
        JOIN nodes n_file ON ep.source_node_id = n_file.id
        JOIN files f ON n_file.ref_id = f.id
        JOIN nodes n_sym ON ep.target_node_id = n_sym.id
        JOIN symbols s ON n_sym.ref_id = s.id
        WHERE f.path LIKE ?
      `).all(`%${routePath}%`);

      // Get direct supabase queries
      const directQueries = db.prepare(`
        SELECT json_extract(sq.metadata, '$.op') as op,
               json_extract(sq.metadata, '$.table') as tbl,
               json_extract(sq.metadata, '$.line') as line
        FROM edges ep
        JOIN edge_types et_ep ON ep.edge_type_id = et_ep.id AND et_ep.name = 'next_entry_point'
        JOIN nodes n_file ON ep.source_node_id = n_file.id
        JOIN files f ON n_file.ref_id = f.id
        JOIN edges sq ON sq.source_node_id = ep.target_node_id
        JOIN edge_types et_sq ON sq.edge_type_id = et_sq.id AND et_sq.name = 'supabase_query'
        WHERE f.path LIKE ?
      `).all(`%${routePath}%`);

      // Get calls from handler (1 hop)
      const calls = handler.length > 0 ? db.prepare(`
        SELECT s.name as called_function, f.path as called_file
        FROM edges c
        JOIN edge_types et ON c.edge_type_id = et.id AND et.name = 'calls'
        JOIN nodes n_target ON c.target_node_id = n_target.id
        JOIN symbols s ON n_target.ref_id = s.id
        LEFT JOIN files f ON n_target.ref_id = f.id
        WHERE c.source_node_id = ?
        ORDER BY s.name
      `).all(handler[0].node_id) : [];

      db.close();
      res.json({
        route: routePath,
        handlers: handler,
        direct_supabase_queries: directQueries,
        calls_from_handler: calls,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /codegraph/summary — overall stats
  router.get('/summary', async (_req, res) => {
    const db = getDb();
    if (!db) return notAvailable(_req, res);
    try {
      const stats = {};
      stats.total_files = db.prepare('SELECT count(*) as cnt FROM files').get().cnt;
      stats.total_symbols = db.prepare('SELECT count(*) as cnt FROM symbols').get().cnt;
      stats.total_edges = db.prepare('SELECT count(*) as cnt FROM edges').get().cnt;

      const edgeTypes = db.prepare(`
        SELECT et.name, count(*) as cnt
        FROM edges e JOIN edge_types et ON e.edge_type_id = et.id
        GROUP BY et.name ORDER BY cnt DESC
      `).all();
      stats.edge_types = edgeTypes;

      stats.route_handlers = db.prepare(`
        SELECT count(*) as cnt FROM edges e
        JOIN edge_types et ON e.edge_type_id = et.id AND et.name = 'next_entry_point'
      `).get().cnt;

      stats.supabase_queries = db.prepare(`
        SELECT count(*) as cnt FROM edges e
        JOIN edge_types et ON e.edge_type_id = et.id AND et.name = 'supabase_query'
      `).get().cnt;

      db.close();
      res.json(stats);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
