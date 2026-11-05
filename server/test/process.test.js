import test from 'node:test';
import assert from 'node:assert/strict';
import { settledRuntime, USERS } from './_helpers.js';
import { solveSplit } from '../src/plant/process.js';
import { bubbleTempC, steamSatTempC } from '../src/plant/thermo.js';

test('thermodynamics: pure component boiling points and steam table approximation', () => {
  assert.ok(Math.abs(bubbleTempC(1, 1.013) - 80) < 1.5, 'A boils near 80 °C');
  assert.ok(Math.abs(bubbleTempC(0, 1.013) - 140) < 1.5, 'B boils near 140 °C');
  assert.ok(bubbleTempC(0.5, 1.013) > 80 && bubbleTempC(0.5, 1.013) < 140);
  assert.ok(Math.abs(steamSatTempC(10) - 184) < 5);
});

test('column split satisfies the component balance', () => {
  const F = 10;
  const xf = 0.2;
  const D = 2;
  const { xD, xB } = solveSplit(F, xf, D, 1500);
  assert.ok(Math.abs(D * xD + (F - D) * xB - F * xf) < 1e-6);
  assert.ok(xD > 0.9 && xB < 0.02);
});

test('plant settles at the design operating point with no alarms or trips', () => {
  const rt = settledRuntime();
  rt.advance(600);
  const s = rt.liveState();
  const p = s.points;
  assert.ok(Math.abs(p['TIC-104'] - 85) < 1.5, `reactor T ${p['TIC-104']}`);
  assert.ok(Math.abs(p['FIC-101'] - 10) < 0.5, `feed ${p['FIC-101']}`);
  assert.ok(Math.abs(p['LIC-103'] - 60) < 3, `reactor level ${p['LIC-103']}`);
  assert.ok(Math.abs(p['PIC-111'] - 1.3) < 0.05, `column P ${p['PIC-111']}`);
  assert.ok(p['AI-114'] > 99, `purity ${p['AI-114']}`);
  assert.ok(s.kpis.conversion > 75, `conversion ${s.kpis.conversion}`);
  assert.equal(s.sis.filter((x) => x.tripped).length, 0);
  assert.deepEqual(s.alarms.map((a) => a.id), []);
  for (const [tag, loop] of Object.entries(s.loops)) {
    if (tag === 'HIC-115') continue;
    assert.ok(loop.op > 2 && loop.op < 98, `${tag} output saturated at ${loop.op}`);
  }
});

test('plant-wide material balance closes at steady state', () => {
  const rt = settledRuntime();
  rt.advance(300);
  const f = rt.process.flows;
  // Volumetric: fresh feed in ≈ bottoms product out (equimolar reaction, constant density).
  assert.ok(Math.abs(f.fresh - f.bottoms) < 0.4, `fresh ${f.fresh} vs bottoms ${f.bottoms}`);
  // Reactor: feed ≈ effluent
  assert.ok(Math.abs(f.feed - f.reactorOut) < 0.3);
});

test('snapshot save/restore reproduces the plant state exactly', () => {
  const rt = settledRuntime();
  const r = rt.executeCommand(USERS.instructor, 'snapshotSave', { name: 'test' });
  assert.equal(r.ok, true);
  const before = structuredClone(rt.process.s);
  rt.executeCommand(USERS.operator, 'setSP', { tag: 'TIC-104', value: 90 });
  rt.advance(900);
  assert.notDeepEqual(rt.process.s.r101.T, before.r101.T);
  assert.equal(rt.executeCommand(USERS.instructor, 'snapshotLoad', { id: r.data.id }).ok, true);
  assert.deepEqual(rt.process.s, before);
  assert.equal(rt.control.get('TIC-104').sp, 85);
});

test('setpoint change on the reactor temperature is followed', () => {
  const rt = settledRuntime();
  assert.equal(rt.executeCommand(USERS.operator, 'setSP', { tag: 'TIC-104', value: 88 }).ok, true);
  rt.advance(3600);
  const pv = rt.transmitters.get('TIC-104').value;
  assert.ok(Math.abs(pv - 88) < 1, `TIC-104 PV ${pv}`);
  // Higher temperature → higher conversion
  assert.ok(rt.process.kpis().conversion > 80);
});

test('stopping the feed pump stops the flow and raises the low-flow alarm', () => {
  const rt = settledRuntime();
  rt.executeCommand(USERS.operator, 'motorStop', { id: 'P-101' });
  rt.advance(600);
  assert.ok(rt.transmitters.get('FIC-101').value < 0.2);
  assert.equal(rt.motors.get('P-101').status, 'STOPPED');
  assert.ok(rt.alarms.list(rt.now).some((a) => a.id === 'FIC-101.LO'));
});
