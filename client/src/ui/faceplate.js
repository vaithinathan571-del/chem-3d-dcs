/**
 * Faceplates: the detail panel for the selected loop, indicator, motor or
 * equipment item. Built once per selection, values refreshed on every state
 * update.
 */
import { store } from '../store.js';
import { h, clear, setText, fmt, PRIORITY_CLASS } from './dom.js';
import { confirmDialog } from './notify.js';

const LIMIT_ORDER = ['HIHI', 'HI', 'LO', 'LOLO'];

export function createFaceplatePanel(root, ctx) {
  let refresh = null;

  const render = (sel) => {
    clear(root);
    refresh = null;
    if (!sel || !store.config) {
      root.append(emptyState());
      return;
    }
    let built = null;
    if (sel.kind === 'point') built = store.index.loops.has(sel.id) ? loopFaceplate(sel.id, ctx) : pointFaceplate(sel.id, ctx);
    else if (sel.kind === 'motor') built = motorFaceplate(sel.id, ctx);
    else if (sel.kind === 'equipment') built = equipmentFaceplate(sel.id, ctx);
    if (!built) {
      root.append(emptyState(`No faceplate for ${sel.id}`));
      return;
    }
    root.append(built.el);
    refresh = built.update;
    if (store.state) refresh(store.state);
  };

  store.on('select', render);
  store.on('state', (s) => refresh?.(s));
  store.on('alarmConfig', () => render(store.selection));
  render(null);
}

function emptyState(msg) {
  return h('div.fp-empty', {},
    h('div.fp-empty-icon', { 'aria-hidden': 'true' }, '⌖'),
    h('p', {}, msg ?? 'Select equipment, a valve or a data card in the 3D view, or a tag in the overview, to open its faceplate.'),
    h('ul.fp-hints', {},
      h('li', {}, 'Left-drag to orbit, right-drag to pan, wheel to zoom'),
      h('li', {}, 'Double-click equipment to fly to it'),
      h('li', {}, 'Flashing equipment has unacknowledged alarms')));
}

function header(tag, description, ctx, { trendSeries, focusId } = {}) {
  return h('div.fp-head', {},
    h('div.fp-title', {}, h('h2', {}, tag), h('div.fp-desc', {}, description ?? '')),
    h('div.fp-head-actions', {},
      focusId ? h('button.icon-btn', { title: 'Fly to in 3D', 'aria-label': 'Fly to in 3D', onclick: () => ctx.focus(focusId) }, '◎') : null,
      trendSeries ? h('button.icon-btn', { title: 'Add to trend', 'aria-label': 'Add to trend', onclick: () => ctx.addToTrend(trendSeries) }, '📈') : null,
      h('button.icon-btn', { title: 'Close', 'aria-label': 'Close faceplate', onclick: () => store.select(null) }, '✕')));
}

