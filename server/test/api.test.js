import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { settledRuntime } from './_helpers.js';
import { AuthService, DEFAULT_USERS } from '../src/auth/auth.js';
import { createDcsServer } from '../src/api/httpServer.js';

async function startServer() {
  const runtime = settledRuntime();
  const auth = new AuthService({ users: DEFAULT_USERS, secret: 'test-secret' });
  const dcs = createDcsServer({ runtime, auth, broadcastMs: 100, logger: { error() {} } });
  await new Promise((r) => dcs.server.listen(0, '127.0.0.1', r));
  const { port } = dcs.server.address();
  const base = `http://127.0.0.1:${port}`;
  const login = async (username) => {
    const res = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ username, password: username }) });
    return (await res.json()).token;
  };
  return { runtime, auth, dcs, port, base, login };
}

test('REST API: login, auth guard, config, state, history, commands', async (t) => {
  const s = await startServer();
  t.after(() => s.dcs.close());

  const health = await fetch(`${s.base}/api/health`);
  assert.equal(health.status, 200);

  const bad = await fetch(`${s.base}/api/login`, { method: 'POST', body: JSON.stringify({ username: 'operator', password: 'nope' }) });
  assert.equal(bad.status, 401);

  const unauth = await fetch(`${s.base}/api/config`);
  assert.equal(unauth.status, 401);

  const forged = await fetch(`${s.base}/api/config`, { headers: { Authorization: 'Bearer eyJzdWIiOiJ4In0.forged' } });
  assert.equal(forged.status, 401);

  const token = await s.login('operator');
  const h = { Authorization: `Bearer ${token}` };
  const cfg = await (await fetch(`${s.base}/api/config`, { headers: h })).json();
  assert.ok(cfg.points.length > 20);
  assert.ok(cfg.controllers.some((c) => c.tag === 'TIC-104' && c.output.cascade === 'TIC-105'));

  const state = await (await fetch(`${s.base}/api/state`, { headers: h })).json();
  assert.ok(Number.isFinite(state.points['TIC-104']));

  s.runtime.advance(10);
  const hist = await (await fetch(`${s.base}/api/history?series=TIC-104.PV,TIC-104.SP&points=5`, { headers: h })).json();
  assert.ok(hist.t.length > 0 && hist.t.length <= 5);
  assert.ok(Array.isArray(hist.series['TIC-104.PV']));

  const ok = await fetch(`${s.base}/api/commands`, { method: 'POST', headers: h, body: JSON.stringify({ action: 'setSP', params: { tag: 'FIC-101', value: 9.5 } }) });
  assert.equal(ok.status, 200);
  assert.equal(s.runtime.control.get('FIC-101').sp, 9.5);

  const denied = await fetch(`${s.base}/api/commands`, { method: 'POST', headers: h, body: JSON.stringify({ action: 'simFreeze' }) });
  assert.equal(denied.status, 403);

  const invalid = await fetch(`${s.base}/api/commands`, { method: 'POST', headers: h, body: '{not json' });
  assert.equal(invalid.status, 400);

  const events = await (await fetch(`${s.base}/api/events?category=OPERATOR`, { headers: h })).json();
  assert.ok(events.some((e) => /FIC-101 SP/.test(e.message) && e.user === 'operator'));
});

test('WebSocket: rejects missing token, sends hello + state, executes commands', async (t) => {
  const s = await startServer();
  t.after(() => s.dcs.close());

  await assert.rejects(
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
      ws.on('open', resolve);
      ws.on('error', reject);
    }),
  );

  const token = await s.login('instructor');
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=${token}`);
  const messages = [];
  const waitFor = (pred) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for message')), 3000);
      const check = () => {
        const m = messages.find(pred);
        if (m) {
          clearTimeout(timer);
          resolve(m);
          return true;
        }
        return false;
      };
      if (check()) return;
      ws.on('message', () => check());
    });
  ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
  t.after(() => ws.close());

  const hello = await waitFor((m) => m.type === 'hello');
  assert.equal(hello.user.role, 'instructor');
  assert.ok(hello.config.interlocks.length >= 7);
  await waitFor((m) => m.type === 'state');

  ws.send(JSON.stringify({ type: 'command', id: 7, action: 'simSpeed', params: { speed: 5 } }));
  const res = await waitFor((m) => m.type === 'result' && m.id === 7);
  assert.equal(res.ok, true);
  assert.equal(s.runtime.speed, 5);

  ws.send(JSON.stringify({ type: 'command', id: 8, action: 'snapshotSave', params: { name: 'ws test' } }));
  await waitFor((m) => m.type === 'result' && m.id === 8 && m.ok);
  const snaps = await waitFor((m) => m.type === 'snapshots');
  assert.ok(snaps.items.some((x) => x.name === 'ws test'));
});

test('auth tokens: expiry and tampering are rejected', () => {
  const auth = new AuthService({ users: DEFAULT_USERS, secret: 's', tokenTtlHours: -1 });
  const { token } = auth.login('operator', 'operator');
  assert.equal(auth.verify(token), null, 'expired');
  const auth2 = new AuthService({ users: DEFAULT_USERS, secret: 's' });
  const t2 = auth2.login('viewer', 'viewer').token;
  const [body, mac] = t2.split('.');
  const elevated = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), role: 'instructor' })).toString('base64url');
  assert.equal(auth2.verify(`${elevated}.${mac}`), null, 'tampered');
  assert.equal(auth2.verify(t2).role, 'viewer');
  assert.equal(auth2.login('viewer', 'wrong'), null);
});
