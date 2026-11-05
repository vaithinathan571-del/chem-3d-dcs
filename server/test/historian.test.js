import test from 'node:test';
import assert from 'node:assert/strict';
import { Historian } from '../src/historian/historian.js';
import { EventLog } from '../src/events/eventLog.js';

test('historian ring buffer wraps and keeps the newest samples', () => {
  const h = new Historian({ capacity: 10, interval: 1 });
  h.register('A');
  for (let i = 0; i < 25; i += 1) h.maybeRecord(i * 1000, () => i);
  assert.equal(h.count, 10);
  const q = h.query(['A'], -Infinity, Infinity, 100);
  assert.deepEqual(q.series.A, [15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  assert.equal(q.t[0], 15_000);
});

test('historian respects the sampling interval and decimates queries', () => {
  const h = new Historian({ capacity: 1000, interval: 1 });
  h.register('A');
  for (let i = 0; i < 2000; i += 1) h.maybeRecord(i * 250, () => i);
  assert.equal(h.count, 500);
  const q = h.query(['A', 'missing'], 0, Infinity, 50);
  assert.equal(q.t.length, 50);
  assert.equal(q.series.missing, undefined);
  const r = h.query(['A'], 100_000, 110_000, 1000);
  assert.equal(r.t[0], 100_000);
  assert.equal(r.t.at(-1), 110_000);
});

test('event log sequence and since()', () => {
  const log = new EventLog({ capacity: 3, clock: () => 0 });
  log.add({ message: 'a' });
  log.add({ message: 'b' });
  log.add({ message: 'c' });
  log.add({ message: 'd' });
  assert.equal(log.items.length, 3);
  assert.deepEqual(log.since(2).map((e) => e.message), ['c', 'd']);
  assert.deepEqual(log.since(4), []);
});