function numberEntry({ label, step, onSubmit, disabled = false }) {
  const input = h('input.num', { type: 'number', step: String(step ?? 'any'), 'aria-label': label, disabled });
  const submit = () => {
    if (input.value === '') return;
    onSubmit(Number(input.value));
    input.value = '';
    input.blur();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  const btn = h('button.btn.small', { onclick: submit, disabled }, 'Set');
  return { input, btn, el: h('div.entry', {}, input, btn) };
}

/** Vertical bar with PV fill, SP marker and alarm limit ticks. */
function barGraph(lo, hi) {
  const fill = h('div.bar-fill');
  const sp = h('div.bar-sp', { title: 'Setpoint' });
  const limits = h('div.bar-limits');
  const el = h('div.bar', {}, fill, limits, sp, h('div.bar-scale', {}, h('span', {}, fmt(hi, 0)), h('span', {}, fmt(lo, 0))));
  const pct = (v) => Math.min(Math.max(((v - lo) / (hi - lo)) * 100, 0), 100);
  return {
    el,
    update({ pv, spv, alarms, bad }) {
      fill.style.height = `${Number.isFinite(pv) ? pct(pv) : 0}%`;
      fill.classList.toggle('bad', !!bad);
      if (Number.isFinite(spv)) {
        sp.style.display = '';
        sp.style.bottom = `${pct(spv)}%`;
      } else sp.style.display = 'none';
      clear(limits);
      for (const a of alarms ?? []) {
        if (!Number.isFinite(a.limit) || !LIMIT_ORDER.includes(a.type)) continue;
        limits.append(h(`div.bar-limit.${PRIORITY_CLASS[a.priority]}`, { style: { bottom: `${pct(a.limit)}%` }, title: `${a.type} ${a.limit}` }));
      }
    },
  };
}

function opBar() {
  const fill = h('div.opbar-fill');
  const el = h('div.opbar', { title: 'Controller output' }, fill);
  return { el, update: (op) => (fill.style.width = `${Math.min(Math.max(op ?? 0, 0), 100)}%`) };
}

function alarmTable(tag, ctx, decimals) {
  const defs = (store.index.alarmsByTag.get(tag) ?? []).filter((a) => a.limit !== undefined);
  if (!defs.length) return { el: null, update() {} };
  const canEdit = store.can('alarmConfig');
  const stateCells = new Map();
  const rows = defs
    .sort((a, b) => LIMIT_ORDER.indexOf(a.type) - LIMIT_ORDER.indexOf(b.type))
    .map((a) => {
      const st = h('td.al-state');
      stateCells.set(a.id, st);
      let limitCell = h('td', {}, fmt(a.limit, decimals));
      if (canEdit && a.type !== 'DEV') {
        const input = h('input.num.tiny', { type: 'number', value: String(a.limit), step: 'any', 'aria-label': `${a.type} limit` });
        input.addEventListener('change', () => ctx.cmd('setAlarmLimit', { id: a.id, limit: Number(input.value) }, `${a.id} limit set to ${input.value}`));
        limitCell = h('td', {}, input);
      } else if (canEdit) {
        limitCell = h('td', {}, fmt(a.limit, decimals));
      }
      const enable = canEdit
        ? h('td', {}, h('input', { type: 'checkbox', checked: a.enabled, 'aria-label': `Enable ${a.id}`, onchange: (e) => ctx.cmd('enableAlarm', { id: a.id, enabled: e.target.checked }) }))
        : h('td', {}, a.enabled ? '✓' : '—');
      return h('tr', {}, h('td', {}, a.type), limitCell, h(`td.${PRIORITY_CLASS[a.priority]}-text`, {}, a.priority), enable, st);
    });
  const el = h('div.fp-section', {},
    h('h3', {}, 'Alarm limits'),
    h('table.mini', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Type'), h('th', {}, 'Limit'), h('th', {}, 'Priority'), h('th', {}, 'Enabled'), h('th', {}, 'State'))), h('tbody', {}, rows)));
  return {
    el,
    update(state) {
      const active = new Map((state.alarms ?? []).map((a) => [a.id, a.state]));
      for (const [id, cell] of stateCells) {
        const s = active.get(id) ?? 'NORMAL';
        setText(cell, s);
        cell.dataset.state = s;
      }
    },
  };
}

function loopFaceplate(tag, ctx) {
  const loop = store.index.loops.get(tag);
  const point = store.index.points.get(tag);
  const decimals = point?.decimals ?? 2;
  const span = (loop.hi ?? 100) - (loop.lo ?? 0);
  const canOperate = store.can('operate');
  const canTune = store.can('tune');
  const alarms = () => store.index.alarmsByTag.get(tag) ?? [];

  const badges = h('div.badges');
  const pvVal = h('span.big-val');
  const spVal = h('span.val');
  const opVal = h('span.val');
  const bar = loop.manualOnly ? null : barGraph(loop.lo, loop.hi);
  const ob = opBar();

  const modeButtons = loop.modes.map((m) =>
    h(`button.mode-btn.mode-${m.toLowerCase()}`, {
      disabled: !canOperate,
      onclick: () => ctx.cmd('setMode', { tag, mode: m }),
    }, m));

  const spEntry = numberEntry({ label: 'New setpoint', step: span / 1000, disabled: !canOperate || loop.manualOnly, onSubmit: (v) => ctx.cmd('setSP', { tag, value: v }) });
  const opEntry = numberEntry({ label: 'New output', step: 0.1, disabled: !canOperate, onSubmit: (v) => ctx.cmd('setOP', { tag, value: v }) });
  const nudge = (field, delta) => {
    const s = store.state?.loops?.[tag];
    if (!s) return;
    if (field === 'sp') ctx.cmd('setSP', { tag, value: s.sp + delta });
    else ctx.cmd('setOP', { tag, value: s.op + delta });
  };
  const spStep = span / 100;

  const kc = h('input.num.tiny', { type: 'number', step: '0.1', disabled: !canTune, 'aria-label': 'Kc' });
  const ti = h('input.num.tiny', { type: 'number', step: '1', disabled: !canTune, 'aria-label': 'Ti' });
  const td = h('input.num.tiny', { type: 'number', step: '1', disabled: !canTune, 'aria-label': 'Td' });
  let tuningLoaded = false;
  const tuning = loop.manualOnly
    ? null
    : h('div.fp-section', {},
      h('h3', {}, 'Tuning ', canTune ? null : h('span.muted', {}, '(engineer)')),
      h('div.tuning', {},
        h('label', {}, 'Kc', kc), h('label', {}, 'Ti [s]', ti), h('label', {}, 'Td [s]', td),
        h('button.btn.small', {
          disabled: !canTune,
          onclick: () => ctx.cmd('setTuning', { tag, kc: Number(kc.value), ti: Number(ti.value), td: Number(td.value) }, `${tag} tuning updated`),
        }, 'Apply')));

  const at = alarmTable(tag, ctx, decimals);
  const outputText = loop.output.valve ? `→ ${loop.output.valve}` : loop.output.cascade ? `→ ${loop.output.cascade}.SP (${loop.output.lo}–${loop.output.hi})` : '';

  const el = h('div.fp', {},
    header(tag, loop.description, ctx, {
      trendSeries: loop.manualOnly ? [`${tag}.OP`] : [`${tag}.PV`, `${tag}.SP`, `${tag}.OP`],
      focusId: loop.output.valve ?? point?.equipment,
    }),
    badges,
    h('div.fp-main', {},
      bar ? bar.el : null,
      h('div.fp-values', {},
        loop.manualOnly ? null : h('div.pv-row', {}, h('span.lbl', {}, 'PV'), pvVal, h('span.unit', {}, loop.units)),
        loop.manualOnly ? null : h('div.kv', {}, h('span.lbl', {}, 'SP'), spVal, h('span.unit', {}, loop.units),
          h('button.icon-btn.small', { disabled: !canOperate, title: 'SP down', 'aria-label': 'Setpoint down', onclick: () => nudge('sp', -spStep) }, '▼'),
          h('button.icon-btn.small', { disabled: !canOperate, title: 'SP up', 'aria-label': 'Setpoint up', onclick: () => nudge('sp', spStep) }, '▲')),
        loop.manualOnly ? null : spEntry.el,
        h('div.kv', {}, h('span.lbl', {}, 'OP'), opVal, h('span.unit', {}, '%'),
          h('button.icon-btn.small', { disabled: !canOperate, title: 'OP down', 'aria-label': 'Output down', onclick: () => nudge('op', -1) }, '▼'),
          h('button.icon-btn.small', { disabled: !canOperate, title: 'OP up', 'aria-label': 'Output up', onclick: () => nudge('op', 1) }, '▲')),
        ob.el,
        opEntry.el,
        h('div.modes', { role: 'group', 'aria-label': 'Mode' }, modeButtons))),
    tuning,
    at.el,
    h('div.fp-section.info', {},
      h('h3', {}, 'Configuration'),
      h('dl', {},
        h('dt', {}, 'Action'), h('dd', {}, loop.manualOnly ? 'Manual loader' : `${loop.action}-acting`),
        h('dt', {}, 'Output'), h('dd', {}, outputText),
        loop.master ? [h('dt', {}, 'Cascade master'), h('dd', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); store.select({ kind: 'point', id: loop.master }); } }, loop.master))] : null,
        loop.output.cascade ? [h('dt', {}, 'Cascade slave'), h('dd', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); store.select({ kind: 'point', id: loop.output.cascade }); } }, loop.output.cascade))] : null,
        h('dt', {}, 'Range'), h('dd', {}, `${loop.lo} – ${loop.hi} ${loop.units}`))));

  return {
    el,
    update(state) {
      const s = state.loops?.[tag];
      if (!s) return;
      const pv = state.points?.[tag];
      const bad = state.bad?.includes(tag);
      if (!loop.manualOnly) {
        setText(pvVal, bad ? 'BAD' : fmt(pv, decimals));
        pvVal.classList.toggle('bad', !!bad);
        setText(spVal, fmt(s.sp, decimals));
        bar.update({ pv, spv: s.sp, alarms: alarms(), bad });
      }
      setText(opVal, fmt(s.op, 1));
      ob.update(s.op);
      for (const b of modeButtons) b.classList.toggle('active', b.textContent === s.mode);
      const inMan = s.mode === 'MAN' && !s.il;
      opEntry.input.disabled = !canOperate || !inMan;
      opEntry.btn.disabled = !canOperate || !inMan;
      spEntry.input.disabled = !canOperate || s.mode === 'CAS' || loop.manualOnly;
      spEntry.btn.disabled = spEntry.input.disabled;
      if (!tuningLoaded && tuning) {
        kc.value = String(s.kc);
        ti.value = String(s.ti);
        td.value = String(s.td);
        tuningLoaded = true;
      }
      const tagAlarms = (state.alarms ?? []).filter((a) => a.tag === tag && a.state !== 'SHELVED');
      clear(badges);
      badges.append(h(`span.badge.mode-${s.mode.toLowerCase()}`, {}, s.mode));
      if (s.iman) badges.append(h('span.badge.warn', { title: 'Initialisation manual – slave not in CAS' }, 'IMAN'));
      if (s.il) badges.append(h('span.badge.forced', {}, `INTERLOCKED ${s.il.join(', ')}`));
      if (s.shed) badges.append(h('span.badge.p2', {}, `SHED: ${s.shed}`));
      if (bad) badges.append(h('span.badge.p2', {}, 'BAD PV'));
      for (const a of tagAlarms) badges.append(h(`span.badge.${PRIORITY_CLASS[a.priority]}${a.state === 'UNACK' ? '.blink' : ''}`, { title: a.text }, a.type));
      at.update(state);
    },
  };
}

