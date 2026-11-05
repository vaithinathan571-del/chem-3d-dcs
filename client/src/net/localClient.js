/**
 * Standalone client: same interface as DcsClient, but the DCS runtime runs in
 * a Web Worker in this browser tab instead of on a server. Sign-in only
 * selects a demo role; there is nothing to protect in a local simulation.
 */
import { DEFAULT_USERS, publicUser } from '../../../server/src/auth/roles.js';

const USER_KEY = 'chem3d.localUser';

export class LocalDcsClient extends EventTarget {
  constructor() {
    super();
    this.standalone = true;
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
    this.connected = false;
    this.user = null;
    try {
      const raw = sessionStorage.getItem(USER_KEY);
      const name = raw && JSON.parse(raw)?.username;
      const u = DEFAULT_USERS.find((x) => x.username === name);
      if (u) this.user = publicUser(u);
    } catch {
      // no stored session
    }
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  async login(username, password) {
    const u = DEFAULT_USERS.find((x) => x.username === username && x.password === password);
    if (!u) throw new Error('Invalid username or password – use one of the demo accounts');
    this.user = publicUser(u);
    try {
      sessionStorage.setItem(USER_KEY, JSON.stringify({ username: u.username }));
    } catch {
      // session lives in memory only
    }
    return this.user;
  }

  async me() {
    return this.user;
  }

  logout() {
    this.user = null;
    try {
      sessionStorage.removeItem(USER_KEY);
    } catch {
      // ignore
    }
    this.worker?.terminate();
    this.worker = null;
  }

  connect() {
    if (!this.worker) {
      this.worker = new Worker(new URL('../local/worker.js', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (e) => this.onMessage(e.data));
      this.worker.addEventListener('error', (e) => {
        this.connected = false;
        this.emit('connection', { connected: false });
        console.error('[standalone] simulation worker failed', e.message ?? e);
      });
    }
    this.worker.postMessage({ type: 'connect', user: this.user });
  }

  onMessage(msg) {
    switch (msg.type) {
      case 'hello':
        this.connected = true;
        this.emit('connection', { connected: true });
        this.emit('hello', msg);
        break;
      case 'state':
        this.emit('state', msg);
        break;
      case 'snapshots':
        this.emit('snapshots', msg.items);
        break;
      case 'alarmConfig':
        this.emit('alarmConfig', msg.alarms);
        break;
      case 'result':
      case 'history': {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          p(msg);
        }
        break;
      }
      default:
        break;
    }
  }

  request(payload) {
    return new Promise((resolve) => {
      if (!this.worker) {
        resolve({ ok: false, message: 'Simulation not running' });
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, resolve);
      this.worker.postMessage({ ...payload, id });
    });
  }

  command(action, params = {}) {
    return this.request({ type: 'command', action, params });
  }

  async history(series, from, to, points = 600) {
    const res = await this.request({ type: 'history', series, from, to, points });
    if (res.ok === false) throw new Error(res.message);
    return res.data;
  }
}
