#!/usr/bin/env node
/**
 * Development runner: starts the DCS server (with --watch) and the Vite dev
 * server side by side. Open http://localhost:5173.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

const procs = [
  { name: 'server', color: 36, cmd: process.execPath, args: ['--watch', 'server/src/index.js'], env: { DCS_SECRET: process.env.DCS_SECRET ?? 'dev-secret' } },
  { name: 'client', color: 35, cmd: isWin ? 'npm.cmd' : 'npm', args: ['run', 'dev', '-w', 'client'], env: {} },
];

const children = procs.map((p) => {
  const child = spawn(p.cmd, p.args, { cwd: root, env: { ...process.env, ...p.env }, stdio: ['ignore', 'pipe', 'pipe'], shell: isWin });
  const prefix = `\x1b[${p.color}m[${p.name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) out.write(`${prefix}${l}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (!c.killed) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
