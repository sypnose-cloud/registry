import { Router } from 'express';

const FLEET_URL = process.env.FLEET_URL || '';
const FLEET_EMAIL = process.env.FLEET_EMAIL || '';
const FLEET_PASS = process.env.FLEET_PASS || '';

const fleetAvailable = Boolean(FLEET_URL);

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (!fleetAvailable) return null;
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const res = await fetch(`${FLEET_URL}/api/v1/fleet/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: FLEET_EMAIL, password: FLEET_PASS }),
  });
  const data = await res.json();
  cachedToken = data.token;
  tokenExpiry = Date.now() + 3600000;
  return cachedToken;
}

async function fleetGet(path) {
  const token = await getToken();
  const res = await fetch(`${FLEET_URL}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return res.json();
}

async function fleetPost(path, body) {
  const token = await getToken();
  const res = await fetch(`${FLEET_URL}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

function notAvailable(_req, res) {
  res.json({ available: false, reason: 'Fleet not deployed — set FLEET_URL env to enable' });
}

export function createFleetRouter() {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ available: fleetAvailable, endpoints: ['/hosts', '/services', '/containers', '/ports', '/summary'] });
  });

  router.get('/hosts', async (_req, res) => {
    if (!fleetAvailable) return notAvailable(_req, res);
    try {
      const data = await fleetGet('/api/v1/fleet/hosts');
      const hosts = (data.hosts || []).map(h => ({
        id: h.id,
        hostname: h.hostname,
        platform: h.platform,
        os_version: h.os_version,
        osquery_version: h.osquery_version,
        cpu_cores: h.cpu_physical_cores,
        memory_gb: Math.round((h.memory || 0) / 1073741824 * 10) / 10,
        uptime_hours: Math.round((h.uptime || 0) / 3600),
        last_seen: h.seen_time,
        status: h.status,
      }));
      res.json({ count: hosts.length, hosts });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/services', async (_req, res) => {
    if (!fleetAvailable) return notAvailable(_req, res);
    try {
      const data = await fleetPost('/api/v1/fleet/queries/run', {
        query: "SELECT id, description, active_state, sub_state FROM systemd_units WHERE id LIKE '%.service' AND active_state='active' ORDER BY id LIMIT 50",
      });
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message, hint: 'Live queries require osquery agent to respond' });
    }
  });

  router.get('/containers', async (_req, res) => {
    if (!fleetAvailable) return notAvailable(_req, res);
    try {
      const data = await fleetPost('/api/v1/fleet/queries/run', {
        query: "SELECT id, name, image, status FROM docker_containers ORDER BY name LIMIT 50",
      });
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/ports', async (_req, res) => {
    if (!fleetAvailable) return notAvailable(_req, res);
    try {
      const data = await fleetPost('/api/v1/fleet/queries/run', {
        query: "SELECT DISTINCT p.name, lp.port, lp.protocol, lp.address FROM listening_ports lp JOIN processes p ON lp.pid = p.pid WHERE lp.port != 0 ORDER BY lp.port LIMIT 50",
      });
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/summary', async (_req, res) => {
    if (!fleetAvailable) return notAvailable(_req, res);
    try {
      const data = await fleetGet('/api/v1/fleet/hosts/summary');
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
