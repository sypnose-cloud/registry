import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import { createSupabaseRouter } from './routes/supabase.js';
import { createCodeGraphRouter } from './routes/codegraph.js';
import { createFleetRouter } from './routes/fleet.js';
import { createRegistryRouter } from './routes/registry.js';

// ESM has no __dirname — derive it from import.meta.url.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve the static web dashboard from public/ (GET / -> public/index.html).
app.use(express.static(path.join(__dirname, 'public')));

// Fleet is optional (host fleet / osquery). Only mounted if FLEET_URL is set.
const fleetEnabled = !!process.env.FLEET_URL;
// Always-on services: supabase, codegraph, registry. Fleet adds one when enabled.
const serviceCount = 3 + (fleetEnabled ? 1 : 0);

app.get('/health', (_req, res) => res.json({ status: 'ok', services: serviceCount, registry: true, fleet: fleetEnabled }));

app.use('/supabase', createSupabaseRouter());
app.use('/codegraph', createCodeGraphRouter());
app.use('/registry', createRegistryRouter());
if (fleetEnabled) app.use('/fleet', createFleetRouter());

const PORT = parseInt(process.env.REGISTRY_PORT || '7008', 10);
const BIND = process.env.REGISTRY_BIND || '0.0.0.0';
app.listen(PORT, BIND, () => {
  console.log(`Registry API running on http://${BIND}:${PORT} (services: ${serviceCount}, fleet: ${fleetEnabled})`);
});