function pointFaceplate(tag, ctx) {
  const point = store.index.points.get(tag);
  if (!point) return null;
  const decimals = point.decimals ?? 2;
  const pvVal = h('span.big-val');
  const badges = h('div.badges');
  const bar = barGraph(point.lo, point.hi);
  const at = alarmTable(tag, ctx, decimals);
  const el = h('div.fp', {},
    header(tag, point.description, ctx, { trendSeries: [`${tag}.PV`], focusId: point.equipment }),
    badges,
    h('div.fp-main', {}, bar.el,
      h('div.fp-values', {},
        h('div.pv-row', {}, h('span.lbl', {}, 'PV'), pvVal, h('span.unit', {}, point.units)),
        h('dl.compact', {},
          h('dt', {}, 'Range'), h('dd', {}, `${point.lo} – ${point.hi} ${point.units}`),
          h('dt', {}, 'Equipment'), h('dd', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); store.select({ kind: 'equipment', id: point.equipment }); } }, point.equipment))))),
    at.el);
  return {
    el,
    update(state) {
      const pv = state.points?.[tag];
      const bad = state.bad?.includes(tag);
      setText(pvVal, bad ? 'BAD' : fmt(pv, decimals));
      pvVal.classList.toggle('bad', !!bad);
      bar.update({ pv, alarms: store.index.alarmsByTag.get(tag), bad });
      clear(badges);
      if (bad) badges.append(h('span.badge.p2', {}, 'BAD PV'));
      for (const a of (state.alarms ?? []).filter((x) => x.tag === tag && x.state !== 'SHELVED')) {
        badges.append(h(`span.badge.${PRIORITY_CLASS[a.priority]}${a.state === 'UNACK' ? '.blink' : ''}`, { title: a.text }, a.type));
      }
      at.update(state);
    },
  };
}

