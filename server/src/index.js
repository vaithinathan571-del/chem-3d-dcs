#!/usr/bin/env node
/**
 * CHEM-3D DCS server entry point.
 */
import path from 'node:path';
import { loadConfig } from './config.js';
import { PlantRuntime } from './runtime.js';
import { AuthService } from './auth/auth.js';
import { createDcsServer } from './api/httpServer.js';

const cfg = loadConfig();

const auth = new AuthService({ users: cfg.users, secret: cfg.secret });
if (cfg.usingDefaultUsers) {
  console.warn('[auth] Using built-in demo accounts (operator/operator, engineer/engineer, instructor/instructor, viewer/viewer).');
  console.warn('[auth] Set DCS_USERS to configure real accounts before deploying.');
}
if (!cfg.secret) console.warn('[auth] DCS_SECRET not set – sessions will not survive a server restart.');

console.log('[sim] Initialising plant and settling at the normal operating point …');
const t0 = performance.now();
const runtime = new PlantRuntime({
  seed: cfg.seed,
  prerunSeconds: cfg.prerunSeconds,
  historianHours: cfg.historianHours,
  snapshotDir: path.join(cfg.dataDir, 'snapshots'),
}).initialise();
console.log(`[sim] Ready in ${Math.round(performance.now() - t0)} ms`);
runtime.start();

const { server, close } = createDcsServer({ runtime, auth, staticDir: cfg.staticDir, broadcastMs: cfg.broadcastMs });
server.listen(cfg.port, cfg.host, () => {
  console.log(`[http] CHEM-3D DCS listening on http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}`);
});

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[http] ${signal} received – shutting down`);
  runtime.stop();
  await close();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
