/**
 * Overview tab: KPI tiles and the group display of all loops and indicators.
 */
import { store } from '../store.js';
import { h, setText, fmt } from './dom.js';

const KPIS = [
  { key: 'conversion', label: 'Reactor conversion', unit: '%', d: 1 },
  { key: 'purity', label: 'Product purity', unit: 'mol%', d: 2 },
  { key: 'productRate', label: 'Production rate', unit: 't/h', d: 2 },
  { key: 'steam', label: 'Steam consumption', unit: 't/h', d: 2 },
  { key: 'specificSteam', label: 'Specific steam', unit: 't/t', d: 3 },
  { key: 'coolingWater', label: 'Cooling water', unit: 'm³/h', d: 0 },
  { key: 'reactionHeat', label: 'Heat of reaction', unit: 'kW', d: 0 },
  { key: 'productTonnes', label: 'Product (shift)', unit: 't', d: 1 },
];

export function createOverview(root) {
  const tiles = KPIS.map((k) => {
    const val = h('span.kpi-val');
    const el = h('div.kpi', {}, h('div.kpi-label', {}, k.label), h('div', {}, val, h('span.kpi-unit', {}, ` ${k.unit}`)));
    return { ...k, val, el };
  });

  const loopRows = [];
  const pointRows = [];

  const loopTable = h('table.grid');
  const pointTable = h('table.grid');

  const build = () => {
    loopRows.length = 0;
    pointRows.length = 0;
    loopTable.replaceChildren(h('thead', {}, h('tr', {},
      ['Tag', 'Description', 'Mode', 'PV', 'SP', 'OP %', 'Units', ''].map((t) => h('th', {}, t)))));
    const lb = h('tbody');
    for (const l of store.config.controllers) {
      const cells = { mode: h('td.mode-cell'), pv: h('td.num-cell'), sp: h('td.num-cell'), op: h('td.num-cell'), bar: h('td.bar-cell', {}, h('div.mini-bar', {}, h('div.mini-fill'))) };
      const tr = h('tr.clickable', { onclick: () => store.select({ kind: 'point', id: l.tag }) },
        h('td.tag-cell', {}, l.tag), h('td', {}, l.description), cells.mode, cells.pv, cells.sp, cells.op, h('td.unit', {}, l.units), cells.bar);
      lb.append(tr);
      loopRows.push({ l, tr, cells, d: store.index.points.get(l.tag)?.decimals ?? 2 });
    }
    loopTable.append(lb);

    pointTable.replaceChildren(h('thead', {}, h('tr', {}, ['Tag', 'Description', 'Value', 'Units'].map((t) => h('th', {}, t)))));
    const pb = h('tbody');
    for (const p of store.config.points.filter((x) => !x.isLoop)) {
      const val = h('td.num-cell');
      const tr = h('tr.clickable', { onclick: () => store.select({ kind: 'point', id: p.tag }) }, h('td.tag-cell', {}, p.tag), h('td', {}, p.description), val, h('td.unit', {}, p.units));
      pb.append(tr);
      pointRows.push({ p, tr, val });
    }
    pointTable.append(pb);
  };

  root.append(
    h('div.overview', {},
      h('div.kpis', {}, tiles.map((t) => t.el)),
      h('div.overview-tables', {},
        h('section', {}, h('h3', {}, 'Control loops'), loopTable),
        h('section', {}, h('h3', {}, 'Indicators'), pointTable))));

  store.on('init', build);
  store.on('state', (s) => {
    if (!loopRows.length) return;
    for (const t of tiles) setText(t.val, fmt(s.kpis?.[t.key], t.d));
    const alarmed = new Map();
    for (const a of s.alarms ?? []) if (a.state !== 'SHELVED' && a.state !== 'RTN_UNACK' && !alarmed.has(a.tag)) alarmed.set(a.tag, a.priority);
    const bad = new Set(s.bad ?? []);
    for (const r of loopRows) {
      const lp = s.loops?.[r.l.tag];
      if (!lp) continue;
      setText(r.cells.mode, lp.il ? `${lp.mode} ⛔` : lp.iman ? `${lp.mode} (IMAN)` : lp.mode);
      r.cells.mode.dataset.mode = lp.mode;
      setText(r.cells.pv, r.l.manualOnly ? '' : bad.has(r.l.tag) ? 'BAD' : fmt(s.points?.[r.l.tag], r.d));
      setText(r.cells.sp, r.l.manualOnly ? '' : fmt(lp.sp, r.d));
      setText(r.cells.op, fmt(lp.op, 1));
      r.cells.bar.firstChild.firstChild.style.width = `${Math.min(Math.max(lp.op, 0), 100)}%`;
      r.tr.dataset.alarm = alarmed.get(r.l.tag) ?? '';
    }
    for (const r of pointRows) {
      setText(r.val, bad.has(r.p.tag) ? 'BAD' : fmt(s.points?.[r.p.tag], r.p.decimals));
      r.tr.dataset.alarm = alarmed.get(r.p.tag) ?? '';
    }
  });
}
