import express from 'express';
import cors from 'cors';

import { createSupabaseRouter } from './routes/supabase.js';
import { createCodeGraphRouter } from './routes/codegraph.js';
import { createFleetRouter } from './routes/fleet.js';

const app = express();
app.use(cors());
app.use(express.json());

// Fleet is optional (host fleet / osquery). Only mounted if FLEET_URL is set.
const fleetEnabled = !!process.env.FLEET_URL;
const serviceCount = 2 + (fleetEnabled ? 1 : 0);

app.get('/health', (_req, res) => res.json({ status: 'ok', services: serviceCount, fleet: fleetEnabled }));

app.use('/supabase', createSupabaseRouter());
app.use('/codegraph', createCodeGraphRouter());
if (fleetEnabled) app.use('/fleet', createFleetRouter());

const PORT = parseInt(process.env.REGISTRY_PORT || '7008', 10);
const BIND = process.env.REGISTRY_BIND || '0.0.0.0';
app.listen(PORT, BIND, () => {
  console.log(`Registry API running on http://${BIND}:${PORT} (services: ${serviceCount}, fleet: ${fleetEnabled})`);
});
