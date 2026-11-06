/**
 * Live 2D P&ID (process graphic) in the ISA-101 high-performance style:
 * grey equipment on a dark background, colour reserved for abnormal states
 * (alarms, trips, SIS-forced or stuck valves). Built as SVG from the layout
 * below; values refresh from the 2 Hz state stream while the view is shown.
 */
import { store } from '../store.js';
import { fmt } from '../ui/dom.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 1600;
const H = 900;

function el(tag, attrs = {}, children = []) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) e.setAttribute(k, String(v));
  for (const c of [].concat(children)) if (c) e.append(c);
  return e;
}

function text(x, y, str, cls, anchor = 'start') {
  const t = el('text', { x, y, class: cls, 'text-anchor': anchor });
  t.textContent = str;
  return t;
}

const setTxt = (t, v) => {
  const s = String(v);
  if (t.textContent !== s) t.textContent = s;
};

// --------------------------------------------------------------- layout
const LINES = [
  // process
  { flow: 'fresh', max: 20, arrow: true, pts: [[12, 130], [150, 130], [150, 170]] },
  { flow: 'feed', max: 20, pts: [[175, 370], [175, 440], [242, 440]] },
  { flow: 'feed', max: 20, arrow: true, pts: [[278, 440], [410, 440]] },
  { flow: 'feed', max: 20, arrow: true, pts: [[520, 441], [560, 441], [560, 155], [650, 155], [650, 182]] },
  { flow: 'reactorOut', max: 25, pts: [[685, 422], [685, 520], [747, 520]] },
  { flow: 'reactorOut', max: 25, arrow: true, pts: [[783, 520], [900, 520], [900, 400], [950, 400]] },
  { flow: 'vapour', max: 16, arrow: true, pts: [[990, 120], [990, 84], [1180, 84], [1180, 140]] },
  { flow: 'condensate', max: 16, arrow: true, pts: [[1180, 170], [1180, 215]] },
  { flow: ['reflux', 'distillate'], max: 20, arrow: true, pts: [[1185, 259], [1185, 302]] },
  { flow: ['reflux', 'distillate'], max: 20, pts: [[1203, 320], [1215, 320]] },
  { flow: 'reflux', max: 15, arrow: true, pts: [[1215, 320], [1215, 362], [1070, 362], [1070, 180], [1030, 180]] },
  { flow: 'distillate', max: 10, arrow: true, pts: [[1215, 320], [1345, 320], [1345, 30], [200, 30], [200, 170]] },
  { flow: 'vapour', max: 16, arrow: true, pts: [[1030, 615], [1050, 615]] },
  { flow: 'vapour', max: 16, arrow: true, pts: [[1085, 600], [1085, 575], [1030, 575]] },
  { flow: 'bottoms', max: 15, pts: [[990, 660], [990, 760], [1045, 760]] },
  { flow: 'bottoms', max: 15, arrow: true, pts: [[1081, 760], [1220, 760]] },
  { flow: 'bottoms', max: 15, arrow: true, pts: [[1310, 760], [1390, 760], [1390, 370], [1500, 370], [1500, 400]] },
  { flow: 'export', max: 12, pts: [[1505, 580], [1505, 640], [1512, 640]] },
  { flow: 'export', max: 12, arrow: true, pts: [[1548, 640], [1598, 640]] },
  // utilities (off-page connectors at one end)
  { service: 'steam', flow: 'steamE101', max: 1.1, arrow: true, pts: [[465, 690], [465, 457]] },
  { service: 'cw', flow: 'cwJacket', max: 30, arrow: true, pts: [[592, 700], [592, 392], [606, 392]] },
  { service: 'cw', flow: 'cwJacket', max: 30, arrow: true, pts: [[764, 262], [786, 262], [786, 330]] },
  { service: 'cw', flow: 'cwCondenser', max: 150, arrow: true, pts: [[1300, 163], [1240, 163]] },
  { service: 'cw', flow: 'cwCondenser', max: 150, arrow: true, pts: [[1240, 147], [1300, 147]] },
  { service: 'steam', flow: 'steamReboiler', max: 3.6, arrow: true, pts: [[1210, 615], [1120, 615]] },
  { service: 'cw', flow: 'cwE102', max: 20, arrow: true, pts: [[1292, 820], [1292, 775]] },
];

