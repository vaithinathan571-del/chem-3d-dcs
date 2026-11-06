/**
 * Training tab: exercise catalogue with briefings, live objective tracking
 * for the running exercise, results history and debrief reports.
 */
import { store } from '../store.js';
import { h, clear, setText, fmtTime } from './dom.js';
import { toast, modal, confirmDialog } from './notify.js';

const GRADE_TEXT = { A: 'Excellent', B: 'Good', C: 'Satisfactory', D: 'Needs practice' };
const KIND_LABEL = { upset: 'Upset', message: 'Message', hint: 'Hint', trip: 'SIS trip', violation: 'Violation', info: 'Info' };

export const mmss = (s) => `${String(Math.floor((s ?? 0) / 60)).padStart(2, '0')}:${String(Math.floor((s ?? 0) % 60)).padStart(2, '0')}`;

function criterionState(c) {
  if (c.passed) return 'pass';
  if (c.pending) return 'pending';
  return 'fail';
}

function criteriaTable(criteria) {
  return h('table.grid.criteria', {},
    h('thead', {}, h('tr', {}, ['', 'Objective', 'Result', 'Points'].map((t) => h('th', {}, t)))),
    h('tbody', {}, criteria.map((c) => {
      const st = criterionState(c);
      return h(`tr.crit-${st}`, {},
        h('td.crit-icon', { 'aria-label': st }, st === 'pass' ? '✓' : st === 'pending' ? '…' : '✗'),
        h('td', {}, c.label),
        h('td.small-text', {}, c.detail),
        h('td.num-cell', {}, `${Math.round(c.score)}/${c.weight}`));
    })));
}

function timelineList(timeline, newestFirst = true) {
  const items = newestFirst ? [...timeline].reverse() : timeline;
  return h('ol.timeline', {}, items.map((e) =>
    h(`li.tl-${e.kind}`, {}, h('span.tl-time', {}, mmss(e.t)), h('span.tl-kind', {}, KIND_LABEL[e.kind] ?? e.kind), h('span.tl-text', {}, e.text))));
}

