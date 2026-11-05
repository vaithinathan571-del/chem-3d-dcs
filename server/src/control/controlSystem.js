/**
 * Control-system executive: owns the PID blocks, resolves cascades and writes
 * controller outputs to the final control elements.
 */
import { PIDController } from './pid.js';

export class ControlSystem {
  /**
   * @param {object[]} configs controller configs merged with their PV point metadata
   * @param {Map<string, import('../plant/equipment.js').Valve>} valves
   */
  constructor(configs, valves) {
    this.valves = valves;
    this.loops = new Map();
    for (const cfg of configs) this.loops.set(cfg.tag, new PIDController(cfg));
    // Wire cascade masters to their slaves.
    for (const loop of this.loops.values()) {
      if (loop.output.cascade) {
        const slave = this.loops.get(loop.output.cascade);
        if (!slave) throw new Error(`Cascade slave ${loop.output.cascade} not found for ${loop.tag}`);
        slave.master = loop.tag;
      }
    }
    // Masters execute before slaves.
    this.order = [...this.loops.values()].sort((a, b) => depth(this.loops, b) - depth(this.loops, a));
  }

  get(tag) {
    return this.loops.get(tag);
  }

  /**
   * @param {number} dt
   * @param {(tag: string) => {value: number, quality: string}|null} readPv
   * @returns {string[]} messages for loops that shed mode this step
   */
  execute(dt, readPv) {
    const messages = [];
    for (const loop of this.order) {
      let slave = null;
      if (loop.output.cascade) {
        slave = this.loops.get(loop.output.cascade);
        loop.iman = slave.mode !== 'CAS';
        if (loop.iman) loop.trackCascade(slave.sp);
      }
      const pv = loop.manualOnly ? null : readPv(loop.tag);
      const msg = loop.execute(pv?.value ?? null, pv?.quality ?? 'GOOD', dt);
      if (msg) messages.push(msg);
      if (slave) {
        if (slave.mode === 'CAS') slave.rsp = loop.cascadeValue();
      } else if (loop.output.valve) {
        this.valves.get(loop.output.valve)?.setCommand(loop.op);
      }
    }
    return messages;
  }

  snapshot() {
    return Object.fromEntries([...this.loops].map(([tag, loop]) => [tag, loop.snapshot()]));
  }

  restore(snap) {
    for (const [tag, s] of Object.entries(snap)) this.loops.get(tag)?.restore(s);
  }
}

function depth(loops, loop) {
  let d = 0;
  let cur = loop;
  while (cur?.output?.cascade) {
    d += 1;
    cur = loops.get(cur.output.cascade);
  }
  return d;
}