const CONNECTORS = [
  { x: 465, y: 704, label: 'MP STEAM', dir: 'up' },
  { x: 592, y: 714, label: 'CWS', dir: 'up' },
  { x: 786, y: 330, label: 'CWR', dir: 'up' },
  { x: 1322, y: 163, label: 'CWS', dir: 'left' },
  { x: 1322, y: 147, label: 'CWR', dir: 'right' },
  { x: 1232, y: 615, label: 'MP STEAM', dir: 'left' },
  { x: 1292, y: 834, label: 'CWS', dir: 'up' },
  { x: 12, y: 116, label: 'FRESH A', dir: 'none' },
  { x: 1598, y: 626, label: 'EXPORT', dir: 'none', anchor: 'end' },
];

const VALVES = [
  { id: 'LV-101', x: 80, y: 130 },
  { id: 'FV-101', x: 335, y: 440 },
  { id: 'TV-102', x: 465, y: 600, v: true },
  { id: 'TV-105', x: 592, y: 560, v: true },
  { id: 'LV-103', x: 845, y: 520 },
  { id: 'PV-111', x: 1270, y: 163 },
  { id: 'FV-108', x: 1070, y: 270, v: true },
  { id: 'LV-109', x: 1280, y: 320 },
  { id: 'TV-112', x: 1165, y: 615 },
  { id: 'LV-110', x: 1150, y: 760 },
  { id: 'HV-115', x: 1572, y: 640 },
];

const PUMPS = [
  { id: 'P-101', x: 260, y: 440 },
  { id: 'P-102', x: 765, y: 520 },
  { id: 'P-103', x: 1185, y: 320, suctionTop: true },
  { id: 'P-104', x: 1063, y: 760 },
  { id: 'P-105', x: 1530, y: 640 },
];

const LOOPS = [
  { tag: 'LIC-101', x: 245, y: 175, signal: [[306, 175], [306, 108], [80, 108], [80, 118]] },
  { tag: 'FIC-101', x: 290, y: 468, signal: [[335, 468], [335, 452]] },
  { tag: 'TIC-102', x: 300, y: 560, signal: [[422, 600], [453, 600]] },
  { tag: 'TIC-104', x: 805, y: 182 },
  { tag: 'TIC-105', x: 612, y: 585, signal: [[612, 600], [604, 600], [604, 572]] },
  { tag: 'LIC-103', x: 775, y: 555, signal: [[845, 555], [845, 532]] },
  { tag: 'PIC-111', x: 1360, y: 60, signal: [[1360, 85], [1270, 85], [1270, 151]] },
  { tag: 'FIC-108', x: 1040, y: 385 },
  { tag: 'LIC-109', x: 1170, y: 385, signal: [[1280, 385], [1280, 332]] },
  { tag: 'LIC-110', x: 1040, y: 450 },
  { tag: 'TIC-112', x: 1170, y: 450, signal: [[1180, 500], [1180, 545], [1165, 545], [1165, 603]] },
];

const TAGS = [
  { tag: 'FI-100', x: 12, y: 142 },
  { tag: 'TI-101', x: 245, y: 232 },
  { tag: 'FI-102', x: 330, y: 622 },
  { tag: 'PI-106', x: 805, y: 140 },
  { tag: 'AI-107', x: 805, y: 240 },
  { tag: 'FI-105', x: 612, y: 645 },
  { tag: 'FI-103', x: 775, y: 612 },
  { tag: 'TI-113', x: 1360, y: 118 },
  { tag: 'FI-109', x: 1360, y: 296 },
  { tag: 'FI-112', x: 1135, y: 640 },
  { tag: 'TI-116', x: 1220, y: 712 },
  { tag: 'FI-110', x: 1095, y: 792 },
  { tag: 'AI-114', x: 1440, y: 330 },
  { tag: 'FI-115', x: 1450, y: 662 },
  { tag: 'TI-901', x: 12, y: 820 },
  { tag: 'PI-902', x: 12, y: 846 },
];

