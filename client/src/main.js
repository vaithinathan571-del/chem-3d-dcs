/**
 * CHEM-3D DCS operator client – application shell and bootstrap.
 */
import './styles.css';
import { DcsClient } from './net/client.js';
import { store } from './store.js';
import { h, clear, setText, fmtTime, fmtDuration } from './ui/dom.js';
import { toast, report, Horn } from './ui/notify.js';
import { createFaceplatePanel } from './ui/faceplate.js';
import { createAlarmBanner, createAlarmSummary } from './ui/alarms.js';
import { createOverview } from './ui/overview.js';
import { createTrends } from './ui/trends.js';
import { createEvents } from './ui/events.js';
import { createSis } from './ui/sis.js';
import { createInstructor } from './ui/instructor.js';
import { createTraining, mmss } from './ui/training.js';

const app = document.getElementById('app');
/** Standalone builds (GitHub Pages) run the DCS runtime in a Web Worker instead of on a server. */
const STANDALONE = import.meta.env.VITE_STANDALONE === '1';
const client = STANDALONE ? new (await import('./net/localClient.js')).LocalDcsClient() : new DcsClient();
const ICON = `${import.meta.env.BASE_URL}favicon.svg`;
const horn = new Horn();

const pref = {
  get(k, d) {
    try {
      return localStorage.getItem(`chem3d.${k}`) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`chem3d.${k}`, v);
    } catch {
      // ignore – preferences are optional
    }
  },
};

// ------------------------------------------------------------------- login
function showLogin(message) {
  clear(app);
  const user = h('input', { name: 'username', autocomplete: 'username', required: true, 'aria-label': 'Username', placeholder: 'Username' });
  const pass = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'Password', placeholder: 'Password' });
  const err = h('div.login-error', { role: 'alert' }, message ?? '');
  const submit = h('button.btn.primary.wide', { type: 'submit' }, 'Sign in');
  let busy = false;
  const form = h('form.login-card', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      submit.disabled = true;
      err.textContent = '';
      try {
        await client.login(user.value.trim(), pass.value);
        startApp();
      } catch (ex) {
        err.textContent = ex.message;
        submit.disabled = false;
        busy = false;
      }
    },
  },
  h('div.login-brand', {}, h('img', { src: ICON, alt: '', width: 40, height: 40 }), h('div', {}, h('h1', {}, 'CHEM-3D DCS'), h('p', {}, 'Unit 100 operator console'))),
  STANDALONE ? h('p.standalone-note', {}, 'Standalone demo – the plant simulation runs entirely in your browser. Sign in with a demo account to choose your role.') : null,
  h('label', {}, 'Username', user),
  h('label', {}, 'Password', pass),
  err,
  submit,
  h('details.demo', { open: STANDALONE },
    h('summary', {}, 'Demo accounts'),
    h('p.muted', {}, STANDALONE
      ? 'Click an account to sign in with that role.'
      : 'Click an account to sign in. Default accounts are active until DCS_USERS is configured on the server.'),
    h('div.demo-grid', {}, ['operator', 'engineer', 'instructor', 'viewer'].map((u) => h('button.btn.small', {
      type: 'button',
      title: `Sign in as ${u}`,
      onclick: () => {
        if (busy) return;
        user.value = u;
        pass.value = u;
        form.requestSubmit();
      },
    }, u)))));
  app.append(h('div.login', {}, form));
  user.focus();
}

// --------------------------------------------------------------------- app
function startApp() {
  buildShell();
  client.connect();
}

