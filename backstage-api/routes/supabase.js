import { Router } from 'express';

// Supabase service key + RPC URL come from env (NEVER hardcoded - this repo is public).
// Set SUPABASE_SERVICE_KEY and SUPABASE_RPC_URL at install time.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const RPC_URL = process.env.SUPABASE_RPC_URL || 'http://localhost:8100/rest/v1/rpc/execute_sql';

// Timeout for Supabase fetch requests (ms). Keeps ECONNREFUSED from hanging as a
// raw HTTP 500 when Supabase is not running — same lazy/graceful pattern as fleet.js.
const FETCH_TIMEOUT_MS = 3000;

async function execSql(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Returns true when the connection error is "Supabase not reachable" rather than a
// real query error — covers ECONNREFUSED, ENOTFOUND, abort (timeout), and fetch
// failures to localhost:8100.
function isConnectionError(err) {
  if (!err) return false;
  const msg = err.message || '';
  return (
    err.name === 'AbortError' ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('fetch failed') ||
    msg.includes('connect ECONNREFUSED')
  );
}

export function createSupabaseRouter() {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ endpoints: ['/tables', '/tables/:name/columns', '/fks', '/summary'] });
  });

  // GET /supabase/tables — list all public tables with column count
  router.get('/tables', async (_req, res) => {
    try {
      const tables = await execSql(`
        SELECT t.table_name,
               COUNT(c.column_name) as column_count,
               obj_description(('"' || t.table_schema || '"."' || t.table_name || '"')::regclass) as description
        FROM information_schema.tables t
        LEFT JOIN information_schema.columns c ON t.table_name = c.table_name AND t.table_schema = c.table_schema
        WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        GROUP BY t.table_name, t.table_schema
        ORDER BY t.table_name
      `);
      res.json({ count: tables.length, tables });
    } catch (e) {
      if (isConnectionError(e)) {
        return res.status(503).json({ available: false, reason: 'Supabase not detected on :8100', detail: e.message });
      }
      res.status(500).json({ error: e.message });
    }
  });

  // GET /supabase/tables/:name/columns — columns for a specific table
  router.get('/tables/:name/columns', async (req, res) => {
    try {
      const name = req.params.name.replace(/[^a-zA-Z0-9_]/g, '');
      const columns = await execSql(`
        SELECT column_name, data_type, is_nullable, column_default,
               character_maximum_length, numeric_precision
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '${name}'
        ORDER BY ordinal_position
      `);
      res.json({ table: name, count: columns.length, columns });
    } catch (e) {
      if (isConnectionError(e)) {
        return res.status(503).json({ available: false, reason: 'Supabase not detected on :8100', detail: e.message });
      }
      res.status(500).json({ error: e.message });
    }
  });

  // GET /supabase/fks — all foreign key relationships
  router.get('/fks', async (_req, res) => {
    try {
      const fks = await execSql(`
        SELECT tc.table_name as source_table,
               kcu.column_name as source_column,
               ccu.table_name AS target_table,
               ccu.column_name AS target_column,
               tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        ORDER BY tc.table_name, kcu.column_name
      `);
      res.json({ count: fks.length, fks });
    } catch (e) {
      if (isConnectionError(e)) {
        return res.status(503).json({ available: false, reason: 'Supabase not detected on :8100', detail: e.message });
      }
      res.status(500).json({ error: e.message });
    }
  });

  // GET /supabase/summary — quick stats
  router.get('/summary', async (_req, res) => {
    try {
      const [tables, fks, rows] = await Promise.all([
        execSql("SELECT count(*) as cnt FROM pg_tables WHERE schemaname='public'"),
        execSql("SELECT count(*) as cnt FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY' AND table_schema='public'"),
        execSql("SELECT schemaname, count(*) as cnt FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') GROUP BY schemaname ORDER BY cnt DESC"),
      ]);
      res.json({
        public_tables: tables[0]?.cnt || 0,
        fk_count: fks[0]?.cnt || 0,
        schemas: rows,
      });
    } catch (e) {
      if (isConnectionError(e)) {
        return res.status(503).json({ available: false, reason: 'Supabase not detected on :8100', detail: e.message });
      }
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