const INTERLOCKS = [
  { id: 'IL-003', x: 108, y: 395 },
  { id: 'IL-001', x: 745, y: 112 },
  { id: 'IL-002', x: 790, y: 112 },
  { id: 'IL-004', x: 630, y: 482 },
  { id: 'IL-005', x: 1045, y: 52 },
  { id: 'IL-006', x: 940, y: 700 },
  { id: 'IL-007', x: 1578, y: 430 },
  { id: 'ESD-1', x: 1578, y: 860 },
];

const PRIORITY_RANK = { CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4 };

export class PidView {
  constructor(container) {
    this.container = container;
    this.updaters = [];
    this.selectables = [];
    this.visible = false;
    this.vb = { x: 0, y: 0, w: W, h: H };
    this.build();
    this.bindPanZoom();
    store.on('state', (s) => this.visible && this.update(s));
    store.on('select', (sel) => this.highlight(sel));
  }

  // ---------------------------------------------------------------- build
  build() {
    const svg = el('svg', { class: 'pid', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'Unit 100 process graphic' });
    this.svg = svg;
    svg.append(el('defs', {}, [
      el('marker', { id: 'pid-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' },
        el('path', { d: 'M0 0 L10 5 L0 10 z', class: 'pid-arrowhead' })),
    ]));
    svg.append(el('rect', { x: -4000, y: -4000, width: 9600, height: 8900, class: 'pid-bg' }));

    const lines = el('g', { class: 'pid-lines' });
    const equip = el('g');
    const instruments = el('g');
    svg.append(lines, equip, instruments);

    // Signal lines first (dashed, beneath everything)
    for (const l of LOOPS) if (l.signal) lines.append(el('polyline', { points: pts(l.signal), class: 'pid-signal' }));

    for (const ln of LINES) this.line(lines, ln);
    for (const c of CONNECTORS) equip.append(connector(c));

    this.tank(equip, 'T-101', 120, 170, 110, 200, 'FEED TANK', { x: 183, anchor: 'start' });
    this.exchanger(equip, 'E-101', 410, 425, 110, 32, 'PREHEATER', 'below', { x: 472, anchor: 'start' });
    this.reactor(equip);
    this.column(equip);
    this.exchanger(equip, 'E-103', 1120, 140, 120, 30, 'CONDENSER', 'left');
    this.drum(equip);
    this.exchanger(equip, 'E-104', 1050, 600, 70, 30, 'REBOILER', 'below');
    this.exchanger(equip, 'E-102', 1220, 745, 90, 30, 'COOLER', 'below');
    this.tank(equip, 'T-102', 1450, 400, 110, 180, 'PRODUCT TANK', { x: 1498, anchor: 'end' });

    for (const v of VALVES) this.valve(equip, v);
    for (const p of PUMPS) this.pump(equip, p);
    for (const l of LOOPS) this.loopBlock(instruments, l);
    for (const t of TAGS) this.valueTag(instruments, t);
    for (const i of INTERLOCKS) this.interlock(instruments, i);

    svg.append(legend());
    this.container.append(svg);
  }

  selectable(node, sel) {
    node.classList.add('pid-pick');
    node.dataset.kind = sel.kind;
    node.dataset.id = sel.id;
    this.selectables.push({ node, sel });
    return node;
  }

