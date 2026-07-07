import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import { createSupabaseRouter } from './routes/supabase.js';
import { createCodeGraphRouter } from './routes/codegraph.js';
import { createFleetRouter } from './routes/fleet.js';
import { createRegistryRouter } from './routes/registry.js';
import { createArchRouter } from './routes/arch.js';
import { startGenWorker } from './gen-worker.js';

// ESM has no __dirname — derive it from import.meta.url.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Static assets from public/ — index:false porque la raíz ahora es la portada
// de organigramas (arch-index.html) y el dashboard clásico vive en /panel.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Portada del registry: la rejilla de organigramas (visión Carlos, replicada del 67).
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'arch-index.html')));
// Dashboard clásico, ahora en /panel.
app.get('/panel', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Fleet is optional (host fleet / osquery). Only mounted if FLEET_URL is set.
const fleetEnabled = !!process.env.FLEET_URL;
// Always-on services: supabase, codegraph, registry. Fleet adds one when enabled.
const serviceCount = 3 + (fleetEnabled ? 1 : 0);

app.get('/health', (_req, res) => res.json({ status: 'ok', services: serviceCount, registry: true, fleet: fleetEnabled }));

app.use('/supabase', createSupabaseRouter());
app.use('/codegraph', createCodeGraphRouter());
app.use('/registry', createRegistryRouter());
app.use('/arch', createArchRouter());
if (fleetEnabled) app.use('/fleet', createFleetRouter());

const PORT = parseInt(process.env.REGISTRY_PORT || '7008', 10);
const BIND = process.env.REGISTRY_BIND || '0.0.0.0';
app.listen(PORT, BIND, () => {
  console.log(`Registry API running on http://${BIND}:${PORT} (services: ${serviceCount}, fleet: ${fleetEnabled})`);
  // Auto-generación de organigramas enganchada al ciclo del registry:
  // "registro una carpeta ⇒ aparece su organigrama" (misión SM 260707).
  startGenWorker();
});