function motorFaceplate(id, ctx) {
  const m = store.index.motors.get(id);
  if (!m) return null;
  const canOperate = store.can('operate');
  const lamp = h('div.lamp');
  const status = h('span.big-val');
  const speed = h('span.val');
  const current = h('span.val');
  const perms = h('ul.perms');
  const extra = h('div.badges');
  const start = h('button.btn.start', { disabled: !canOperate, onclick: () => ctx.cmd('motorStart', { id }, `${id} start command sent`) }, 'START');
  const stop = h('button.btn.stop', {
    disabled: !canOperate,
    onclick: async () => {
      if (await confirmDialog({ title: `Stop ${id}?`, message: `${m.description} will be stopped.`, confirmLabel: 'Stop', danger: true })) ctx.cmd('motorStop', { id }, `${id} stop command sent`);
    },
  }, 'STOP');
  const el = h('div.fp', {},
    header(id, m.description, ctx, { focusId: id }),
    extra,
    h('div.motor-main', {}, lamp, h('div', {}, status, h('div.kv', {}, h('span.lbl', {}, 'Speed'), speed, h('span.unit', {}, '%')), h('div.kv', {}, h('span.lbl', {}, 'Current'), current, h('span.unit', {}, 'A')))),
    h('div.motor-buttons', {}, start, stop),
    h('div.fp-section', {}, h('h3', {}, 'Start permissives'), perms),
    h('div.fp-section.info', {}, h('h3', {}, 'Nameplate'), h('dl', {}, h('dt', {}, 'Type'), h('dd', {}, m.kind), h('dt', {}, 'Rated power'), h('dd', {}, `${m.ratedPower} kW`), h('dt', {}, 'Rated current'), h('dd', {}, `${m.ratedCurrent} A`))));
  return {
    el,
    update(state) {
      const s = state.motors?.[id];
      if (!s) return;
      setText(status, s.status);
      lamp.dataset.status = s.status;
      status.dataset.status = s.status;
      setText(speed, fmt(s.speed * 100, 0));
      setText(current, fmt(s.current, 1));
      clear(perms);
      m.permissives.forEach((p, i) => perms.append(h(`li.${s.permissives?.[i] ? 'ok' : 'nok'}`, {}, s.permissives?.[i] ? '✓ ' : '✗ ', p.description)));
      for (const il of s.inhibit ?? []) perms.append(h('li.nok', {}, `✗ Start inhibited by ${il} (SIS trip latched)`));
      clear(extra);
      if (s.failed) extra.append(h('span.badge.p1', {}, 'MOTOR FAULT'));
      if (s.tripReason) extra.append(h('span.badge.p2', {}, `TRIP: ${s.tripReason}`));
      if (s.inhibit) extra.append(h('span.badge.forced', {}, `INHIBITED ${s.inhibit.join(', ')}`));
    },
  };
}

