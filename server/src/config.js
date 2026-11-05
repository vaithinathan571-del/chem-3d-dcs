/**
 * Server configuration from environment variables.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_USERS } from './auth/auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

function parseUsers(raw) {
  if (!raw) return null;
  try {
    const users = JSON.parse(raw);
    if (!Array.isArray(users) || users.length === 0) throw new Error('must be a non-empty array');
    return users;
  } catch (err) {
    throw new Error(`DCS_USERS is not valid JSON: ${err.message}`);
  }
}

export function loadConfig(env = process.env) {
  const users = parseUsers(env.DCS_USERS);
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    secret: env.DCS_SECRET || null,
    users: users ?? DEFAULT_USERS,
    usingDefaultUsers: !users,
    dataDir: env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.join(repoRoot, 'data'),
    staticDir: env.STATIC_DIR ? path.resolve(env.STATIC_DIR) : path.join(repoRoot, 'client', 'dist'),
    prerunSeconds: Number(env.PRERUN_SECONDS ?? 4 * 3600),
    historianHours: Number(env.HISTORIAN_HOURS ?? 4),
    broadcastMs: Number(env.BROADCAST_MS ?? 500),
    seed: env.SIM_SEED ? Number(env.SIM_SEED) : undefined,
  };
}
