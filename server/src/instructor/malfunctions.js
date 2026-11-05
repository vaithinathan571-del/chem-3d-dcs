/**
 * Instructor malfunction manager. Malfunctions either modify utility /
 * boundary conditions (combined each step) or put equipment into a failure
 * state while active.
 */
import { BASE_UTILITIES } from '../plant/process.js';

export class MalfunctionManager {
  /**
   * @param {object[]} defs
   * @param {{motors: Map, valves: Map, transmitters: Map}} plant
   */
  constructor(defs, plant) {
    this.defs = new Map(defs.map((d) => [d.id, d]));
    this.plant = plant;
    this.active = new Map(); // id → activation time
  }

  isActive(id) {
    return this.active.has(id);
  }

  activate(id, now) {
    const d = this.defs.get(id);
    if (!d) return `Unknown malfunction ${id}`;
    if (this.active.has(id)) return `${id} already active`;
    this.active.set(id, now);
    this.apply(d.effect, true);
    return null;
  }

  clear(id) {
    const d = this.defs.get(id);
    if (!d) return `Unknown malfunction ${id}`;
    if (!this.active.has(id)) return `${id} is not active`;
    this.active.delete(id);
    this.apply(d.effect, false);
    return null;
  }

  clearAll() {
    for (const id of [...this.active.keys()]) this.clear(id);
  }

  apply(effect, on) {
    const { motors, valves, transmitters } = this.plant;
    if (effect.failMotor) {
      const m = motors.get(effect.failMotor);
      if (m) {
        m.failed = on;
        if (on) m.trip('Motor fault (overload / seal failure)');
      }
    }
    if (effect.stuckValve) {
      const v = valves.get(effect.stuckValve);
      if (v) v.stuck = on;
    }
    if (effect.sensorFault) {
      const t = transmitters.get(effect.sensorFault.tag);
      if (t) {
        if (on) t.setFault(effect.sensorFault.mode, effect.sensorFault);
        else t.clearFault();
      }
    }
  }

  /** Current utility / boundary conditions with active malfunctions applied. */
  utilities() {
    const u = { ...BASE_UTILITIES };
    for (const id of this.active.keys()) {
      const e = this.defs.get(id).effect;
      for (const key of Object.keys(BASE_UTILITIES)) {
        if (e[key] === undefined) continue;
        // Multiplicative factors combine; absolute conditions take the worst case.
        if (['cwAvail', 'feedAvail', 'e101Eff', 'jacketUA', 'condUA', 'rateFactor'].includes(key)) u[key] *= e[key];
        else if (key === 'cwTemp') u[key] = Math.max(u[key], e[key]);
        else if (key === 'steamPressure' || key === 'feedXA') u[key] = Math.min(u[key], e[key]);
        else u[key] = e[key];
      }
    }
    return u;
  }

  status() {
    return [...this.active].map(([id, since]) => ({ id, since }));
  }

  snapshot() {
    return [...this.active];
  }

  restore(snap) {
    this.active = new Map(snap ?? []);
  }
}