function equipmentFaceplate(id, ctx) {
  const eq = store.index.equipment.get(id);
  const valve = store.index.valves.get(id);
  if (!eq && !valve) return null;
  const tags = eq?.points ?? [];
  const motors = [...store.index.motors.values()].filter((m) => m.id === id || (id === 'R-101' && m.id === 'M-101'));
  const rows = tags.map((tag) => {
    const meta = store.index.points.get(tag) ?? store.index.loops.get(tag);
    const val = h('td.num-cell');
    const mode = h('td.mode-cell');
    const tr = h('tr.clickable', { onclick: () => store.select({ kind: 'point', id: tag }) },
      h('td.tag-cell', {}, tag), h('td', {}, meta?.description ?? ''), val, h('td.unit', {}, meta?.units ?? ''), mode);
    return { tag, tr, val, mode, decimals: meta?.decimals ?? 2 };
  });
  const motorRows = motors.map((m) => {
    const st = h('td');
    const tr = h('tr.clickable', { onclick: () => store.select({ kind: 'motor', id: m.id }) }, h('td.tag-cell', {}, m.id), h('td', {}, m.description), st, h('td'), h('td'));
    return { id: m.id, st, tr };
  });
  const el = h('div.fp', {},
    header(id, eq?.description ?? valve?.description, ctx, { focusId: id, trendSeries: tags.slice(0, 4).map((t) => (store.index.loops.has(t) || store.index.points.has(t) ? `${t}.PV` : null)).filter(Boolean) }),
    h('div.fp-section', {},
      h('h3', {}, 'Measurements & loops'),
      h('table.mini.wide', {}, h('tbody', {}, rows.map((r) => r.tr), motorRows.map((r) => r.tr)))));
  return {
    el,
    update(state) {
      for (const r of rows) {
        const bad = state.bad?.includes(r.tag);
        setText(r.val, bad ? 'BAD' : fmt(state.points?.[r.tag] ?? state.loops?.[r.tag]?.op, r.decimals));
        const alarm = (state.alarms ?? []).find((a) => a.tag === r.tag && a.state !== 'SHELVED');
        r.tr.dataset.alarm = alarm?.priority ?? '';
        setText(r.mode, state.loops?.[r.tag]?.mode ?? '');
      }
      for (const r of motorRows) {
        const s = state.motors?.[r.id];
        setText(r.st, s?.status ?? '');
        r.st.dataset.status = s?.status ?? '';
      }
    },
  };
}