  line(parent, ln) {
    const p = pts(ln.pts);
    const halo = el('polyline', { points: p, class: 'pid-halo' });
    const line = el('polyline', { points: p, class: `pid-line ${ln.service ?? 'process'}`, 'marker-end': ln.arrow ? 'url(#pid-arrow)' : null });
    parent.append(halo, line);
    const flows = [].concat(ln.flow ?? []);
    this.updaters.push((s, view) => {
      let f = 0;
      for (const k of flows) f += view.flows[k] ?? 0;
      line.classList.toggle('noflow', f < 0.01 * (ln.max || 1));
    });
  }

  vesselLabel(parent, id, title, x, y, anchor = 'middle') {
    parent.append(text(x, y, id, 'pid-eqtag', anchor), text(x, y + 13, title, 'pid-eqname', anchor));
  }

  equipmentGroup(parent, id) {
    const g = this.selectable(el('g', { class: 'pid-eq' }), { kind: 'equipment', id });
    parent.append(g);
    this.alarmTarget(g, id);
    return g;
  }

  alarmTarget(node, id) {
    this.updaters.push((s, view) => {
      const a = view.alarmsByEq.get(id);
      node.dataset.alarm = a?.priority ?? '';
      node.classList.toggle('unack', !!a?.unack);
    });
  }

