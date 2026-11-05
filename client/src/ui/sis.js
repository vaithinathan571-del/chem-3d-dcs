/**
 * Safety Instrumented System tab: interlock status matrix, reset, bypass and
 * the manual emergency-shutdown pushbutton.
 */
import { store } from '../store.js';
import { h, clear, setText, fmt, fmtTime } from './dom.js';
import { confirmDialog } from './notify.js';

export function createSis(root, ctx) {
  const tbody = h('tbody');
  const esdBtn = h('button.btn.esd', {
    onclick: async () => {
      const ok = await confirmDialog({
        title: 'Activate ESD-1?',
        message: 'This shuts down the reaction section: feed pump stopped, feed and steam valves closed, jacket cooling fully open, reboiler steam closed.',
        confirmLabel: 'ACTIVATE ESD',
        danger: true,
      });
      if (ok) ctx.cmd('esd', { id: 'ESD-1' }, 'ESD-1 activated');
    },
  }, 'EMERGENCY SHUTDOWN');

  root.append(h('div.sis', {},
    h('div.toolbar', {}, h('span.muted', {}, 'SIS sensors are independent of DCS transmitters. Trips latch until the condition clears and the function is reset.'), h('div.spacer'), esdBtn),
    h('div.table-wrap', {}, h('table.grid', {},
      h('thead', {}, h('tr', {}, ['Function', 'Description', 'Sensor', 'Value', 'Trip', 'Status', 'Last trip', 'Actions', ''].map((t) => h('th', {}, t)))),
      tbody))));

  const rows = new Map();
  const build = () => {
    clear(tbody);
    rows.clear();
    for (const il of store.config.interlocks) {
      const cells = { value: h('td.num-cell'), status: h('td.status-cell'), last: h('td.nowrap'), buttons: h('td.actions') };
      const actions = il.actions.map((a) => (a.motor ? `Stop ${a.motor}` : `${a.valve} → ${a.position}%`)).join(', ');
      const tr = h('tr', {},
        h('td.tag-cell', {}, il.id),
        h('td', {}, il.description),
        h('td', {}, il.sensorTag ?? 'Pushbutton'),
        cells.value,
        h('td.nowrap', {}, il.manual ? 'manual' : `${il.compare} ${il.trip} ${il.units}`),
        cells.status,
        cells.last,
        h('td.small-text', {}, actions),
        cells.buttons);
      tbody.append(tr);
      rows.set(il.id, { il, tr, cells, lastKey: '' });
    }
  };

  store.on('init', build);
  store.on('state', (s) => {
    for (const st of s.sis ?? []) {
      const r = rows.get(st.id);
      if (!r) continue;
      setText(r.cells.value, r.il.manual ? '' : `${fmt(st.value, 2)} ${r.il.units}`);
      const status = st.tripped ? (st.condition ? 'TRIPPED' : 'TRIPPED – RESET ALLOWED') : st.bypassed ? 'BYPASSED' : st.condition ? 'CONDITION (bypassed)' : 'HEALTHY';
      setText(r.cells.status, `${status}${st.firstOut && st.tripped ? ' · FIRST OUT' : ''}`);
      r.tr.dataset.status = st.tripped ? 'tripped' : st.bypassed ? 'bypassed' : 'healthy';
      setText(r.cells.last, st.trippedAt ? `${fmtTime(st.trippedAt)} (${st.tripCount}×)` : '—');
      const key = `${st.tripped}${st.bypassed}${st.condition}`;
      if (key === r.lastKey) continue;
      r.lastKey = key;
      clear(r.cells.buttons);
      if (st.tripped && store.can('ilReset')) {
        r.cells.buttons.append(h('button.btn.tiny', { disabled: st.condition && !st.bypassed, onclick: () => ctx.cmd('ilReset', { id: st.id }, `${st.id} reset`) }, 'Reset'));
      }
      if (!r.il.manual && store.can('ilBypass')) {
        r.cells.buttons.append(h(`button.btn.tiny${st.bypassed ? '' : '.warn'}`, {
          onclick: async () => {
            if (!st.bypassed) {
              const ok = await confirmDialog({ title: `Bypass ${st.id}?`, message: `${r.il.description} will not protect the plant while bypassed. This is recorded in the audit trail.`, confirmLabel: 'Bypass', danger: true });
              if (!ok) return;
            }
            ctx.cmd('ilBypass', { id: st.id, bypass: !st.bypassed });
          },
        }, st.bypassed ? 'Remove bypass' : 'Bypass'));
      }
    }
  });
  store.on('init', () => {
    esdBtn.disabled = !store.can('esd');
  });
}