export function createTraining(root, ctx) {
  const catalog = h('div.tr-catalog');
  const current = h('div.tr-current');
  const resultsBody = h('tbody');
  const locked = h('div.locked', {}, 'Training exercises require the operator, engineer or instructor role.');
  const content = h('div.training', {},
    h('section', {}, h('h3', {}, 'Exercises'), catalog),
    h('section', {},
      h('h3', {}, 'Current exercise'), current,
      h('h3', {}, 'Results'),
      h('div.table-wrap', {}, h('table.grid', {},
        h('thead', {}, h('tr', {}, ['Finished', 'Exercise', 'Trainee', 'Score', 'Grade', ''].map((t) => h('th', {}, t)))),
        resultsBody))));

  // ----------------------------------------------------------- catalogue
  const buildCatalog = () => {
    clear(root);
    if (!store.can('train')) {
      root.append(locked);
      return;
    }
    root.append(content);
    clear(catalog);
    for (const sc of store.config.scenarios ?? []) {
      catalog.append(h('article.sc-card', {},
        h('div.sc-head', {}, h('strong', {}, `${sc.id} · ${sc.title}`), h(`span.badge.diff-${sc.difficulty.toLowerCase()}`, {}, sc.difficulty)),
        h('p.small-text.muted', {}, sc.summary),
        h('div.sc-foot', {}, h('span.muted.small-text', {}, `${Math.round(sc.duration / 60)} min simulated · ${sc.objectives.length} objectives`),
          h('button.btn.small.primary', { onclick: () => briefing(sc) }, 'Brief & start'))));
    }
  };

  function briefing(sc) {
    const body = h('div.briefing', {},
      h('div.badges', {}, h(`span.badge.diff-${sc.difficulty.toLowerCase()}`, {}, sc.difficulty), h('span.badge', {}, `${Math.round(sc.duration / 60)} min simulated`)),
      h('p', {}, sc.briefing),
      h('h4', {}, 'You are scored on'),
      h('ul.objectives', {}, sc.objectives.map((o) => h('li', {}, h('span', {}, o.label), h('span.muted', {}, `${o.weight} pts`)))),
      h('p.muted.small-text', {}, 'Starting resets the plant to normal operation. Messages and hints appear as the exercise runs.'
        + (store.can('sim') ? ' Use the speed selector on the Instructor tab to fast-forward.' : '')));
    modal({
      title: `${sc.id} · ${sc.title}`,
      body,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Start exercise',
          kind: 'primary',
          onClick: async (close) => {
            const r = await ctx.cmd('scenarioStart', { id: sc.id }, `${sc.id} started – good luck`);
            if (r.ok) close();
          },
        },
      ],
    });
  }

  // ------------------------------------------------------- active run
  const run = {
    title: h('strong'),
    meta: h('span.muted.small-text'),
    bar: h('div.progress-fill'),
    time: h('span.mono'),
    score: h('div.live-score'),
    criteria: h('div'),
    timeline: h('div.tl-wrap'),
  };
  const abortBtn = h('button.btn.small.warn', {
    onclick: async () => {
      if (await confirmDialog({ title: 'Abort exercise?', message: 'The exercise will end without a score.', confirmLabel: 'Abort', danger: true })) ctx.cmd('scenarioAbort', {});
    },
  }, 'Abort');
  const runPanel = h('div.run-panel', {},
    h('div.run-head', {}, h('div', {}, run.title, h('br'), run.meta), h('div.run-score', {}, run.score, h('span.muted.small-text', {}, 'score so far'))),
    h('div.progress', {}, run.bar), h('div.run-time', {}, run.time, abortBtn),
    run.criteria,
    h('h4', {}, 'Timeline'),
    run.timeline);
  const idle = h('p.muted', {}, 'No exercise running. Choose one from the list to read its briefing.');

  let lastRunId = null;
  let seenTimeline = 0;
  let lastCriteriaKey = '';
  let lastTimelineLen = -1;

  store.on('state', (s) => {
    const a = s.training?.active;
    ctx.setTrainingBadge(a);
    if (!store.can('train')) return;
    if (!a) {
      if (current.firstChild !== idle) current.replaceChildren(idle);
      return;
    }
    if (current.firstChild !== runPanel) current.replaceChildren(runPanel);
    if (a.runId !== lastRunId) {
      lastRunId = a.runId;
      seenTimeline = a.timeline.length;
      lastCriteriaKey = '';
      lastTimelineLen = -1;
    }
    setText(run.title, `${a.scenarioId} · ${a.title}`);
    setText(run.meta, `Trainee ${a.user}`);
    run.bar.style.width = `${Math.min((a.elapsed / a.duration) * 100, 100)}%`;
    setText(run.time, `${mmss(a.elapsed)} / ${mmss(a.duration)}`);
    setText(run.score, String(a.score));
    const key = a.criteria.map((c) => `${c.score}${c.detail}${c.pending}`).join('|');
    if (key !== lastCriteriaKey) {
      lastCriteriaKey = key;
      run.criteria.replaceChildren(criteriaTable(a.criteria));
    }
    if (a.timeline.length !== lastTimelineLen) {
      lastTimelineLen = a.timeline.length;
      run.timeline.replaceChildren(timelineList(a.timeline));
    }
    // Announce new messages, hints and trips.
    for (const e of a.timeline.slice(seenTimeline)) {
      if (e.kind === 'message') toast(e.text, 'info', 8000);
      else if (e.kind === 'hint') toast(`💡 ${e.text}`, 'hint', 12000);
      else if (e.kind === 'trip' || e.kind === 'violation') toast(e.text, 'error', 8000);
    }
    seenTimeline = a.timeline.length;
  });

  // ------------------------------------------------------------ results
  let knownRuns = null;
  store.on('trainingResults', (items) => {
    clear(resultsBody);
    if (!items.length) resultsBody.append(h('tr', {}, h('td.empty', { colspan: 6 }, 'No exercises completed yet')));
    for (const r of items) {
      resultsBody.append(h('tr.clickable', { onclick: () => debrief(r) },
        h('td.nowrap', {}, fmtTime(r.endedAt, true)),
        h('td', {}, `${r.scenarioId} · ${r.title}`),
        h('td', {}, r.user),
        h('td.num-cell', {}, r.score ?? '—'),
        h('td', {}, r.grade ? h(`span.grade.grade-${r.grade}`, {}, r.grade) : h('span.muted', {}, 'aborted')),
        h('td', {}, h('button.btn.tiny', { onclick: (e) => { e.stopPropagation(); debrief(r); } }, 'Debrief'))));
    }
    // A run that just finished in this session opens its debrief automatically.
    if (knownRuns) {
      const fresh = items.find((r) => !knownRuns.has(r.runId));
      if (fresh && fresh.runId === lastRunId) {
        if (fresh.status === 'completed') toast(`Exercise complete – score ${fresh.score} (${fresh.grade})`, 'ok', 8000);
        ctx.openTab('training');
        debrief(fresh);
      }
    }
    knownRuns = new Set(items.map((r) => r.runId));
  });

  store.on('init', buildCatalog);
}

