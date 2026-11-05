/**
 * Tiny DOM helpers – a hyperscript-style element factory plus formatting.
 */
export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Set text only when it changed (avoids layout churn on 2 Hz updates). */
export function setText(el, text) {
  const t = String(text);
  if (el.textContent !== t) el.textContent = t;
}

export function fmt(v, decimals = 2) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  return Number(v).toFixed(decimals);
}

export function fmtTime(ms, withDate = false) {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour12: false });
  return withDate ? `${d.toLocaleDateString()} ${time}` : time;
}

export function fmtDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export const PRIORITY_CLASS = { CRITICAL: 'p1', HIGH: 'p2', MEDIUM: 'p3', LOW: 'p4' };
export const PRIORITY_SHORT = { CRITICAL: 'CRIT', HIGH: 'HIGH', MEDIUM: 'MED', LOW: 'LOW' };
