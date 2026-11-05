import test from 'node:test';
import assert from 'node:assert/strict';
import { AlarmManager } from '../src/alarms/alarmManager.js';

function setup() {
  const log = [];
  const am = new AlarmManager((e) => log.push(e));
  am.define({ id: 'TI-1.HI', tag: 'TI-1', type: 'HI', priority: 'HIGH', limit: 100, deadband: 2, delay: 3, message: 'Temp high', units: '°C' });
  am.define({ id: 'TI-1.HIHI', tag: 'TI-1', type: 'HIHI', priority: 'CRITICAL', limit: 120, deadband: 2, delay: 0, message: 'Temp high-high' });
  am.define({ id: 'LI-1.LO', tag: 'LI-1', type: 'LO', priority: 'MEDIUM', limit: 20, deadband: 1, delay: 0, message: 'Level low' });
  return { am, log };
}

test('on-delay: alarm activates only after the condition persists', () => {
  const { am } = setup();
  am.evaluateAnalog('TI-1', 105, 'GOOD', 0);
  am.evaluateAnalog('TI-1', 105, 'GOOD', 2000);
  assert.equal(am.list(2000).length, 0);
  am.evaluateAnalog('TI-1', 105, 'GOOD', 3000);
  const list = am.list(3000);
  assert.equal(list.length, 1);
  assert.equal(list[0].state, 'UNACK');
});

test('deadband prevents chattering around the limit', () => {
  const { am } = setup();
  am.evaluateAnalog('TI-1', 125, 'GOOD', 0);
  assert.equal(am.list(0)[0].id, 'TI-1.HIHI');
  am.evaluateAnalog('TI-1', 119, 'GOOD', 100); // inside deadband – still active
  assert.equal(am.states.get('TI-1.HIHI').active, true);
  am.evaluateAnalog('TI-1', 117.5, 'GOOD', 200);
  assert.equal(am.states.get('TI-1.HIHI').active, false);
});

test('ISA-18.2 state sequence: UNACK → ACKED → NORMAL and UNACK → RTN_UNACK → NORMAL', () => {
  const { am } = setup();
  am.evaluateAnalog('LI-1', 10, 'GOOD', 0);
  assert.equal(am.list(0)[0].state, 'UNACK');
  am.ack('LI-1.LO', 'op');
  assert.equal(am.list(0)[0].state, 'ACKED');
  am.evaluateAnalog('LI-1', 30, 'GOOD', 10);
  assert.equal(am.list(10).length, 0);

  am.evaluateAnalog('LI-1', 10, 'GOOD', 20);
  am.evaluateAnalog('LI-1', 30, 'GOOD', 30);
  assert.equal(am.list(30)[0].state, 'RTN_UNACK');
  am.ack('LI-1.LO', 'op');
  assert.equal(am.list(30).length, 0);
});

test('shelving hides an alarm until it expires; critical alarms cannot be shelved', () => {
  const { am } = setup();
  am.evaluateAnalog('LI-1', 10, 'GOOD', 0);
  assert.equal(am.shelve('LI-1.LO', 5, 'op', 0), null);
  assert.equal(am.list(1000)[0].state, 'SHELVED');
  assert.equal(am.summary(1000).total, 0);
  am.housekeeping(6 * 60_000);
  assert.equal(am.list(6 * 60_000)[0].state, 'ACKED');

  am.evaluateAnalog('TI-1', 130, 'GOOD', 0);
  assert.match(am.shelve('TI-1.HIHI', 5, 'op', 0), /cannot be shelved/);
});

test('limit alarms are held while the PV is BAD', () => {
  const { am } = setup();
  am.evaluateAnalog('LI-1', -10, 'BAD', 0);
  assert.equal(am.list(0).length, 0);
});

test('summary counts and list ordering by priority', () => {
  const { am } = setup();
  am.evaluateAnalog('LI-1', 10, 'GOOD', 0);
  am.evaluateAnalog('TI-1', 130, 'GOOD', 0);
  const list = am.list(0);
  assert.deepEqual(list.map((a) => a.priority), ['CRITICAL', 'MEDIUM']);
  const s = am.summary(0);
  assert.equal(s.total, 2);
  assert.equal(s.unacked, 2);
  assert.equal(s.CRITICAL, 1);
  am.ackAll('op', 0);
  assert.equal(am.summary(0).unacked, 0);
});

test('disabled alarms never annunciate; limit changes are audited', () => {
  const { am, log } = setup();
  am.setEnabled('LI-1.LO', false, 'eng');
  am.evaluateAnalog('LI-1', 10, 'GOOD', 0);
  assert.equal(am.list(0).length, 0);
  am.setLimit('TI-1.HI', 95, 'eng');
  assert.equal(am.defs.get('TI-1.HI').limit, 95);
  assert.ok(log.some((e) => e.category === 'ENGINEER' && /95/.test(e.message)));
});
