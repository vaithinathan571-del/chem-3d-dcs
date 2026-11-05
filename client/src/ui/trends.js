/**
 * Trend display: multi-pen canvas chart with historian backfill, live
 * updates, per-pen scaling and a hover cursor.
 */
import { store } from '../store.js';
import { h, clear, fmt, fmtTime } from './dom.js';
import { toast } from './notify.js';

const PALETTE = ['#4ea1ff', '#ff9f1a', '#5fd47a', '#e05cff', '#ffd60a', '#39c5ff', '#ff6b6b', '#b7c3cf'];
const SPANS = [
  { label: '5 min', s: 300 },
  { label: '15 min', s: 900 },
  { label: '1 h', s: 3600 },
  { label: '4 h', s: 14400 },
];
const DEFAULT_PENS = ['TIC-104.PV', 'TIC-104.SP', 'TIC-105.PV', 'TIC-105.SP'];

export function createTrends(root, client) {
  const pens = [];
  let span = 900;
  let axisPen = 0;
  let paused = false;
  let cursorX = null;

  const canvas = h('canvas.trend-canvas');
  const legend = h('div.legend');
  const select = h('select', { 'aria-label': 'Add pen' });
  const spanButtons = SPANS.map((sp) =>
    h(`button.seg-btn${sp.s === span ? '.active' : ''}`, {
      onclick: () => {
        span = sp.s;
        for (const b of spanButtons) b.classList.toggle('active', b === spanButtons[SPANS.indexOf(sp)]);
        backfill();
      },
    }, sp.label));
  const pauseBtn = h('button.btn.small', {
    onclick: () => {
      paused = !paused;
      pauseBtn.textContent = paused ? 'Resume live' : 'Pause';
      draw();
    },
  }, 'Pause');

  root.append(h('div.trends', {},
    h('div.toolbar', {},
      h('label.inline', {}, 'Add pen ', select),
      h('div.seg', {}, spanButtons),
      pauseBtn,
      h('button.btn.small', { onclick: () => { pens.splice(0); renderLegend(); draw(); } }, 'Clear')),
    legend,
    h('div.trend-wrap', {}, canvas)));

  const meta = (series) => {
    const [tag, field] = splitSeries(series);
    if (field === 'OP') return { lo: 0, hi: 100, units: '%', decimals: 1, label: `${tag} OP` };
    const p = store.index.points.get(tag);
    return { lo: p?.lo ?? 0, hi: p?.hi ?? 100, units: p?.units ?? '', decimals: p?.decimals ?? 2, label: `${tag} ${field}` };
  };

  function addPens(series, focus = true) {
    let added = 0;
    for (const s of series) {
      if (pens.some((p) => p.series === s)) continue;
      if (!store.config.historian.series.includes(s)) continue;
      if (pens.length >= PALETTE.length) {
        toast('Maximum of 8 pens per trend', 'error');
        break;
      }
      const used = new Set(pens.map((p) => p.color));
      pens.push({ series: s, color: PALETTE.find((c) => !used.has(c)) ?? PALETTE[0], t: [], v: [], ...meta(s) });
      added += 1;
    }
    if (added) {
      renderLegend();
      backfill();
    }
    if (focus) axisPen = Math.max(0, pens.length - series.length);
  }

  function renderLegend() {
    clear(legend);
    pens.forEach((p, i) => {
      const val = h('span.pen-val');
      p.valEl = val;
      legend.append(h(`div.pen${i === axisPen ? '.axis' : ''}`, {
        style: { borderColor: p.color },
        title: 'Click to use this pen for the Y axis',
        onclick: () => {
          axisPen = i;
          renderLegend();
          draw();
        },
      },
      h('span.swatch', { style: { background: p.color } }),
      h('span.pen-label', {}, p.label),
      val,
      h('span.pen-unit', {}, p.units),
      h('button.pen-x', { title: 'Remove pen', 'aria-label': `Remove ${p.label}`, onclick: (e) => { e.stopPropagation(); pens.splice(i, 1); axisPen = 0; renderLegend(); draw(); } }, '×')));
    });
  }

  async function backfill() {
    if (!pens.length || !store.state) return;
    const now = store.state.t;
    try {
      const res = await client.history(pens.map((p) => p.series), now - span * 1000, Infinity, Math.min(1200, Math.max(300, canvas.clientWidth)));
      for (const p of pens) {
        p.t = [...res.t];
        p.v = [...(res.series[p.series] ?? [])];
      }
      draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function populateSelect() {
    clear(select);
    select.append(h('option', { value: '' }, 'Select tag…'));
    for (const s of store.config.historian.series) {
      const [tag] = splitSeries(s);
      const desc = store.index.points.get(tag)?.description ?? store.index.loops.get(tag)?.description ?? '';
      select.append(h('option', { value: s }, `${s}  ${desc}`));
    }
  }
  select.addEventListener('change', () => {
    if (select.value) addPens([select.value]);
    select.value = '';
  });

  // Live updates from the state stream
  store.on('state', (s) => {
    const cutoff = s.t - span * 1000;
    for (const p of pens) {
      const [tag, field] = splitSeries(p.series);
      const v = field === 'PV' ? s.points?.[tag] : field === 'SP' ? s.loops?.[tag]?.sp : s.loops?.[tag]?.op;
      if (p.t.length && s.t <= p.t.at(-1)) continue;
      p.t.push(s.t);
      p.v.push(Number.isFinite(v) ? v : null);
      let drop = 0;
      while (drop < p.t.length && p.t[drop] < cutoff) drop += 1;
      if (drop) {
        p.t.splice(0, drop);
        p.v.splice(0, drop);
      }
      if (p.valEl) p.valEl.textContent = fmt(v, p.decimals);
    }
    if (!paused && root.offsetParent !== null) draw();
  });

  store.on('init', () => {
    populateSelect();
    if (!pens.length) addPens(DEFAULT_PENS, false);
    else backfill();
  });

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    cursorX = e.clientX - r.left;
    draw();
  });
  canvas.addEventListener('mouseleave', () => {
    cursorX = null;
    draw();
  });
  new ResizeObserver(() => draw()).observe(canvas);

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const ht = canvas.clientHeight;
    if (!w || !ht) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(ht * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(ht * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, ht);
    const padL = 58;
    const padR = 12;
    const padT = 10;
    const padB = 24;
    const pw = w - padL - padR;
    const ph = ht - padT - padB;
    const tEnd = store.state?.t ?? Date.now();
    const tStart = tEnd - span * 1000;
    const xOf = (t) => padL + ((t - tStart) / (tEnd - tStart)) * pw;

    // Grid
    ctx.strokeStyle = '#2a323c';
    ctx.lineWidth = 1;
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#8a96a3';
    for (let i = 0; i <= 5; i += 1) {
      const y = padT + (ph * i) / 5;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + pw, y);
      ctx.stroke();
    }
    const tickEvery = span <= 300 ? 60 : span <= 900 ? 180 : span <= 3600 ? 600 : 3600;
    const firstTick = Math.ceil(tStart / (tickEvery * 1000)) * tickEvery * 1000;
    ctx.textAlign = 'center';
    for (let t = firstTick; t <= tEnd; t += tickEvery * 1000) {
      const x = xOf(t);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + ph);
      ctx.stroke();
      ctx.fillText(fmtTime(t).slice(0, 5), x, ht - 7);
    }

    if (!pens.length) {
      ctx.textAlign = 'center';
      ctx.fillText('Add a pen to start trending', padL + pw / 2, padT + ph / 2);
      return;
    }
    const scales = groupScales(tStart);
    const ax = scales[Math.min(axisPen, pens.length - 1)];
    ctx.textAlign = 'right';
    ctx.fillStyle = pens[Math.min(axisPen, pens.length - 1)].color;
    for (let i = 0; i <= 5; i += 1) {
      const v = ax.hi - ((ax.hi - ax.lo) * i) / 5;
      ctx.fillText(fmt(v, Math.abs(ax.hi - ax.lo) < 5 ? 2 : Math.abs(ax.hi - ax.lo) < 50 ? 1 : 0), padL - 6, padT + (ph * i) / 5 + 4);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, padT, pw, ph);
    ctx.clip();
    pens.forEach((p, idx) => {
      const sc = scales[idx];
      ctx.strokeStyle = p.color;
      ctx.lineWidth = idx === axisPen ? 2 : 1.4;
      ctx.setLineDash(p.series.endsWith('.SP') ? [6, 4] : []);
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < p.t.length; i += 1) {
        const v = p.v[i];
        if (v === null || p.t[i] < tStart) {
          pen = false;
          continue;
        }
        const x = xOf(p.t[i]);
        const y = padT + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph;
        if (!pen) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        pen = true;
      }
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.restore();

    if (cursorX !== null && cursorX >= padL && cursorX <= padL + pw) {
      const tc = tStart + ((cursorX - padL) / pw) * (tEnd - tStart);
      ctx.strokeStyle = '#d7dde4';
      ctx.beginPath();
      ctx.moveTo(cursorX, padT);
      ctx.lineTo(cursorX, padT + ph);
      ctx.stroke();
      const lines = [fmtTime(tc)];
      for (const p of pens) {
        const i = nearest(p.t, tc);
        lines.push(`${p.label}: ${i >= 0 ? fmt(p.v[i], p.decimals) : '—'} ${p.units}`);
      }
      const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
      const bx = cursorX + boxW + 12 > w ? cursorX - boxW - 8 : cursorX + 8;
      ctx.fillStyle = 'rgba(20,24,29,0.92)';
      ctx.fillRect(bx, padT + 4, boxW, lines.length * 15 + 8);
      ctx.textAlign = 'left';
      lines.forEach((l, i) => {
        ctx.fillStyle = i === 0 ? '#d7dde4' : pens[i - 1].color;
        ctx.fillText(l, bx + 8, padT + 18 + i * 15);
      });
    }
  }

  /**
   * Pens sharing engineering units share one scale. A group is zoomed to its
   * visible data when that occupies < 15 % of the instrument range.
   */
  function groupScales(tStart) {
    const groups = new Map();
    for (const p of pens) {
      const g = groups.get(p.units) ?? { lo: Infinity, hi: -Infinity, dLo: Infinity, dHi: -Infinity };
      g.lo = Math.min(g.lo, p.lo);
      g.hi = Math.max(g.hi, p.hi);
      for (let i = 0; i < p.t.length; i += 1) {
        if (p.t[i] < tStart || p.v[i] === null) continue;
        g.dLo = Math.min(g.dLo, p.v[i]);
        g.dHi = Math.max(g.dHi, p.v[i]);
      }
      groups.set(p.units, g);
    }
    for (const g of groups.values()) {
      const range = g.hi - g.lo || 1;
      if (Number.isFinite(g.dLo) && g.dHi - g.dLo < 0.15 * range) {
        const mid = (g.dHi + g.dLo) / 2;
        const half = Math.max((g.dHi - g.dLo) * 0.8, 0.02 * range);
        g.scale = { lo: mid - half, hi: mid + half };
      } else {
        g.scale = { lo: g.lo, hi: g.hi };
      }
    }
    return pens.map((p) => groups.get(p.units).scale);
  }

  return {
    addPens: (series) => addPens(series),
  };
}

function splitSeries(s) {
  const i = s.lastIndexOf('.');
  return [s.slice(0, i), s.slice(i + 1)];
}

function nearest(ts, t) {
  if (!ts.length) return -1;
  let lo = 0;
  let hi = ts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