  levelFill(g, id, x, y, w, h, rx = 0, clip = null) {
    const clipId = `pid-clip-${id}`;
    const c = clip ?? { x, y, w, h, rx };
    g.append(el('clipPath', { id: clipId }, el('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: c.rx })));
    const fill = el('rect', { x, y: y + h, width: w, height: 0, class: 'pid-liquid', 'clip-path': `url(#${clipId})` });
    g.append(fill);
    this.updaters.push((s) => {
      const v = s.visual?.[id];
      if (!v) return;
      const lh = Math.max(0, Math.min(v.level, 1)) * h;
      fill.setAttribute('y', y + h - lh);
      fill.setAttribute('height', lh);
      fill.style.fill = liquid(v.xA);
    });
  }

  tank(parent, id, x, y, w, h, title, label = {}) {
    const g = this.equipmentGroup(parent, id);
    this.levelFill(g, id, x, y, w, h, 4);
    g.append(el('rect', { x, y, width: w, height: h, rx: 4, class: 'pid-vessel' }));
    this.vesselLabel(g, id, title, label.x ?? x + w / 2, y + h + 18, label.anchor ?? 'middle');
  }

  exchanger(parent, id, x, y, w, h, title, labelPos = 'below', label = {}) {
    const g = this.equipmentGroup(parent, id);
    g.append(el('rect', { x, y, width: w, height: h, rx: h / 2, class: 'pid-vessel' }));
    g.append(el('path', { d: `M${x + h / 2} ${y + h / 2} h${w - h}`, class: 'pid-detail' }));
    if (labelPos === 'left') {
      this.vesselLabel(g, id, title, x - 8, y + 12, 'end');
      return;
    }
    const ly = labelPos === 'above' ? y - 18 : y + h + 15;
    this.vesselLabel(g, id, title, label.x ?? x + w / 2, ly, label.anchor ?? 'middle');
  }

  reactor(parent) {
    const g = this.equipmentGroup(parent, 'R-101');
    const [x, y, w, h] = [620, 182, 130, 240];
    this.levelFill(g, 'R-101', x, y, w, h, 36);
    g.append(el('rect', { x: 606, y: 250, width: 158, height: 160, rx: 14, class: 'pid-jacket' }));
    g.append(el('rect', { x, y, width: w, height: h, rx: 36, class: 'pid-vessel' }));
    g.append(el('path', { d: 'M700 175 V340 M680 340 H720 M684 300 H716', class: 'pid-detail' }));
    this.vesselLabel(g, 'R-101', 'REACTOR', 676, 446, 'end');
    // Agitator motor
    const m = this.selectable(el('g', { class: 'pid-motor' }), { kind: 'motor', id: 'M-101' });
    const c = el('circle', { cx: 700, cy: 162, r: 13, class: 'pid-pump' });
    m.append(c, text(700, 166, 'M', 'pid-motor-m', 'middle'));
    g.append(m);
    this.motorStatus(c, 'M-101');
    this.alarmTarget(m, 'M-101');
  }

  column(parent) {
    const g = this.equipmentGroup(parent, 'C-101');
    const [x, y, w, h] = [950, 120, 80, 540];
    // Sump level (bottom 15 % of the shell)
    this.levelFill(g, 'C-101', x, y + h - 90, w, 90, 0, { x, y, w, h, rx: 40 });
    g.append(el('rect', { x, y, width: w, height: h, rx: 40, class: 'pid-vessel' }));
    let d = '';
    for (let ty = 170; ty <= 560; ty += 30) d += `M${x + 6} ${ty} H${x + w - 6} `;
    g.append(el('path', { d, class: 'pid-tray' }));
    this.vesselLabel(g, 'C-101', 'COLUMN', 905, 680, 'end');
  }

  drum(parent) {
    const g = this.equipmentGroup(parent, 'D-101');
    const [x, y, w, h] = [1120, 215, 130, 44];
    this.levelFill(g, 'D-101', x, y, w, h, 22);
    g.append(el('rect', { x, y, width: w, height: h, rx: 22, class: 'pid-vessel' }));
    this.vesselLabel(g, 'D-101', 'REFLUX DRUM', x + w + 8, y + 18, 'start');
  }

  valve(parent, v) {
    const g = this.selectable(el('g', { class: 'pid-valve', transform: `translate(${v.x} ${v.y})${v.v ? ' rotate(90)' : ''}` }), { kind: 'valve', id: v.id });
    const body = el('path', { d: 'M-12 -8 L0 0 L-12 8 Z M12 -8 L0 0 L12 8 Z', class: 'pid-valve-body' });
    g.append(body, el('path', { d: 'M0 0 V-12 M-7 -12 H7', class: 'pid-valve-stem' }));
    parent.append(g);
    const label = text(v.x + (v.v ? 14 : 0), v.y + (v.v ? 4 : 22), '', 'pid-valve-pos', v.v ? 'start' : 'middle');
    parent.append(label);
    this.updaters.push((s) => {
      const st = s.valves?.[v.id];
      if (!st) return;
      const open = Math.min(Math.max(st.pos / 100, 0), 1);
      body.style.fillOpacity = String(0.08 + 0.92 * open);
      g.classList.toggle('forced', st.forced !== undefined);
      g.classList.toggle('stuck', !!st.stuck);
      setTxt(label, `${fmt(st.pos, 0)}%`);
    });
  }

  pump(parent, p) {
    const g = this.selectable(el('g', { class: 'pid-motor' }), { kind: 'motor', id: p.id });
    const c = el('circle', { cx: p.x, cy: p.y, r: 18, class: 'pid-pump' });
    const tri = el('path', { d: `M${p.x - 8} ${p.y - 10} L${p.x + 12} ${p.y} L${p.x - 8} ${p.y + 10} Z`, class: 'pid-pump-tri' });
    g.append(c, tri, text(p.x, p.y + 34, p.id, 'pid-eqtag', 'middle'));
    parent.append(g);
    this.motorStatus(c, p.id, tri);
    this.alarmTarget(g, p.id);
  }

  motorStatus(circle, id, tri) {
    this.updaters.push((s) => {
      const m = s.motors?.[id];
      if (!m) return;
      circle.dataset.status = m.status;
      if (tri) tri.dataset.status = m.status;
    });
  }

  loopBlock(parent, l) {
    const meta = store.index.points?.get(l.tag);
    const g = this.selectable(el('g', { class: 'pid-block', transform: `translate(${l.x} ${l.y})` }), { kind: 'point', id: l.tag });
    const box = el('rect', { x: 0, y: 0, width: 122, height: 50, rx: 4, class: 'pid-box' });
    const mode = text(117, 13, '', 'pid-mode', 'end');
    const pv = text(6, 31, '', 'pid-pv');
    const units = text(117, 31, '', 'pid-units', 'end');
    const spop = text(6, 44, '', 'pid-spop');
    const barBg = el('rect', { x: 0, y: 47, width: 122, height: 3, class: 'pid-bar-bg' });
    const bar = el('rect', { x: 0, y: 47, width: 0, height: 3, class: 'pid-bar' });
    const spMark = el('rect', { x: 0, y: 45, width: 2, height: 5, class: 'pid-bar-sp' });
    g.append(box, text(6, 13, l.tag, 'pid-tag'), mode, pv, units, spop, barBg, bar, spMark);
    parent.append(g);
    this.updaters.push((s, view) => {
      const lp = s.loops?.[l.tag];
      const m = meta ?? store.index.points.get(l.tag);
      if (!lp || !m) return;
      const v = s.points?.[l.tag];
      const bad = view.bad.has(l.tag);
      setTxt(pv, bad ? 'BAD' : fmt(v, m.decimals ?? 1));
      setTxt(units, m.units);
      setTxt(mode, lp.il ? 'IL' : lp.iman ? 'IMAN' : lp.mode);
      mode.dataset.mode = lp.il ? 'IL' : lp.mode;
      setTxt(spop, `SP ${fmt(lp.sp, m.decimals ?? 1)}  OP ${fmt(lp.op, 0)}%`);
      const pct = (x) => Math.min(Math.max(((x - m.lo) / (m.hi - m.lo)) * 122, 0), 122);
      bar.setAttribute('width', Number.isFinite(v) ? pct(v) : 0);
      spMark.setAttribute('x', Math.min(pct(lp.sp), 120));
      const a = view.alarmsByTag.get(l.tag);
      g.dataset.alarm = a?.priority ?? (bad ? 'HIGH' : '');
      g.classList.toggle('unack', !!a?.unack);
    });
  }

  valueTag(parent, t) {
    const g = this.selectable(el('g', { class: 'pid-block small', transform: `translate(${t.x} ${t.y})` }), { kind: 'point', id: t.tag });
    const val = text(124, 15, '', 'pid-val', 'end');
    g.append(el('rect', { x: 0, y: 0, width: 128, height: 21, rx: 3, class: 'pid-box' }), text(5, 15, t.tag, 'pid-tag'), val);
    parent.append(g);
    this.updaters.push((s, view) => {
      const m = store.index.points.get(t.tag);
      if (!m) return;
      const bad = view.bad.has(t.tag);
      setTxt(val, bad ? 'BAD' : `${fmt(s.points?.[t.tag], m.decimals ?? 1)} ${m.units}`);
      const a = view.alarmsByTag.get(t.tag);
      g.dataset.alarm = a?.priority ?? (bad ? 'HIGH' : '');
      g.classList.toggle('unack', !!a?.unack);
    });
  }

  interlock(parent, i) {
    const g = this.selectable(el('g', { class: 'pid-il', transform: `translate(${i.x} ${i.y})` }), { kind: 'il', id: i.id });
    const d = el('path', { d: 'M0 -11 L11 0 L0 11 L-11 0 Z', class: 'pid-il-shape' });
    g.append(d, text(0, 3, 'I', 'pid-il-i', 'middle'), text(0, 24, i.id, 'pid-il-tag', 'middle'));
    parent.append(g);
    this.updaters.push((s) => {
      const st = s.sis?.find((x) => x.id === i.id);
      g.dataset.state = !st ? '' : st.tripped ? 'tripped' : st.bypassed ? 'bypassed' : 'healthy';
    });
  }

  // --------------------------------------------------------------- update
  update(s) {
    if (!s || !store.config) return;
    const alarmsByTag = new Map();
    const alarmsByEq = new Map();
    for (const a of s.alarms ?? []) {
      if (a.state === 'SHELVED') continue;
      const unack = a.state === 'UNACK' || a.state === 'RTN_UNACK';
      const active = a.state !== 'RTN_UNACK';
      const put = (map, key) => {
        if (!key) return;
        const prev = map.get(key);
        if (!prev) map.set(key, { priority: active ? a.priority : null, unack });
        else {
          if (active && (!prev.priority || PRIORITY_RANK[a.priority] < PRIORITY_RANK[prev.priority])) prev.priority = a.priority;
          prev.unack = prev.unack || unack;
        }
      };
      put(alarmsByTag, a.tag);
      put(alarmsByEq, store.equipmentOf(a.tag));
    }
    for (const m of [alarmsByTag, alarmsByEq]) for (const [k, v] of m) if (!v.priority) v.priority = 'LOW';
    const p104 = s.motors?.['P-104'];
    const view = {
      flows: { ...s.flows, cwE102: (s.utilities?.cwAvail ?? 1) * 18 * (p104 && p104.speed > 0.5 ? 1 : 0.2) },
      bad: new Set(s.bad ?? []),
      alarmsByTag,
      alarmsByEq,
    };
    for (const u of this.updaters) u(s, view);
  }

  highlight(sel) {
    const key = sel ? `${sel.kind}:${sel.id}` : null;
    const loop = sel?.kind === 'point' ? store.index.loops?.get(sel.id) : null;
    const valveKey = loop?.output?.valve ? `valve:${loop.output.valve}` : null;
    for (const { node, sel: s } of this.selectables) {
      const k = `${s.kind}:${s.id}`;
      node.classList.toggle('selected', k === key || k === valveKey);
    }
  }

  // ------------------------------------------------------------- pan/zoom
  bindPanZoom() {
    const svg = this.svg;
    let drag = null;
    let pinch = null;
    const pointers = new Map();
    const apply = () => svg.setAttribute('viewBox', `${this.vb.x} ${this.vb.y} ${this.vb.w} ${this.vb.h}`);
    const toSvg = (cx, cy) => {
      const r = svg.getBoundingClientRect();
      const scale = Math.max(this.vb.w / r.width, this.vb.h / r.height);
      const ox = (r.width * scale - this.vb.w) / 2;
      const oy = (r.height * scale - this.vb.h) / 2;
      return { x: this.vb.x + (cx - r.left) * scale - ox, y: this.vb.y + (cy - r.top) * scale - oy, scale };
    };
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomTo(this.vb.w, { ...this.vb }, toSvg(e.clientX, e.clientY), Math.exp(e.deltaY * 0.0015));
    }, { passive: false });
    const zoomTo = (w0, base, center, factor) => {
      const w = Math.min(Math.max(w0 * factor, W / 8), W * 1.5);
      const f = w / base.w;
      this.vb = { x: center.x - (center.x - base.x) * f, y: center.y - (center.y - base.y) * f, w, h: base.h * f };
      apply();
    };
    svg.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        // Two-finger pinch zoom (touch screens).
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, vb: { ...this.vb }, mid: toSvg((a.x + b.x) / 2, (a.y + b.y) / 2) };
        drag = null;
        return;
      }
      drag = { x: e.clientX, y: e.clientY, vb: { ...this.vb }, moved: false, scale: toSvg(e.clientX, e.clientY).scale };
    });
    const release = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    svg.addEventListener('pointercancel', (e) => {
      release(e);
      drag = null;
    });
    svg.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        zoomTo(pinch.vb.w, pinch.vb, pinch.mid, pinch.dist / (Math.hypot(a.x - b.x, a.y - b.y) || 1));
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      if (!drag.moved) svg.setPointerCapture(e.pointerId);
      drag.moved = true;
      this.vb = { ...drag.vb, x: drag.vb.x - dx * drag.scale, y: drag.vb.y - dy * drag.scale };
      apply();
    });
    svg.addEventListener('pointerup', (e) => {
      const wasPinch = !!pinch;
      release(e);
      if (wasPinch) return;
      const d = drag;
      drag = null;
      if (!d || d.moved) return;
      const target = e.target.closest?.('.pid-pick');
      if (!target) {
        store.select(null);
        return;
      }
      const { kind, id } = target.dataset;
      if (kind === 'valve') {
        const loopTag = store.index.valveLoop.get(id);
        store.select(loopTag ? { kind: 'point', id: loopTag } : { kind: 'equipment', id });
      } else if (kind === 'il') {
        this.onInterlock?.(id);
      } else {
        store.select({ kind, id });
      }
    });
    svg.addEventListener('dblclick', () => this.fit());
  }

  fit() {
    this.vb = { x: 0, y: 0, w: W, h: H };
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  }

  show() {
    this.visible = true;
    this.container.hidden = false;
    this.update(store.state);
    this.highlight(store.selection);
  }

  hide() {
    this.visible = false;
    this.container.hidden = true;
  }
}

