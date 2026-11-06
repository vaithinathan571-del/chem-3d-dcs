/**
 * Sequence-of-events journal tab.
 */
import { store } from '../store.js';
import { h, clear, fmtTime, PRIORITY_CLASS } from './dom.js';

const CATEGORIES = ['ALL', 'ALARM', 'OPERATOR', 'ENGINEER', 'SIS', 'INSTRUCTOR', 'TRAINING', 'SYSTEM'];

export function createEvents(root) {
  let category = 'ALL';
  let text = '';
  const tbody = h('tbody');
  const select = h('select', { 'aria-label': 'Category', onchange: (e) => { category = e.target.value; draw(); } },
    CATEGORIES.map((c) => h('option', { value: c }, c === 'ALL' ? 'All categories' : c)));
  const search = h('input.search', { type: 'search', placeholder: 'Filter text or tag…', 'aria-label': 'Filter events', oninput: (e) => { text = e.target.value.toLowerCase(); draw(); } });
  const count = h('span.muted');

  root.append(h('div.events', {},
    h('div.toolbar', {}, select, search, count, h('div.spacer'),
      h('button.btn.small', { onclick: exportCsv }, 'Export CSV')),
    h('div.table-wrap', {}, h('table.grid.events-table', {},
      h('thead', {}, h('tr', {}, ['Time', 'Category', 'Priority', 'Tag', 'User', 'Message'].map((t) => h('th', {}, t)))),
      tbody))));

  function filtered() {
    return store.events.filter((e) => (category === 'ALL' || e.category === category)
      && (!text || e.message.toLowerCase().includes(text) || (e.tag ?? '').toLowerCase().includes(text)));
  }

  function draw() {
    const list = filtered();
    count.textContent = `${list.length} events`;
    clear(tbody);
    const rows = list.slice(-400).reverse();
    for (const e of rows) {
      tbody.append(h('tr', { dataset: { cat: e.category } },
        h('td.nowrap', {}, fmtTime(e.t)),
        h('td', {}, e.category),
        h(`td.${e.priority ? `${PRIORITY_CLASS[e.priority]}-text` : ''}`, {}, e.priority ?? ''),
        h('td.tag-cell', {}, e.tag ?? ''),
        h('td', {}, e.user ?? ''),
        h('td', {}, e.message)));
    }
  }

  function exportCsv() {
    const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const lines = ['time,category,priority,tag,user,message', ...filtered().map((e) => [new Date(e.t).toISOString(), e.category, e.priority, e.tag, e.user, e.message].map(esc).join(','))];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `chem3d-events-${new Date().toISOString().slice(0, 19).replaceAll(':', '')}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  let pending = false;
  store.on('events', () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (root.offsetParent !== null || !tbody.firstChild) draw();
    });
  });
  return { refresh: draw };
}
