import test from 'node:test';
import assert from 'node:assert/strict';
import { PIDController } from '../src/control/pid.js';
import { ControlSystem } from '../src/control/controlSystem.js';
import { Valve } from '../src/plant/equipment.js';

const base = { tag: 'XIC-1', lo: 0, hi: 100, kc: 1, ti: 10, td: 0, sp: 50, op: 50, mode: 'AUTO', scan: 1 };

test('reverse-acting controller opens the valve when PV is below SP', () => {
  const c = new PIDController({ ...base, action: 'reverse' });
  for (let i = 0; i < 5; i += 1) c.execute(40, 'GOOD', 1);
  assert.ok(c.op > 50, `op should rise, got ${c.op}`);
});

test('direct-acting controller opens the valve when PV is above SP', () => {
  const c = new PIDController({ ...base, action: 'direct' });
  for (let i = 0; i < 5; i += 1) c.execute(60, 'GOOD', 1);
  assert.ok(c.op > 50, `op should rise, got ${c.op}`);
});

test('output is clamped to its limits (anti-windup) and recovers immediately', () => {
  const c = new PIDController({ ...base, action: 'reverse', kc: 5, ti: 1 });
  for (let i = 0; i < 100; i += 1) c.execute(0, 'GOOD', 1);
  assert.equal(c.op, 100);
  // As soon as the error changes sign, the output must move off the limit.
  c.execute(100, 'GOOD', 1);
  assert.ok(c.op < 100);
});

test('MAN → AUTO transfer is bumpless and SP tracks PV in MAN', () => {
  const c = new PIDController({ ...base, action: 'reverse', mode: 'MAN', op: 37 });
  c.execute(42, 'GOOD', 1);
  assert.equal(c.sp, 42, 'SP tracks PV in MAN');
  assert.equal(c.setMode('AUTO'), null);
  c.execute(42, 'GOOD', 1);
  assert.ok(Math.abs(c.op - 37) < 1e-9, `no bump expected, op=${c.op}`);
});

test('scan rate: algorithm only executes once per scan period', () => {
  const c = new PIDController({ ...base, action: 'reverse', scan: 1 });
  c.execute(40, 'GOOD', 0.25);
  assert.equal(c.op, 50);
  c.execute(40, 'GOOD', 0.25);
  c.execute(40, 'GOOD', 0.25);
  c.execute(40, 'GOOD', 0.25);
  assert.notEqual(c.op, 50);
});

test('BAD PV sheds the loop to MAN and blocks AUTO', () => {
  const c = new PIDController({ ...base, action: 'reverse' });
  const msg = c.execute(-10, 'BAD', 1);
  assert.match(msg, /shed to MAN/);
  assert.equal(c.mode, 'MAN');
  assert.match(c.setMode('AUTO'), /BAD/);
});

test('setOutput is rejected unless in MAN, setpoint rejected in CAS', () => {
  const c = new PIDController({ ...base, action: 'reverse', master: 'M' });
  assert.match(c.setOutput(10), /MAN/);
  assert.equal(c.setMode('CAS'), null);
  assert.match(c.setSetpoint(10), /CAS/);
});

test('interlocked loop is forced to MAN at a safe output and cannot be operated', () => {
  const c = new PIDController({ ...base, action: 'reverse' });
  c.force('IL-1', 0);
  assert.equal(c.mode, 'MAN');
  assert.equal(c.op, 0);
  assert.match(c.setOutput(50), /interlocked/);
  assert.match(c.setMode('AUTO'), /interlocked/);
  c.release('IL-1');
  assert.equal(c.setOutput(50), null);
});

test('cascade: master tracks slave SP (IMAN) until the slave is in CAS', () => {
  const valves = new Map([['V-1', new Valve({ id: 'V-1' })]]);
  const cs = new ControlSystem(
    [
      { tag: 'TIC-M', lo: 0, hi: 200, action: 'reverse', kc: 1, ti: 100, sp: 80, op: 50, mode: 'AUTO', output: { cascade: 'TIC-S', lo: 20, hi: 100 }, scan: 0.5 },
      { tag: 'TIC-S', lo: 0, hi: 150, action: 'direct', kc: 1, ti: 50, sp: 70, op: 30, mode: 'AUTO', output: { valve: 'V-1' }, scan: 0.5 },
    ],
    valves,
  );
  const master = cs.get('TIC-M');
  const slave = cs.get('TIC-S');
  const pv = { 'TIC-M': { value: 80, quality: 'GOOD' }, 'TIC-S': { value: 70, quality: 'GOOD' } };
  cs.execute(0.5, (t) => pv[t]);
  assert.equal(master.iman, true);
  assert.ok(Math.abs(master.cascadeValue() - 70) < 1e-9, 'master output back-calculated from slave SP');
  assert.equal(slave.setMode('CAS'), null);
  cs.execute(0.5, (t) => pv[t]);
  assert.equal(master.iman, false);
  assert.ok(Math.abs(slave.sp - 70) < 0.01, `closing the cascade must be bumpless, slave sp=${slave.sp}`);
  // Masters execute before slaves.
  assert.deepEqual(cs.order.map((l) => l.tag), ['TIC-M', 'TIC-S']);
});

test('derivative is filtered: a single noise spike does not saturate the output', () => {
  const c = new PIDController({ ...base, action: 'reverse', kc: 3, ti: 500, td: 30, scan: 0.5 });
  for (let i = 0; i < 10; i += 1) c.execute(50, 'GOOD', 0.5);
  c.execute(50.3, 'GOOD', 0.5);
  assert.ok(Math.abs(c.op - 50) < 10, `op jumped to ${c.op}`);
});
