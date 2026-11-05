/**
 * Instructor station: simulation run/freeze and speed, malfunction
 * injection and snapshot (initial condition) management.
 */
import { store } from '../store.js';
import { h, clear, fmtTime, fmtDuration } from './dom.js';
import { confirmDialog } from './notify.js';

export function createInstructor(root, ctx) {
  const locked = h('div.locked', {}, 'The instructor station requires the instructor role.');
  const runBtn = h('button.btn.small', { onclick: () => ctx.cmd(store.state?.frozen ? 'simRun' : 'simFreeze', {}) }, 'Freeze');
  const speedSel = h('select', { 'aria-label': 'Simulation speed', onchange: (e) => ctx.cmd('simSpeed', { speed: Number(e.target.value) }, `Speed ${e.target.value}×`) });
  const simInfo = h('span.muted');
  const mfList = h('div.mf-list');
  const snapList = h('tbody');
  const snapName = h('input', { type: 'text', placeholder: 'Snapshot name', maxlength: 80, 'aria-label': 'Snapshot name' });

  const content = h('div.instructor', {},
    h('section.inst-sim', {},
      h('h3', {}, 'Simulation'),
      h('div.toolbar', {}, runBtn, h('label.inline', {}, 'Speed ', speedSel), simInfo)),
    h('section.inst-mf', {}, h('h3', {}, 'Malfunctions'), mfList),
    h('section.inst-snap', {},
      h('h3', {}, 'Snapshots'),
      h('div.toolbar', {}, snapName, h('button.btn.small', {
        onclick: async () => {
          const r = await ctx.cmd('snapshotSave', { name: snapName.value || `Snapshot ${new Date().toLocaleTimeString()}` }, 'Snapshot saved');
          if (r.ok) snapName.value = '';
        },
      }, 'Save current state')),
      h('div.table-wrap', {}, h('table.grid', {}, h('thead', {}, h('tr', {}, ['Name', 'Saved', 'By', 'Sim time', ''].map((t) => h('th', {}, t)))), snapList))));

  const mfRows = new Map();
  const build = () => {
    clear(root);
    if (!store.can('sim')) {
      root.append(locked);
      return;
    }
    root.append(content);
    clear(speedSel);
    for (const s of store.config.simSpeeds) speedSel.append(h('option', { value: s }, `${s}×`));
    clear(mfList);
    mfRows.clear();
    const groups = new Map();
    for (const mf of store.config.malfunctions) {
      if (!groups.has(mf.category)) groups.set(mf.category, []);
      groups.get(mf.category).push(mf);
    }
    for (const [cat, items] of groups) {
      mfList.append(h('h4', {}, cat));
      for (const mf of items) {
        const toggle = h('button.btn.tiny', { onclick: () => {
          const active = store.state?.malfunctions?.some((m) => m.id === mf.id);
          ctx.cmd('malfunction', { id: mf.id, active: !active }, `${mf.id} ${active ? 'cleared' : 'activated'}`);
        } }, 'Activate');
        const since = h('span.muted.small-text');
        const row = h('div.mf', {}, h('div.mf-text', {}, h('strong', {}, `${mf.id} ${mf.name}`), h('div.small-text.muted', {}, mf.description)), since, toggle);
        mfList.append(row);
        mfRows.set(mf.id, { row, toggle, since });
      }
    }
    drawSnapshots(store.snapshots);
  };

  function drawSnapshots(items) {
    clear(snapList);
    for (const s of items) {
      snapList.append(h('tr', {},
        h('td', {}, s.name, s.builtin ? h('span.badge.small', {}, 'built-in') : null),
        h('td.nowrap', {}, fmtTime(s.createdAt, true)),
        h('td', {}, s.createdBy),
        h('td.nowrap', {}, fmtDuration(s.simTime ?? 0)),
        h('td.actions', {},
          h('button.btn.tiny', {
            onclick: async () => {
              if (await confirmDialog({ title: `Load "${s.name}"?`, message: 'The current plant state will be replaced. Alarms are reset; the event journal is kept.', confirmLabel: 'Load snapshot' })) {
                ctx.cmd('snapshotLoad', { id: s.id }, `Snapshot "${s.name}" loaded`);
              }
            },
          }, 'Load'),
          s.builtin ? null : h('button.btn.tiny.warn', { onclick: () => ctx.cmd('snapshotDelete', { id: s.id }) }, 'Delete'))));
    }
  }

  store.on('init', build);
  store.on('snapshots', (items) => {
    if (store.can('sim')) drawSnapshots(items);
  });
  store.on('state', (s) => {
    if (!store.can('sim')) return;
    runBtn.textContent = s.frozen ? '▶ Run' : '⏸ Freeze';
    runBtn.classList.toggle('primary', s.frozen);
    if (document.activeElement !== speedSel) speedSel.value = String(s.speed);
    simInfo.textContent = `Simulated time ${fmtDuration(s.simTime)} · ${s.malfunctions.length} malfunction(s) active`;
    const active = new Map(s.malfunctions.map((m) => [m.id, m.since]));
    for (const [id, r] of mfRows) {
      const on = active.has(id);
      r.row.classList.toggle('active', on);
      r.toggle.textContent = on ? 'Clear' : 'Activate';
      r.toggle.classList.toggle('warn', !on);
      r.since.textContent = on ? `since ${fmtTime(active.get(id))}` : '';
    }
  });
}
