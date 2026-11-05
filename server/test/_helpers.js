import { PlantRuntime } from '../src/runtime.js';

export const USERS = {
  viewer: { username: 'viewer', role: 'viewer' },
  operator: { username: 'op1', role: 'operator' },
  engineer: { username: 'eng1', role: 'engineer' },
  instructor: { username: 'inst1', role: 'instructor' },
};

let cachedBaseline = null;

/** A runtime settled at the normal operating point (prerun computed once per process). */
export function settledRuntime() {
  if (!cachedBaseline) {
    const rt = new PlantRuntime({ prerunSeconds: 4 * 3600, startEpoch: Date.UTC(2026, 0, 1) }).initialise();
    cachedBaseline = rt.captureState();
    return rt;
  }
  const rt = new PlantRuntime({ prerunSeconds: 0, startEpoch: Date.UTC(2026, 0, 1) });
  rt.restoreState(cachedBaseline);
  rt.snapshots.save({ id: 'baseline', name: 'baseline', data: cachedBaseline, builtin: true, simTime: 0 });
  return rt;
}
