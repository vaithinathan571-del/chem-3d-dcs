#!/usr/bin/env node
/**
 * End-to-end smoke test: starts the server on a free port with the built
 * client, logs in through the UI with a headless browser, verifies the 3D
 * view and live data render, issues a setpoint change through the faceplate
 * and checks for console errors.
 *
 * Requires Playwright with a Chromium build:  npm i -D playwright && npx playwright install chromium
 * Requires the client to be built first:      npm run build
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let playwright;
try {
  playwright = await import('playwright');
} catch {
  try {
    // Fall back to a globally installed copy (resolved through NODE_PATH).
    playwright = createRequire(import.meta.url)('playwright');
  } catch {
    console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
    process.exit(2);
  }
}
if (!fs.existsSync(path.join(root, 'client', 'dist', 'index.html'))) {
  console.error('Client not built. Run: npm run build');
  process.exit(2);
}

const port = await new Promise((resolve) => {
  const s = net.createServer().listen(0, () => {
    const { port: p } = s.address();
    s.close(() => resolve(p));
  });
});

const server = spawn(process.execPath, ['server/src/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', PRERUN_SECONDS: '7200', DATA_DIR: path.join(root, 'test-results', 'data') },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server did not start')), 30_000);
  server.stdout.on('data', (d) => {
    if (d.toString().includes('listening')) {
      clearTimeout(timer);
      resolve();
    }
  });
});

const failures = [];
const check = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures.push(msg);
};

const browser = await playwright.chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`http://127.0.0.1:${port}/`);
  await page.fill('input[name=username]', 'operator');
  await page.fill('input[name=password]', 'operator');
  await page.click('button[type=submit]');
  await page.waitForSelector('.card3d', { timeout: 30_000 });
  check(true, 'login and 3D data cards rendered');

  await page.waitForFunction(() => /\d/.test(document.querySelector('.kpi-val')?.textContent ?? ''), null, { timeout: 10_000 });
  check(true, 'live KPIs received over WebSocket');

  await page.click('table.grid tr:has-text("FIC-101")');
  await page.waitForSelector('.fp h2:has-text("FIC-101")');
  check(true, 'faceplate opens from the overview');

  await page.fill('.fp input[aria-label="New setpoint"]', '9.5');
  await page.press('.fp input[aria-label="New setpoint"]', 'Enter');
  await page.waitForFunction(() => document.querySelector('.fp .kv .val')?.textContent === '9.50', null, { timeout: 5000 });
  check(true, 'setpoint change applied');

  await page.click('.view-switch button:has-text("P&ID")');
  await page.click('.pid-block:has(text:text-is("TIC-104"))');
  await page.waitForSelector('.fp h2:has-text("TIC-104")');
  check(await page.isHidden('.label-layer'), 'P&ID view replaces the 3D labels');
  check(true, 'P&ID graphic opens faceplates');
  await page.click('.view-switch button:has-text("3D")');

  await page.click('.tab[data-tab=events]');
  await page.waitForSelector('td:has-text("FIC-101 SP")', { timeout: 5000 });
  check(true, 'operator action recorded in the event journal');

  const canvas = await page.$('.viewport canvas');
  check(!!canvas, 'WebGL canvas present');
  check(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (err) {
  failures.push(err.message);
  console.error(err);
} finally {
  await browser.close();
  server.kill('SIGTERM');
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nE2E smoke test passed');