function buildShell() {
  clear(app);

  const cmd = async (action, params, okMessage) => {
    const r = await client.command(action, params);
    report(r, okMessage);
    return r;
  };

  // Top bar
  const clock = h('span.clock');
  const simTime = h('span.simtime');
  const speed = h('span.badge.speed');
  const frozen = h('span.badge.frozen', { hidden: true }, 'FROZEN');
  const trainingBadge = h('button.badge.training-badge', { hidden: true, title: 'Exercise in progress – open the Training tab', onclick: () => selectTab('training') });
  const conn = h('span.conn', { title: 'Connection' });
  const userEl = h('span.user');
  const topbar = h('header.topbar', {},
    h('div.brand', {}, h('img', { src: ICON, alt: '', width: 22, height: 22 }), h('span', {}, 'CHEM-3D DCS')),
    h('div.plant-name'),
    h('div.top-status', {}, clock, simTime, speed, frozen, trainingBadge,
      STANDALONE ? h('span.badge.standalone', { title: 'Standalone demo – the simulation runs in this browser tab' }, 'BROWSER SIM') : null),
    h('div.top-right', {}, conn, userEl,
      h('button.btn.small', { onclick: () => { client.logout(); location.reload(); } }, 'Sign out')));

  const banner = h('div.alarm-banner', { role: 'region', 'aria-label': 'Alarm banner' });

  // Main area
  const viewport = h('div.viewport');
  const viewButtons = [['overview', 'Overview'], ['feed', 'Feed'], ['reactor', 'Reactor'], ['column', 'Column'], ['product', 'Product']]
    .map(([k, label]) => h('button.btn.small.ghost', { onclick: () => scene?.flyTo(k) }, label));
  const labelSel = h('select.small', { 'aria-label': 'Labels', onchange: (e) => { scene?.setLabelMode(e.target.value); pref.set('labels', e.target.value); } },
    h('option', { value: 'values' }, 'Labels: values'), h('option', { value: 'names' }, 'Labels: names'), h('option', { value: 'off' }, 'Labels: off'));
  labelSel.value = pref.get('labels', window.innerWidth < 760 ? 'names' : 'values');
  const legend = h('div.legend3d', {},
    h('span', {}, h('i.sw.a'), 'Reactant A'), h('span', {}, h('i.sw.b'), 'Product B'),
    h('span', {}, h('i.sw.run'), 'Running'), h('span', {}, h('i.sw.forced'), 'SIS forced'));
  const viewToolbar = h('div.view-toolbar', {}, viewButtons, labelSel);
  const loading = h('div.loading', {}, 'Loading 3D plant…');
  viewport.append(viewToolbar, legend, loading);

  const side = h('aside.side', { 'aria-label': 'Faceplate' });
  const main = h('main.main', {}, viewport, side);

  // Dock
  const tabs = [
    ['overview', 'Overview'], ['alarms', 'Alarms'], ['trends', 'Trends'], ['events', 'Events'], ['sis', 'Safety (SIS)'], ['training', 'Training'], ['instructor', 'Instructor'],
  ];
  const panes = Object.fromEntries(tabs.map(([k]) => [k, h(`div.pane.pane-${k}`, { role: 'tabpanel', id: `pane-${k}` })]));
  const alarmCount = h('span.tab-count');
  const tabButtons = tabs.map(([k, label]) => h('button.tab', { role: 'tab', 'aria-controls': `pane-${k}`, dataset: { tab: k }, onclick: () => selectTab(k) }, label, k === 'alarms' ? alarmCount : null));
  const dock = h('section.dock', {}, h('div.tabs', { role: 'tablist' }, tabButtons), h('div.panes', {}, Object.values(panes)));
  const resizer = h('div.dock-resizer', { title: 'Drag to resize', role: 'separator', 'aria-orientation': 'horizontal' });

  const shell = h('div.shell', {}, topbar, banner, main, resizer, dock);
  app.append(shell);

  let eventsPanel = null;
  function selectTab(k) {
    for (const b of tabButtons) {
      b.classList.toggle('active', b.dataset.tab === k);
      b.setAttribute('aria-selected', String(b.dataset.tab === k));
    }
    for (const [key, p] of Object.entries(panes)) p.hidden = key !== k;
    pref.set('tab', k);
    if (k === 'events') eventsPanel?.refresh();
    if (k === 'trends') window.dispatchEvent(new Event('resize'));
  }

  // Dock resize
  const setDock = (px) => {
    const v = Math.min(Math.max(px, 120), window.innerHeight * 0.75);
    shell.style.setProperty('--dock-h', `${v}px`);
    pref.set('dockH', String(Math.round(v)));
  };
  setDock(Number(pref.get('dockH', 300)));
  resizer.addEventListener('pointerdown', (e) => {
    resizer.setPointerCapture(e.pointerId);
    const move = (ev) => setDock(window.innerHeight - ev.clientY);
    const up = () => {
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', up);
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', up);
  });

  // 3D scene is loaded lazily so the shell paints immediately.
  let scene = null;
  const ctx = {
    cmd,
    horn,
    focus: (id) => scene?.focusOn(id),
    addToTrend: (series) => {
      trends.addPens(series);
      selectTab('trends');
    },
    openTab: (k) => selectTab(k),
    setTrainingBadge: (a) => {
      trainingBadge.hidden = !a;
      if (a) setText(trainingBadge, `🎓 ${a.scenarioId} ${mmss(a.elapsed)}/${mmss(a.duration)} · ${a.score}`);
    },
  };

  createAlarmBanner(banner, ctx);
  createFaceplatePanel(side, ctx);
  createOverview(panes.overview);
  createAlarmSummary(panes.alarms, ctx);
  const trends = createTrends(panes.trends, client);
  eventsPanel = createEvents(panes.events);
  createSis(panes.sis, ctx);
  createTraining(panes.training, ctx);
  createInstructor(panes.instructor, ctx);
  selectTab(pref.get('tab', 'overview'));

  import('./scene/PlantScene.js')
    .then(({ PlantScene }) => {
      try {
        scene = new PlantScene(viewport);
        scene.setLabelMode(labelSel.value);
        if (store.state) store.emit('state', store.state);
      } catch (err) {
        loading.textContent = `3D view unavailable: ${err.message}`;
        return;
      }
      loading.remove();
    })
    .catch((err) => {
      loading.textContent = `Failed to load 3D view: ${err.message}`;
    });

  // Network wiring
  client.addEventListener('hello', (e) => {
    const { user, config, state, events, snapshots, trainingResults } = e.detail;
    store.init({ user, config, state, events, snapshots, trainingResults });
    setText(topbar.querySelector('.plant-name'), config.plant.name);
    setText(userEl, `${user.displayName} · ${user.role}`);
    document.title = `CHEM-3D DCS – ${config.plant.id}`;
  });
  client.addEventListener('state', (e) => {
    if (e.detail.trainingResults) store.setTrainingResults(e.detail.trainingResults);
    store.update(e.detail.state, e.detail.events);
  });
  client.addEventListener('snapshots', (e) => store.setSnapshots(e.detail));
  client.addEventListener('alarmConfig', (e) => store.updateAlarmConfig(e.detail));
  client.addEventListener('connection', (e) => {
    conn.classList.toggle('online', e.detail.connected);
    conn.title = e.detail.connected ? 'Connected to DCS server' : 'Connection lost – reconnecting…';
    shell.classList.toggle('offline', !e.detail.connected);
  });
  client.addEventListener('unauthorized', () => {
    client.logout();
    location.replace(`${location.pathname}?expired=1`);
  });

  store.on('state', (s) => {
    setText(clock, fmtTime(s.t));
    setText(simTime, `SIM ${fmtDuration(s.simTime)}`);
    setText(speed, `${s.speed}×`);
    speed.classList.toggle('fast', s.speed !== 1);
    frozen.hidden = !s.frozen;
    const n = s.alarmSummary?.unacked ?? 0;
    setText(alarmCount, n ? String(n) : '');
  });
  store.on('newEvents', (events) => {
    const urgent = events.find((e) => e.category === 'ALARM' && (e.priority === 'CRITICAL' || e.priority === 'HIGH'));
    if (urgent) horn.beep(urgent.priority);
    for (const e of events) if (e.category === 'SIS' && e.priority === 'CRITICAL') toast(e.message, 'error', 8000);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches?.('input, select, textarea')) return;
    if (e.key === 'Escape') store.select(null);
    if (e.key === 'f' && store.selection) scene?.focusOn(store.selection.id);
  });
}

// ------------------------------------------------------------------- boot
(async () => {
  const expired = new URLSearchParams(location.search).has('expired');
  if (expired) history.replaceState(null, '', location.pathname);
  const user = await client.me();
  if (user) startApp();
  else showLogin(expired ? 'Your session has expired – please sign in again.' : undefined);
})();
