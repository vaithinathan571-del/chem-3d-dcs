import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SnapshotStore } from '../src/instructor/snapshots.js';
import { createFilePersistence } from '../src/instructor/fileSnapshotPersistence.js';

test('snapshots persist to disk and reload; built-ins are never written', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chem3d-snap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const a = new SnapshotStore({ persistence: createFilePersistence(dir) });
  a.save({ id: 'baseline', name: 'Base', data: { x: 0 }, builtin: true, simTime: 0 });
  const s = a.save({ name: 'Upset', data: { x: 1 }, user: 'inst', simTime: 42 });
  assert.match(s.id, /^snap-[0-9a-f]{10}$/);
  assert.deepEqual(fs.readdirSync(dir), [`${s.id}.json`]);

  const b = new SnapshotStore({ persistence: createFilePersistence(dir) });
  assert.deepEqual(b.get(s.id).data, { x: 1 });
  assert.equal(b.get('baseline'), null);

  assert.equal(b.delete(s.id), null);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('in-memory store enforces the snapshot limit and protects built-ins', () => {
  const store = new SnapshotStore({ max: 1 });
  store.save({ id: 'baseline', name: 'Base', data: {}, builtin: true });
  store.save({ name: 'one', data: {} });
  assert.throws(() => store.save({ name: 'two', data: {} }), /limit/);
  assert.match(store.delete('baseline'), /cannot be deleted/);
  assert.equal(store.list().length, 2);
});
