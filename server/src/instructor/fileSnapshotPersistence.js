/**
 * File-system persistence for the snapshot store (one JSON file per snapshot).
 */
import fs from 'node:fs';
import path from 'node:path';

const SAFE_ID = /^[a-z0-9-]{1,64}$/;

export function createFilePersistence(dir) {
  let usable = true;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.warn(`[snapshots] cannot use directory ${dir}: ${err.message} – snapshots will not be persisted`);
    usable = false;
  }
  const file = (id) => path.join(dir, `${id}.json`);
  return {
    load() {
      if (!usable) return [];
      const out = [];
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const snap = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          if (snap?.id && SAFE_ID.test(snap.id) && snap.data && !snap.builtin) out.push(snap);
        } catch {
          // ignore corrupt snapshot files
        }
      }
      return out;
    },
    save(snap) {
      if (!usable || !SAFE_ID.test(snap.id)) return;
      try {
        fs.writeFileSync(file(snap.id), JSON.stringify(snap));
      } catch (err) {
        console.warn(`[snapshots] could not write ${snap.id}: ${err.message}`);
      }
    },
    remove(id) {
      if (!usable || !SAFE_ID.test(id)) return;
      try {
        fs.unlinkSync(file(id));
      } catch {
        // already gone
      }
    },
  };
}
