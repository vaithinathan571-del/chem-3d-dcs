/**
 * Snapshot (initial-condition) store. Snapshots capture the complete dynamic
 * state of the plant so an instructor can save and restore training
 * scenarios. The store is platform independent; durable storage is provided
 * by an optional persistence adapter ({load(), save(snap), remove(id)}), e.g.
 * `createFilePersistence` on the server.
 */

function randomId() {
  const bytes = new Uint8Array(5);
  globalThis.crypto.getRandomValues(bytes);
  return `snap-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export class SnapshotStore {
  constructor({ persistence = null, max = 50 } = {}) {
    this.persistence = persistence;
    this.max = max;
    this.items = new Map();
    for (const snap of persistence?.load() ?? []) this.items.set(snap.id, snap);
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
      id: id ?? randomId(),
      name: String(name || 'Snapshot').slice(0, 80),
      createdAt: Date.now(),
      createdBy: user ?? 'system',
      simTime,
      builtin,
      data,
    };
    this.items.set(snap.id, snap);
    if (!builtin) this.persistence?.save(snap);
    return snap;
  }

  delete(id) {
    const snap = this.items.get(id);
    if (!snap) return `Unknown snapshot ${id}`;
    if (snap.builtin) return 'Built-in snapshots cannot be deleted';
    this.items.delete(id);
    this.persistence?.remove(id);
    return null;
  }
}
