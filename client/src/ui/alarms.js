/**
 * Alarm banner (always visible) and the alarm summary tab.
 */
import { store } from '../store.js';
import { h, clear, setText, fmt, fmtTime, PRIORITY_CLASS, PRIORITY_SHORT } from './dom.js';

export function createAlarmBanner(root, ctx) {
  const list = h('div.ab-list');
  const counts = {
    CRITICAL: h('span.count.p1', { title: 'Critical' }),
    HIGH: h('span.count.p2', { title: 'High' }),
    MEDIUM: h('span.count.p3', { title: 'Medium' }),
    LOW: h('span.count.p4', { title: 'Low' }),
  };
  const shelved = h('span.count.shelved', { title: 'Shelved alarms' });
  const flood = h('span.flood', { hidden: true }, 'ALARM FLOOD');
  const ack = h('button.btn.small.ack', { onclick: () => ctx.cmd('ackAll', {}), disabled: !store.can('ack') }, 'ACK ALL');
  const mute = h('button.icon-btn', { title: 'Mute horn', 'aria-label': 'Mute alarm horn', onclick: () => {
    ctx.horn.muted = !ctx.horn.muted;
    mute.textContent = ctx.horn.muted ? '🔕' : '🔔';
  } }, '🔔');

  root.append(list, h('div.ab-right', {}, flood, counts.CRITICAL, counts.HIGH, counts.MEDIUM, counts.LOW, shelved, ack, mute));

  store.on('init', () => {
    ack.disabled = !store.can('ack');
  });

  let renderedKey = null;
  store.on('state', (s) => {
    const sum = s.alarmSummary ?? {};
    for (const [p, el] of Object.entries(counts)) {
      setText(el, sum[p] ?? 0);
      el.classList.toggle('zero', !sum[p]);
    }
    setText(shelved, `⏸ ${sum.shelved ?? 0}`);
    shelved.classList.toggle('zero', !sum.shelved);
    flood.hidden = !sum.flood;
    const top = (s.alarms ?? []).filter((a) => a.state === 'UNACK' || a.state === 'ACKED' || a.state === 'RTN_UNACK').slice(0, 3);
    const key = top.map((a) => `${a.id}:${a.state}:${a.text}`).join('|');
    if (key === renderedKey) return;
    renderedKey = key;
    clear(list);
    if (!top.length) {
      list.append(h('div.ab-empty', {}, 'No active alarms'));
      return;
    }
    for (const a of top) {
      list.append(h(`div.ab-item.${PRIORITY_CLASS[a.priority]}${a.state === 'UNACK' ? '.blink' : ''}${a.state === 'RTN_UNACK' ? '.rtn' : ''}`, {
        onclick: () => store.select(selectionFor(a.tag)),
        title: 'Open faceplate',
      },
      h('span.ab-pri', {}, PRIORITY_SHORT[a.priority]),
      h('span.ab-time', {}, fmtTime(a.activeAt)),
      h('span.ab-tag', {}, a.tag),
      h('span.ab-text', {}, a.text),
      store.can('ack') && a.state !== 'ACKED'
        ? h('button.btn.tiny', { onclick: (e) => { e.stopPropagation(); ctx.cmd('ackAlarm', { id: a.id }); } }, 'ACK')
        : null));
    }
  });
}

export function selectionFor(tag) {
  if (store.index.motors.has(tag)) return { kind: 'motor', id: tag };
  if (store.index.points.has(tag) || store.index.loops.has(tag)) return { kind: 'point', id: tag };
  if (store.index.equipment.has(tag)) return { kind: 'equipment', id: tag };
  if (store.index.interlocks.has(tag)) return null;
  return null;
}

export function createAlarmSummary(root, ctx) {
  let filter = 'active';
  const tbody = h('tbody');
  const filters = h('div.seg', { role: 'tablist', 'aria-label': 'Alarm filter' },
    ['active', 'unack', 'shelved'].map((f) => h('button.seg-btn', {
      dataset: { f },
      onclick: () => {
        filter = f;
        for (const b of filters.children) b.classList.toggle('active', b.dataset.f === f);
        draw(store.state);
      },
    }, f === 'active' ? 'Active' : f === 'unack' ? 'Unacknowledged' : 'Shelved')));
  filters.firstChild.classList.add('active');
  const stats = h('span.muted');

  root.append(h('div.alarm-summary', {},
    h('div.toolbar', {}, filters, stats, h('div.spacer'),
      h('button.btn.small', { onclick: () => ctx.cmd('ackAll', {}), disabled: !store.can('ack') }, 'Acknowledge all')),
    h('div.table-wrap', {}, h('table.grid.alarms', {},
      h('thead', {}, h('tr', {}, ['Time', 'Priority', 'Tag', 'Type', 'Description', 'Value', 'State', ''].map((t) => h('th', {}, t)))),
      tbody))));

  let lastKey = '';
  const draw = (s) => {
    if (!s) return;
    const list = (s.alarms ?? []).filter((a) => (filter === 'shelved' ? a.state === 'SHELVED' : filter === 'unack' ? a.state === 'UNACK' || a.state === 'RTN_UNACK' : a.state !== 'SHELVED'));
    const key = filter + list.map((a) => `${a.id}${a.state}${fmt(a.value, 2)}`).join();
    setText(stats, `${list.length} shown · ${s.alarmSummary?.rate10min ?? 0} alarms in last 10 min`);
    if (key === lastKey) return;
    lastKey = key;
    clear(tbody);
    if (!list.length) {
      tbody.append(h('tr', {}, h('td.empty', { colspan: 8 }, filter === 'shelved' ? 'No shelved alarms' : 'No alarms')));
      return;
    }
    for (const a of list) {
      const meta = store.index.points.get(a.tag);
      const actions = h('td.actions');
      if (store.can('ack') && (a.state === 'UNACK' || a.state === 'RTN_UNACK')) actions.append(h('button.btn.tiny', { onclick: () => ctx.cmd('ackAlarm', { id: a.id }) }, 'ACK'));
      if (store.can('shelve')) {
        if (a.state === 'SHELVED') actions.append(h('button.btn.tiny', { onclick: () => ctx.cmd('unshelveAlarm', { id: a.id }) }, 'Unshelve'));
        else if (a.priority !== 'CRITICAL') actions.append(h('button.btn.tiny', { title: 'Shelve for 30 minutes', onclick: () => ctx.cmd('shelveAlarm', { id: a.id, minutes: 30 }) }, 'Shelve 30m'));
      }
      tbody.append(h(`tr.${a.state === 'UNACK' ? 'unack' : ''}`, { dataset: { alarm: a.priority } },
        h('td', {}, fmtTime(a.activeAt)),
        h(`td.${PRIORITY_CLASS[a.priority]}-text`, {}, a.priority),
        h('td.tag-cell.clickable', { onclick: () => store.select(selectionFor(a.tag)) }, a.tag),
        h('td', {}, a.type),
        h('td', {}, a.message),
        h('td.num-cell', {}, Number.isFinite(a.value) ? `${fmt(a.value, meta?.decimals ?? 2)} ${meta?.units ?? ''}` : ''),
        h('td', { dataset: { state: a.state } }, a.state === 'SHELVED' ? `SHELVED until ${fmtTime(a.shelvedUntil)}` : a.state.replace('_', ' ')),
        actions));
    }
  };
  store.on('state', draw);
}
