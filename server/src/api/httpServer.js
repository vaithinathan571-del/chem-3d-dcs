/**
 * HTTP REST API, static file server for the operator client and WebSocket
 * real-time channel.
 *
 * REST (all except /api/health and /api/login need `Authorization: Bearer <token>`):
 *   GET  /api/health
 *   POST /api/login              {username, password} → {token, user}
 *   GET  /api/me
 *   GET  /api/config             static plant configuration
 *   GET  /api/state              live plant state
 *   GET  /api/history?series=a,b&from=&to=&points=
 *   GET  /api/events?limit=&category=&tag=
 *   GET  /api/snapshots
 *   POST /api/commands           {action, params} → {ok, message?}
 *
 * WebSocket: /ws?token=<token>
 *   server → client: hello | state | result | snapshots | alarmConfig
 *   client → server: {type: 'command', id, action, params} | {type: 'ping'}
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';

const MAX_BODY = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {{runtime: import('../runtime.js').PlantRuntime, auth: import('../auth/auth.js').AuthService,
 *          staticDir?: string, broadcastMs?: number, logger?: Console}} opts
 */
export function createDcsServer({ runtime, auth, staticDir = null, broadcastMs = 500, logger = console }) {
  const hasStatic = staticDir && fs.existsSync(path.join(staticDir, 'index.html'));

  const authenticate = (req) => {
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    const user = auth.verify(token);
    if (!user) throw new HttpError(401, 'Authentication required');
    return user;
  };

  const routes = {
    'GET /api/health': () => ({ status: 'ok', plant: runtime.configPayload().plant.id, simTime: runtime.simTime, frozen: runtime.frozen, clients: wss.clients.size }),
    'POST /api/login': async (req) => {
      const body = await readBody(req);
      const result = auth.login(body.username, body.password);
      if (!result) {
        await new Promise((r) => setTimeout(r, 300));
        throw new HttpError(401, 'Invalid username or password');
      }
      runtime.events.add({ category: 'SYSTEM', user: result.user.username, message: `User ${result.user.username} (${result.user.role}) logged in` });
      return result;
    },
    'GET /api/me': (req) => authenticate(req),
    'GET /api/config': (req) => {
      authenticate(req);
      return runtime.configPayload();
    },
    'GET /api/state': (req) => {
      authenticate(req);
      return runtime.liveState();
    },
    'GET /api/history': (req, url) => {
      authenticate(req);
      const series = (url.searchParams.get('series') ?? '').split(',').filter(Boolean).slice(0, 16);
      if (!series.length) throw new HttpError(400, 'series parameter required');
      const from = Number(url.searchParams.get('from') ?? -Infinity);
      const to = Number(url.searchParams.get('to') ?? Infinity);
      const points = Number(url.searchParams.get('points') ?? 600);
      return runtime.historian.query(series, Number.isFinite(from) ? from : -Infinity, Number.isFinite(to) ? to : Infinity, points);
    },
    'GET /api/events': (req, url) => {
      authenticate(req);
      return runtime.events.query({
        limit: Number(url.searchParams.get('limit') ?? 200),
        category: url.searchParams.get('category') || undefined,
        tag: url.searchParams.get('tag') || undefined,
      });
    },
    'GET /api/snapshots': (req) => {
      authenticate(req);
      return runtime.snapshots.list();
    },
    'POST /api/commands': async (req) => {
      const user = authenticate(req);
      const body = await readBody(req);
      const result = runCommand(user, body.action, body.params);
      if (!result.ok) throw new HttpError(result.message?.startsWith('Permission denied') ? 403 : 409, result.message);
      return result;
    },
  };

  function runCommand(user, action, params) {
    const result = runtime.executeCommand(user, action, params);
    if (result.ok) {
      if (action.startsWith('snapshot')) broadcast({ type: 'snapshots', items: runtime.snapshots.list() });
      if (action === 'setAlarmLimit' || action === 'enableAlarm') broadcast({ type: 'alarmConfig', alarms: runtime.alarms.config() });
    }
    return result;
  }

  function serveStatic(req, res, url) {
    if (!hasStatic) {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME['.html'] });
      res.end('<!doctype html><title>CHEM-3D DCS</title><p>The operator client is not built. Run <code>npm run build</code> or use <code>npm run dev</code>.</p>');
      return;
    }
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      sendJson(res, 400, { error: 'Bad path' });
      return;
    }
    const root = path.resolve(staticDir);
    let file = path.resolve(root, `.${rel}`);
    if (!file.startsWith(root + path.sep) && file !== root) {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    const ext = path.extname(file);
    const immutable = rel.startsWith('/assets/');
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const key = `${req.method} ${url.pathname}`;
    const handler = routes[key];
    if (handler) {
      try {
        sendJson(res, 200, await handler(req, url));
      } catch (err) {
        const status = err.status ?? 500;
        if (status === 500) logger.error('[api]', err);
        sendJson(res, status, { error: status === 500 ? 'Internal server error' : err.message });
      }
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    serveStatic(req, res, url);
  });

  // ------------------------------------------------------------- WebSocket
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const user = auth.verify(url.searchParams.get('token'));
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = user;
      wss.emit('connection', ws, req);
    });
  });

  const send = (ws, msg) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  };

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of wss.clients) send(ws, data);
  }

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    send(ws, {
      type: 'hello',
      user: ws.user,
      config: runtime.configPayload(),
      state: runtime.liveState(),
      events: runtime.events.query({ limit: 300 }),
      snapshots: runtime.snapshots.list(),
    });
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString('utf8'));
      } catch {
        send(ws, { type: 'error', message: 'Invalid JSON' });
        return;
      }
      if (msg?.type === 'ping') {
        send(ws, { type: 'pong', t: Date.now() });
        return;
      }
      if (msg?.type === 'command' && typeof msg.action === 'string') {
        const result = runCommand(ws.user, msg.action, msg.params);
        send(ws, { type: 'result', id: msg.id ?? null, action: msg.action, ...result });
        return;
      }
      send(ws, { type: 'error', message: 'Unknown message type' });
    });
  });

  let lastSeq = runtime.events.seq;
  const broadcastTimer = setInterval(() => {
    const events = runtime.events.since(lastSeq);
    lastSeq = runtime.events.seq;
    if (wss.clients.size === 0) return;
    broadcast({ type: 'state', state: runtime.liveState(), events });
  }, broadcastMs);

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15_000);

  server.on('close', () => {
    clearInterval(broadcastTimer);
    clearInterval(heartbeat);
  });

  return {
    server,
    wss,
    close: () =>
      new Promise((resolve) => {
        clearInterval(broadcastTimer);
        clearInterval(heartbeat);
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
