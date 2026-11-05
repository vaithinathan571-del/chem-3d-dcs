/**
 * Snapshot (initial-condition) store. Snapshots capture the complete dynamic
 * state of the plant so an instructor can save and restore training
 * scenarios. They are kept in memory and, when a data directory is
 * configured, persisted as JSON files.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SAFE_ID = /^[a-z0-9-]{1,64}$/;

export class SnapshotStore {
  constructor({ dir = null, max = 50 } = {}) {
    this.dir = dir;
    this.max = max;
    this.items = new Map();
    if (dir) this.loadFromDisk();
  }

  loadFromDisk() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      for (const f of fs.readdirSync(this.dir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const snap = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
          if (snap?.id && SAFE_ID.test(snap.id) && snap.data) this.items.set(snap.id, snap);
        } catch {
          // ignore corrupt snapshot files
        }
      }
    } catch (err) {
      console.warn(`[snapshots] cannot use directory ${this.dir}: ${err.message}`);
      this.dir = null;
    }
  }

  list() {
    return [...this.items.values()]
      .map(({ id, name, createdAt, createdBy, simTime, builtin }) => ({ id, name, createdAt, createdBy, simTime, builtin: !!builtin }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id) {
    return this.items.get(id) ?? null;
  }

  save({ name, data, user, simTime, builtin = false, id }) {
    const userSnapshots = [...this.items.values()].filter((s) => !s.builtin);
    if (!builtin && userSnapshots.length >= this.max) throw new Error(`Snapshot limit (${this.max}) reached – delete one first`);
    const snap = {
      id: id ?? `snap-${crypto.randomBytes(5).toString('hex')}`,
      name: String(name || 'Snapshot').slice(0, 80),
      createdAt: Date.now(),
      createdBy: user ?? 'system',
      simTime,
      builtin,
      data,
    };
    this.items.set(snap.id, snap);
    if (this.dir && !builtin) {
      fs.writeFileSync(path.join(this.dir, `${snap.id}.json`), JSON.stringify(snap));
    }
    return snap;
  }

  delete(id) {
    const snap = this.items.get(id);
    if (!snap) return `Unknown snapshot ${id}`;
    if (snap.builtin) return 'Built-in snapshots cannot be deleted';
    this.items.delete(id);
    if (this.dir && SAFE_ID.test(id)) {
      try {
        fs.unlinkSync(path.join(this.dir, `${id}.json`));
      } catch {
        // already gone
      }
    }
    return null;
  }
}
