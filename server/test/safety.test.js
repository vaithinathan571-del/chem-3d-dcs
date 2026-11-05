import test from 'node:test';
import assert from 'node:assert/strict';
import { settledRuntime, USERS } from './_helpers.js';

test('cooling-water failure causes a runaway that is stopped by IL-001', () => {
  const rt = settledRuntime();
  assert.equal(rt.executeCommand(USERS.instructor, 'malfunction', { id: 'MF-01', active: true }).ok, true);
  let tripped = false;
  for (let i = 0; i < 60 && !tripped; i += 1) {
    rt.advance(60);
    tripped = rt.sis.get('IL-001').tripped;
  }
  assert.ok(tripped, 'IL-001 should trip on high-high reactor temperature');
  const s = rt.liveState();
  assert.equal(s.motors['P-101'].status === 'TRIPPED' || s.motors['P-101'].status === 'STOPPED', true);
  assert.equal(s.loops['FIC-101'].mode, 'MAN');
  assert.deepEqual(s.loops['FIC-101'].il, ['IL-001']);
  assert.equal(s.valves['FV-101'].forced, 0);
  assert.ok(s.alarms.some((a) => a.id === 'IL-001.TRIP' && a.priority === 'CRITICAL'));
  // The first-out function is recorded.
  assert.ok(rt.events.query({ category: 'SIS' }).some((e) => /IL-001 TRIP/.test(e.message)));

  // Feed pump cannot be restarted while the trip is latched.
  const start = rt.executeCommand(USERS.operator, 'motorStart', { id: 'P-101' });
  assert.equal(start.ok, false);
  assert.match(start.message, /inhibited by IL-001/);
});

test('a DCS transmitter failure sheds the loop to MAN but does not trip the SIS', () => {
  const rt = settledRuntime();
  rt.executeCommand(USERS.instructor, 'malfunction', { id: 'MF-14', active: true }); // sump LT fails low (DCS only)
  rt.advance(30);
  // The SIS uses its own transmitter: a DCS transmitter fault must not trip the SIS.
  assert.equal(rt.sis.get('IL-006').tripped, false);
  assert.equal(rt.control.get('LIC-110').mode, 'MAN', 'loop sheds to MAN on BAD PV');
  assert.ok(rt.alarms.list(rt.now).some((a) => a.id === 'LIC-110.BAD'));
});

test('manual ESD trips the reaction section; reset releases the final elements', () => {
  const rt = settledRuntime();
  const r = rt.executeCommand(USERS.operator, 'esd', { id: 'ESD-1' });
  assert.equal(r.ok, true);
  rt.advance(5);
  assert.equal(rt.valves.get('TV-105').forced, 100);
  assert.equal(rt.control.get('TIC-112').op, 0);
  assert.equal(rt.executeCommand(USERS.operator, 'ilReset', { id: 'ESD-1' }).ok, true);
  assert.equal(rt.valves.get('TV-105').forced, null);
  assert.equal(rt.control.get('TIC-105').interlocked, false);
  // After reset the operator can restart the feed pump.
  assert.equal(rt.executeCommand(USERS.operator, 'motorStart', { id: 'P-101' }).ok, true);
});

test('reset is refused while the condition persists, bypass needs engineer role', () => {
  const rt = settledRuntime();
  rt.executeCommand(USERS.operator, 'motorStop', { id: 'P-104' });
  rt.executeCommand(USERS.operator, 'setMode', { tag: 'HIC-115', mode: 'MAN' });
  rt.executeCommand(USERS.operator, 'setOP', { tag: 'HIC-115', value: 0 });
  // Fill the product tank above the high-high trip by forcing the bottoms flow.
  rt.process.s.t102.V = 0.96 * 60;
  rt.advance(1);
  const il = rt.sis.get('IL-007');
  assert.equal(il.tripped, true);
  const reset = rt.executeCommand(USERS.operator, 'ilReset', { id: 'IL-007' });
  assert.equal(reset.ok, false);
  assert.match(reset.message, /condition still present/);

  const denied = rt.executeCommand(USERS.operator, 'ilBypass', { id: 'IL-007', bypass: true });
  assert.equal(denied.ok, false);
  assert.match(denied.message, /Permission denied/);
  assert.equal(rt.executeCommand(USERS.engineer, 'ilBypass', { id: 'IL-007', bypass: true }).ok, true);
  assert.equal(rt.executeCommand(USERS.operator, 'ilReset', { id: 'IL-007' }).ok, true);
});

test('transmitter drift is detected by the DCS/SIS discrepancy alarm', () => {
  const rt = settledRuntime();
  rt.executeCommand(USERS.instructor, 'malfunction', { id: 'MF-13', active: true });
  rt.advance(240);
  assert.ok(rt.alarms.list(rt.now).some((a) => a.id === 'TIC-104.DISC'), 'discrepancy alarm expected');
});

test('permissives block unsafe motor starts', () => {
  const rt = settledRuntime();
  rt.executeCommand(USERS.operator, 'motorStop', { id: 'P-105' });
  rt.process.s.t102.V = 0.02 * 60;
  rt.advance(5);
  const r = rt.executeCommand(USERS.operator, 'motorStart', { id: 'P-105' });
  assert.equal(r.ok, false);
  assert.match(r.message, /permissive/);
});

test('role-based access control on commands', () => {
  const rt = settledRuntime();
  assert.match(rt.executeCommand(USERS.viewer, 'setSP', { tag: 'FIC-101', value: 9 }).message, /Permission denied/);
  assert.match(rt.executeCommand(USERS.operator, 'setTuning', { tag: 'FIC-101', kc: 1 }).message, /Permission denied/);
  assert.match(rt.executeCommand(USERS.engineer, 'malfunction', { id: 'MF-01', active: true }).message, /Permission denied/);
  assert.equal(rt.executeCommand(USERS.engineer, 'setTuning', { tag: 'FIC-101', kc: 0.5 }).ok, true);
  assert.equal(rt.executeCommand(USERS.operator, 'unknownCmd', {}).ok, false);
});
