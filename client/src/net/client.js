/**
 * Network client: REST login/history and the WebSocket real-time channel
 * with automatic reconnection and request/response command correlation.
 */
const TOKEN_KEY = 'chem3d.token';

export class DcsClient extends EventTarget {
  constructor() {
    super();
    this.token = safeGet(TOKEN_KEY);
    this.ws = null;
    this.pending = new Map();
    this.nextId = 1;
    this.retry = 0;
    this.closedByUser = false;
    this.connected = false;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  async login(username, password) {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Login failed (${res.status})`);
    this.token = body.token;
    safeSet(TOKEN_KEY, body.token);
    return body.user;
  }

  /** Validate a stored token; returns the user or null. */
  async me() {
    if (!this.token) return null;
    const res = await fetch('/api/me', { headers: this.authHeaders() }).catch(() => null);
    if (!res || !res.ok) return null;
    return res.json();
  }

  logout() {
    this.closedByUser = true;
    this.token = null;
    safeRemove(TOKEN_KEY);
    this.ws?.close(1000, 'logout');
    this.ws = null;
  }

  authHeaders() {
    return { Authorization: `Bearer ${this.token}` };
  }

  connect() {
    this.closedByUser = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(this.token ?? '')}`);
    this.ws = ws;
    let gotHello = false;
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'hello':
          gotHello = true;
          this.retry = 0;
          this.connected = true;
          this.emit('connection', { connected: true });
          this.emit('hello', msg);
          break;
        case 'state':
          this.emit('state', msg);
          break;
        case 'result': {
          const p = this.pending.get(msg.id);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(msg.id);
            p.resolve(msg);
          }
          break;
        }
        case 'snapshots':
          this.emit('snapshots', msg.items);
          break;
        case 'alarmConfig':
          this.emit('alarmConfig', msg.alarms);
          break;
        default:
          break;
      }
    });
    ws.addEventListener('close', async () => {
      this.connected = false;
      this.emit('connection', { connected: false });
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.resolve({ ok: false, message: 'Connection lost' });
      }
      this.pending.clear();
      if (this.closedByUser) return;
      if (!gotHello) {
        // The upgrade may have been refused because the token expired.
        const user = await this.me();
        if (!user) {
          this.emit('unauthorized');
          return;
        }
      }
      const delay = Math.min(1000 * 2 ** this.retry, 10_000);
      this.retry += 1;
      setTimeout(() => {
        if (!this.closedByUser) this.connect();
      }, delay);
    });
  }

  /** Send a command; resolves with {ok, message?}. */
  command(action, params = {}) {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        resolve({ ok: false, message: 'Not connected to the DCS server' });
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, message: 'Command timed out' });
      }, 8000);
      this.pending.set(id, { resolve, timer });
      this.ws.send(JSON.stringify({ type: 'command', id, action, params }));
    });
  }

  async history(series, from, to, points = 600) {
    const q = new URLSearchParams({ series: series.join(','), points: String(points) });
    if (Number.isFinite(from)) q.set('from', String(from));
    if (Number.isFinite(to)) q.set('to', String(to));
    const res = await fetch(`/api/history?${q}`, { headers: this.authHeaders() });
    if (!res.ok) throw new Error(`History request failed (${res.status})`);
    return res.json();
  }
}

function safeGet(k) {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k, v) {
  try {
    sessionStorage.setItem(k, v);
  } catch {
    // storage unavailable – token lives in memory only
  }
}
function safeRemove(k) {
  try {
    sessionStorage.removeItem(k);
  } catch {
    // ignore
  }
}