function pts(list) {
  return list.map(([x, y]) => `${x},${y}`).join(' ');
}

function liquid(xA) {
  // Muted blend from reactant A (blue-grey) to product B (amber-grey).
  const t = Math.min(Math.max(xA ?? 0.5, 0), 1);
  const a = [79, 125, 170];
  const b = [176, 134, 80];
  const c = b.map((v, i) => Math.round(v + (a[i] - v) * t));
  return `rgb(${c.join(',')})`;
}

function connector({ x, y, label, dir, anchor }) {
  const g = el('g', { class: 'pid-connector' });
  if (dir === 'none') {
    g.append(text(x, y, label, 'pid-conn-text', anchor ?? 'start'));
    return g;
  }
  // Off-page connector: a small arrow-shaped flag with the utility name.
  const w = label.length > 4 ? 66 : 46;
  const h = 14;
  let d;
  let tx;
  let ty;
  if (dir === 'up') {
    d = `M${x - w / 2} ${y} h${w} v${h} h${-w} z`;
    tx = x;
    ty = y + 11;
  } else if (dir === 'left') {
    d = `M${x - 22} ${y - h / 2} h${w - 22} v${h} h${-(w - 22)} l-6 ${-h / 2} z`;
    tx = x + 5;
    ty = y + 4;
  } else {
    d = `M${x - 22} ${y - h / 2} h${w - 28} l6 ${h / 2} l-6 ${h / 2} h${-(w - 28)} z`;
    tx = x + 2;
    ty = y + 4;
  }
  g.append(el('path', { d, class: 'pid-conn' }), text(tx, ty, label, 'pid-conn-text', 'middle'));
  return g;
}

