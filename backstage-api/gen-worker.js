// ============================================================================
// gen-worker — auto-generación de organigramas (CodeBoarding) en el ciclo
// del registry local. Misión SM 260707: "registro una carpeta ⇒ aparece su
// organigrama". Al arrancar el servidor (tras 60s) y cada 6h: los proyectos
// de projects.json sin .codeboarding/analysis.json se generan UNO A UNO
// (secuencial a propósito — no saturar la suscripción Claude del CLIProxy).
//
// Trampas del 67 aplicadas:
//  - stdin 'ignore' (codeboarding se come el stdin en bucles)
//  - entorno limpio: solo OPENAI_* — se eliminan ANTHROPIC/GOOGLE/GEMINI keys
//    para que no confunda la selección de proveedor
//  - timeout 45 min por proyecto con kill; skip documentado, nada silencioso
//  - desactivable con ARCH_AUTOGEN=0
// ============================================================================
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { deriveRelations } from './relations-fallback.js';

const HOME = os.homedir();
const DATA_DIR = process.env.REGISTRY_DATA || path.join(HOME, '.registry-data');
const PROJECTS_JSON = path.join(DATA_DIR, 'projects.json');
const LOG_FILE = path.join(DATA_DIR, 'organigramas.log');
const CB_EXE = process.env.CODEBOARDING_EXE
  || path.join(HOME, 'codeboarding-venv', 'Scripts', 'codeboarding.exe');
const KEY_FILE = path.join(HOME, '.codeboarding', 'cliproxy.key');
// Por túnel SSH al 67 (ssh -N -L 8317:localhost:8317): el endpoint público
// proxy.sypnose.cloud está tras Cloudflare Access → 302 al login, el LLM no pasa.
const BASE_URL = process.env.CB_BASE_URL || 'http://127.0.0.1:8317/v1';
const TIMEOUT_MS = 45 * 60 * 1000; // 45 min por proyecto
const EVERY_MS = 6 * 60 * 60 * 1000; // ciclo: cada 6h
const BOOT_DELAY_MS = 60 * 1000; // gracia tras el arranque

let running = false;

function log(msg) {
  const line = `[${new Date().toISOString().replace('T', ' ').slice(0, 19)}] [gen-worker] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* log best-effort */ }
}

function loadProjects() {
  try {
    const d = JSON.parse(fs.readFileSync(PROJECTS_JSON, 'utf8'));
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.projects)) return d.projects;
    if (d && Array.isArray(d.data)) return d.data;
    return [];
  } catch { return []; }
}

function pendingProjects() {
  return loadProjects().filter((p) => {
    if (!p.name || !p.path) return false;
    if (!fs.existsSync(p.path)) { log(`SKIP ${p.name}: ruta no existe (${p.path})`); return false; }
    return !fs.existsSync(path.join(p.path, '.codeboarding', 'analysis.json'));
  });
}

function cleanEnv() {
  const env = { ...process.env };
  // Solo OPENAI_* debe existir — otras keys confunden la selección de proveedor.
  delete env.ANTHROPIC_API_KEY;
  delete env.GOOGLE_API_KEY;
  delete env.GEMINI_API_KEY;
  delete env.AWS_ACCESS_KEY_ID; // Bedrock PROHIBIDO (reservado al traductor)
  delete env.AWS_SECRET_ACCESS_KEY;
  env.OPENAI_BASE_URL = BASE_URL;
  try { env.OPENAI_API_KEY = fs.readFileSync(KEY_FILE, 'utf8').trim(); }
  catch { return null; }
  return env;
}

function generateOne(p) {
  return new Promise((resolve) => {
    const env = cleanEnv();
    if (!env) { log(`FALLO ${p.name}: falta ${KEY_FILE}`); return resolve(false); }
    if (!fs.existsSync(CB_EXE)) { log(`FALLO ${p.name}: codeboarding no instalado (${CB_EXE})`); return resolve(false); }
    log(`GEN ${p.name}: codeboarding --local ${p.path} (timeout 45min)`);
    const child = spawn(CB_EXE, ['--local', p.path], {
      env,
      stdio: ['ignore', 'ignore', 'ignore'], // stdin ignore = trampa del stdin resuelta
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      log(`FALLO ${p.name}: timeout 45min — matando proceso`);
      try { child.kill('SIGKILL'); } catch { /* ya muerto */ }
    }, TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const ok = code === 0 && fs.existsSync(path.join(p.path, '.codeboarding', 'analysis.json'));
      log(ok ? `OK ${p.name}: analysis.json generado` : `FALLO ${p.name}: rc=${code}`);
      if (ok) {
        // Hook: fallback de relaciones — best-effort, nunca bloquea el ciclo
        const aPath = path.join(p.path, '.codeboarding', 'analysis.json');
        deriveRelations(aPath, p.path).catch((e) => log(`[relations-fallback] ${p.name}: ${e.message}`));
      }
      resolve(ok);
    });
    child.on('error', (e) => { clearTimeout(timer); log(`FALLO ${p.name}: ${e.message}`); resolve(false); });
  });
}

async function cycle() {
  if (running) { log('ciclo saltado: ya hay una generación en curso'); return; }
  running = true;
  try {
    const pending = pendingProjects();
    if (!pending.length) { running = false; return; }
    log(`ciclo: ${pending.length} proyecto(s) sin organigrama`);
    for (const p of pending) {
      const ok = await generateOne(p);
      if (!ok) {
        log(`RETRY ${p.name}: reintento único`);
        await generateOne(p);
      }
    }
    log('ciclo terminado');
  } finally {
    running = false;
  }
}

export function startGenWorker() {
  if (process.env.ARCH_AUTOGEN === '0') { log('desactivado por ARCH_AUTOGEN=0'); return; }
  setTimeout(cycle, BOOT_DELAY_MS);
  setInterval(cycle, EVERY_MS);
  log(`activo: primer ciclo en 60s, luego cada 6h (motor: ${CB_EXE})`);
}
