import test from 'node:test';
import assert from 'node:assert/strict';
import { settledRuntime, USERS } from './_helpers.js';
import { SCENARIOS } from '../src/training/scenarios.js';
import { gradeFor } from '../src/training/trainingManager.js';

/** Run the active scenario to completion, executing `plan[t]` commands and acknowledging alarms if `ack`. */
function play(rt, plan = {}, ack = false) {
  for (let t = 1; rt.trainer.active; t += 1) {
    rt.advance(1);
    for (const [cmd, p] of plan[t] ?? []) assert.equal(rt.executeCommand(USERS.instructor, cmd, p).ok, true, `${cmd} at ${t}s`);
    if (ack && t % 10 === 0) rt.executeCommand(USERS.operator, 'ackAll', {});
  }
  return rt.trainer.results[0];
}

test('every scenario is well formed: weights sum to 100, events reference real malfunctions', () => {
  const rt = settledRuntime();
  for (const sc of SCENARIOS) {
    assert.equal(sc.criteria.reduce((s, c) => s + c.weight, 0), 100, `${sc.id} weights`);
    for (const ev of sc.events) {
      assert.ok(ev.at < sc.duration, `${sc.id} event at ${ev.at}s is inside the exercise`);
      if (ev.malfunction) assert.ok(rt.malfunctions.defs.has(ev.malfunction), `${sc.id} ${ev.malfunction}`);
    }
    for (const c of sc.criteria) if (c.tag) assert.ok(rt.points.has(c.tag), `${sc.id} ${c.tag}`);
  }
  assert.deepEqual(['A', 'B', 'C', 'D'], [95, 80, 65, 10].map(gradeFor));
});

test('cooling-water failure: doing nothing ends in a trip and a failing grade', () => {
  const rt = settledRuntime();
  assert.equal(rt.executeCommand(USERS.operator, 'scenarioStart', { id: 'SC-03' }).ok, true);
  const r = play(rt);
  assert.equal(r.status, 'completed');
  assert.equal(r.grade, 'D');
  assert.equal(r.criteria.find((c) => c.id === 'no-trip').passed, false);
  assert.ok(r.timeline.some((e) => e.kind === 'trip' && /IL-001/.test(e.text)));
  assert.ok(r.timeline.some((e) => e.kind === 'upset'));
});

test('cooling-water failure: a competent response scores an A', () => {
  const rt = settledRuntime();
  rt.executeCommand(USERS.operator, 'scenarioStart', { id: 'SC-03' });
  const r = play(rt, {
    130: [['setSP', { tag: 'FIC-101', value: 2 }], ['setSP', { tag: 'TIC-102', value: 35 }]],
    1520: [['ilReset', { id: 'IL-005' }], ['setMode', { tag: 'PIC-111', mode: 'AUTO' }], ['setMode', { tag: 'TIC-112', mode: 'AUTO' }]],
    1560: [['setSP', { tag: 'TIC-102', value: 70 }], ['setSP', { tag: 'FIC-101', value: 9 }]],
  }, true);
  assert.equal(r.grade, 'A', JSON.stringify(r.criteria));
  assert.ok(r.stats.operatorActions >= 6);
});

test('transmitter drift: intervening early protects the reactor', () => {
  const rt = settledRuntime();
  rt.executeCommand(USERS.operator, 'scenarioStart', { id: 'SC-05' });
  const r = play(rt, {
    220: [['setMode', { tag: 'TIC-105', mode: 'AUTO' }], ['setSP', { tag: 'TIC-105', value: 66 }]],
    860: [['setMode', { tag: 'TIC-105', mode: 'CAS' }], ['setMode', { tag: 'TIC-104', mode: 'AUTO' }]],
  }, true);
  assert.equal(r.score, 100, JSON.stringify(r.criteria));
  assert.match(r.criteria.find((c) => c.id === 'intervene').detail, /TIC-105 → AUTO/);
});

test('live status, permissions, abort and violations', () => {
  const rt = settledRuntime();
  assert.match(rt.executeCommand(USERS.viewer, 'scenarioStart', { id: 'SC-01' }).message, /Permission denied/);
  assert.match(rt.executeCommand(USERS.operator, 'scenarioStart', { id: 'SC-99' }).message, /Unknown scenario/);
  assert.equal(rt.executeCommand(USERS.operator, 'scenarioStart', { id: 'SC-02' }).ok, true);
  assert.match(rt.executeCommand(USERS.operator, 'scenarioStart', { id: 'SC-01' }).message, /already running/);

  rt.advance(120);
  const live = rt.liveState().training.active;
  assert.equal(live.scenarioId, 'SC-02');
  assert.ok(live.elapsed >= 119 && live.elapsed <= 121);
  assert.equal(rt.motors.get('M-101').status, 'TRIPPED', 'scheduled malfunction fired');
  assert.ok(live.criteria.find((c) => c.id === 'agitator').pending);
  assert.ok(live.timeline.some((e) => e.kind === 'message'), 'field message is shown');
  assert.ok(live.timeline.every((e) => e.kind !== 'upset'), 'upsets are hidden from the trainee');

  rt.executeCommand(USERS.engineer, 'ilBypass', { id: 'IL-001', bypass: true });
  rt.advance(2);
  assert.equal(rt.trainer.status().active.criteria.find((c) => c.id === 'no-trip').passed, false, 'bypass voids the no-trip objective');

  // Loading a snapshot during the exercise aborts it.
  const before = rt.trainer.version;
  rt.executeCommand(USERS.instructor, 'snapshotLoad', { id: 'baseline' });
  assert.equal(rt.trainer.active, null);
  assert.equal(rt.trainer.version, before + 1);
  const r = rt.trainer.results[0];
  assert.equal(r.status, 'aborted');
  assert.equal(r.score, null);
  assert.match(r.reason, /Snapshot loaded/);
  assert.ok(r.violations.some((v) => /IL-001 bypassed/.test(v.text)));
  assert.match(rt.executeCommand(USERS.operator, 'scenarioAbort', {}).message, /No scenario/);
});