function legend() {
  const g = el('g', { class: 'pid-legend', transform: 'translate(300 862)' });
  const items = [
    ['valve', 'Valve (fill = opening)'],
    ['run', 'Pump running'],
    ['stop', 'Stopped'],
    ['forced', 'SIS forced'],
    ['il', 'SIS function'],
  ];
  let x = 0;
  for (const [k, label] of items) {
    let sym;
    if (k === 'valve') sym = el('path', { d: 'M0 -6 L8 0 L0 6 Z M16 -6 L8 0 L16 6 Z', class: 'pid-valve-body', style: 'fill-opacity:0.6' });
    else if (k === 'run') sym = el('circle', { cx: 7, cy: 0, r: 7, class: 'pid-pump', 'data-status': 'RUNNING' });
    else if (k === 'stop') sym = el('circle', { cx: 7, cy: 0, r: 7, class: 'pid-pump', 'data-status': 'STOPPED' });
    else if (k === 'forced') sym = el('path', { d: 'M0 -6 L8 0 L0 6 Z M16 -6 L8 0 L16 6 Z', class: 'pid-valve-body legend-forced' });
    else sym = el('path', { d: 'M7 -7 L14 0 L7 7 L0 0 Z', class: 'pid-il-shape' });
    g.append(el('g', { transform: `translate(${x} 0)` }, [sym, text(22, 4, label, 'pid-legend-text')]));
    x += 26 + label.length * 6.4;
  }
  return g;
}
