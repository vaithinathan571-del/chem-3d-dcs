/**
 * Standalone mode: hosts the complete DCS runtime (process model, control,
 * SIS, alarms, historian) inside a Web Worker and speaks the same message
 * protocol as the server WebSocket. Used for static hosting (GitHub Pages).
 */
import { PlantRuntime } from '../../../server/src/runtime.js';

const BROADCAST_MS = 500;

let runtime = null;
let user = null;
let lastSeq = 0;
let timer = null;

const post = (msg) => self.postMessage(msg);

function ensureRuntime() {
  if (runtime) return;
  runtime = new PlantRuntime({ prerunSeconds: 4 * 3600 }).initialise();
  runtime.start();
  lastSeq = runtime.events.seq;
}

function startBroadcast() {
  clearInterval(timer);
  timer = setInterval(() => {
    const events = runtime.events.since(lastSeq);
    lastSeq = runtime.events.seq;
    post({ type: 'state', state: runtime.liveState(), events });
  }, BROADCAST_MS);
}

self.onmessage = (e) => {
  const msg = e.data ?? {};
  try {
    switch (msg.type) {
      case 'connect': {
        user = msg.user;
        ensureRuntime();
        runtime.events.add({ category: 'SYSTEM', user: user.username, message: `User ${user.username} (${user.role}) logged in – standalone browser simulation` });
        post({
          type: 'hello',
          user,
          config: runtime.configPayload(),
          state: runtime.liveState(),
          events: runtime.events.query({ limit: 300 }),
          snapshots: runtime.snapshots.list(),
        });
        lastSeq = runtime.events.seq;
        startBroadcast();
        break;
      }
      case 'command': {
        const result = runtime.executeCommand(user, msg.action, msg.params);
        post({ type: 'result', id: msg.id, action: msg.action, ...result });
        if (result.ok && msg.action.startsWith('snapshot')) post({ type: 'snapshots', items: runtime.snapshots.list() });
        if (result.ok && (msg.action === 'setAlarmLimit' || msg.action === 'enableAlarm')) post({ type: 'alarmConfig', alarms: runtime.alarms.config() });
        break;
      }
      case 'history': {
        const data = runtime.historian.query(msg.series, msg.from ?? -Infinity, msg.to ?? Infinity, msg.points ?? 600);
        post({ type: 'history', id: msg.id, data });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    if (msg.id !== undefined) post({ type: msg.type === 'history' ? 'history' : 'result', id: msg.id, ok: false, message: err.message });
    else post({ type: 'error', message: err.message });
  }
};