function debrief(r) {
  const head = r.status === 'completed'
    ? h('div.debrief-score', {},
      h(`div.grade-big.grade-${r.grade}`, {}, r.grade),
      h('div', {}, h('div.score-num', {}, `${r.score} / 100`), h('div.muted', {}, GRADE_TEXT[r.grade])))
    : h('div.debrief-score', {}, h('div.grade-big.aborted', {}, '—'), h('div', {}, h('div.score-num', {}, 'Aborted'), h('div.muted', {}, r.reason)));
  const body = h('div.debrief', {},
    h('p.muted.small-text', {}, `${r.difficulty} · trainee ${r.user} · ${fmtTime(r.startedAt, true)} · ${mmss(r.duration)} simulated`),
    head,
    h('div.debrief-stats', {},
      stat('Alarms raised', r.stats.alarms),
      stat('Acknowledged', r.stats.acknowledged),
      stat('Operator actions', r.stats.operatorActions),
      stat('SIS trips', r.stats.trips)),
    h('h4', {}, 'Objectives'),
    criteriaTable(r.criteria),
    r.violations.length ? [h('h4', {}, 'Violations'), h('ul', {}, r.violations.map((v) => h('li.p1-text', {}, `${mmss(v.t)} ${v.text}`)))] : null,
    h('h4', {}, 'Timeline'),
    h('div.tl-wrap.tall', {}, timelineList(r.timeline, false)));
  modal({
    title: `Debrief – ${r.scenarioId} ${r.title}`,
    body,
    wide: true,
    actions: [{ label: 'Download report', onClick: () => downloadReport(r) }, { label: 'Close', kind: 'primary' }],
  });
}

function stat(label, value) {
  return h('div.dstat', {}, h('div.dstat-val', {}, String(value)), h('div.muted.small-text', {}, label));
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Self-contained, printable HTML training report. */
function downloadReport(r) {
  const rows = r.criteria.map((c) => `<tr><td>${c.passed ? '✓' : '✗'}</td><td>${esc(c.label)}</td><td>${esc(c.detail)}</td><td class="n">${Math.round(c.score)}/${c.weight}</td></tr>`).join('');
  const tl = r.timeline.map((e) => `<tr><td class="n">${mmss(e.t)}</td><td>${esc(KIND_LABEL[e.kind] ?? e.kind)}</td><td>${esc(e.text)}</td></tr>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Training report ${esc(r.scenarioId)} – ${esc(r.user)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;color:#1d2329;max-width:820px;margin:32px auto;padding:0 16px}h1{font-size:22px;margin:0}h2{font-size:15px;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.06em;color:#56616d}
table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #dde2e7;padding:5px 6px;text-align:left;vertical-align:top}.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.score{display:flex;gap:18px;align-items:center;margin:16px 0}.grade{font-size:40px;font-weight:700;width:72px;height:72px;border-radius:50%;display:grid;place-items:center;border:3px solid #1f5fa8;color:#1f5fa8}
.meta{color:#56616d}.stats{display:flex;gap:28px}.stats b{display:block;font-size:20px}</style></head><body>
<h1>CHEM-3D DCS – training report</h1><p class="meta">${esc(r.scenarioId)} · ${esc(r.title)} (${esc(r.difficulty)})<br>Trainee: ${esc(r.user)} · ${esc(new Date(r.startedAt).toLocaleString())} · ${mmss(r.duration)} simulated</p>
<div class="score"><div class="grade">${esc(r.grade ?? '—')}</div><div><b style="font-size:24px">${r.status === 'completed' ? `${r.score} / 100` : 'Aborted'}</b><br><span class="meta">${esc(r.status === 'completed' ? GRADE_TEXT[r.grade] : r.reason)}</span></div></div>
<div class="stats"><div><b>${r.stats.alarms}</b>alarms raised</div><div><b>${r.stats.acknowledged}</b>acknowledged</div><div><b>${r.stats.operatorActions}</b>operator actions</div><div><b>${r.stats.trips}</b>SIS trips</div></div>
<h2>Objectives</h2><table><tr><th></th><th>Objective</th><th>Result</th><th class="n">Points</th></tr>${rows}</table>
${r.violations.length ? `<h2>Violations</h2><ul>${r.violations.map((v) => `<li>${mmss(v.t)} ${esc(v.text)}</li>`).join('')}</ul>` : ''}
<h2>Timeline</h2><table>${tl}</table></body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `chem3d-training-${r.scenarioId}-${r.user}-${new Date(r.endedAt).toISOString().slice(0, 16).replace(/[:T]/g, '')}.html` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
