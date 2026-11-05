/**
 * Field equipment models: control valves, motors (pumps / agitators) and
 * transmitters. These sit between the control system and the process model,
 * adding realistic actuator dynamics, sensor noise and failure modes.
 */
import { clamp, lagFactor } from '../util/math.js';

/** Inherent valve flow characteristic, x and result both 0…1. */
export function flowCharacteristic(x, type = 'linear', rangeability = 30) {
  const u = clamp(x, 0, 1);
  switch (type) {
    case 'equal-percentage':
      if (u <= 0) return 0;
      return (rangeability ** (u - 1) - 1 / rangeability) / (1 - 1 / rangeability);
    case 'quick-opening':
      return Math.sqrt(u);
    default:
      return u;
  }
}

export class Valve {
  constructor(cfg) {
    this.id = cfg.id;
    this.description = cfg.description;
    this.characteristic = cfg.characteristic ?? 'linear';
    this.rangeability = cfg.rangeability ?? 30;
    /** Time for a full 0→100 % stroke [s]. */
    this.strokeTime = cfg.strokeTime ?? 8;
    this.failPosition = cfg.failPosition ?? 0;
    this.command = cfg.initial ?? 0;
    this.position = this.command;
    /** Malfunction: valve stem seized, position frozen. */
    this.stuck = false;
    /** Safety-system overrides keyed by interlock id → forced position. */
    this.forces = new Map();
  }

  get forced() {
    if (this.forces.size === 0) return null;
    return [...this.forces.values()].at(-1);
  }

  setCommand(value) {
    this.command = clamp(Number(value) || 0, 0, 100);
  }

  update(dt) {
    if (this.stuck) return;
    const forced = this.forced;
    const target = forced ?? this.command;
    // Safety solenoids vent the actuator, so forced moves are fast.
    const rate = (100 / (forced !== null ? Math.min(this.strokeTime, 2) : this.strokeTime)) * dt;
    this.position += clamp(target - this.position, -rate, rate);
  }

  /** Fraction of maximum flow passed by the valve (0…1). */
  get fraction() {
    return flowCharacteristic(this.position / 100, this.characteristic, this.rangeability);
  }

  snapshot() {
    return { command: this.command, position: this.position, stuck: this.stuck, forces: [...this.forces] };
  }

  restore(s) {
    this.command = s.command;
    this.position = s.position;
    this.stuck = !!s.stuck;
    this.forces = new Map(s.forces ?? []);
  }
}

export class Motor {
  constructor(cfg) {
    this.id = cfg.id;
    this.description = cfg.description;
    this.kind = cfg.kind ?? 'pump';
    this.ratedCurrent = cfg.ratedCurrent ?? 50;
    this.ratedPower = cfg.ratedPower ?? 15;
    this.startTime = cfg.startTime ?? 3;
    this.stopTime = cfg.stopTime ?? 6;
    this.permissives = cfg.permissives ?? [];
    this.running = cfg.initial ?? true;
    this.speed = this.running ? 1 : 0;
    this.tripped = false;
    this.tripReason = null;
    /** Malfunction: motor/breaker failed and cannot be restarted. */
    this.failed = false;
    /** Interlocks currently inhibiting a start. */
    this.inhibits = new Set();
    this.load = 0;
  }

  /**
   * @param {(p: object) => boolean} checkPermissive evaluates a configured permissive
   * @returns {{ok: boolean, message?: string}}
   */
  start(checkPermissive = () => true) {
    if (this.failed) return { ok: false, message: `${this.id} motor fault – cannot start` };
    if (this.inhibits.size) return { ok: false, message: `${this.id} start inhibited by ${[...this.inhibits].join(', ')}` };
    const blocking = this.permissives.find((p) => !checkPermissive(p));
    if (blocking) return { ok: false, message: `${this.id} start permissive not met: ${blocking.description}` };
    this.tripped = false;
    this.tripReason = null;
    this.running = true;
    return { ok: true };
  }

  stop() {
    this.running = false;
    // Stopping a tripped motor acknowledges the trip at the MCC.
    this.tripped = false;
    this.tripReason = null;
    return { ok: true };
  }

  trip(reason) {
    if (!this.running && this.tripped) return;
    this.running = false;
    this.tripped = true;
    this.tripReason = reason;
  }

  update(dt) {
    const target = this.running ? 1 : 0;
    const rate = dt / (this.running ? this.startTime : this.stopTime);
    this.speed += clamp(target - this.speed, -rate, rate);
  }

  get status() {
    if (this.tripped) return 'TRIPPED';
    if (this.running) return this.speed >= 0.99 ? 'RUNNING' : 'STARTING';
    return this.speed > 0.01 ? 'STOPPING' : 'STOPPED';
  }

  /** Motor current [A]; `load` is set by the process model (0…1). */
  get current() {
    if (this.speed <= 0.01) return 0;
    return this.ratedCurrent * this.speed * (0.35 + 0.65 * clamp(this.load, 0, 1.2));
  }

  snapshot() {
    return {
      running: this.running,
      speed: this.speed,
      tripped: this.tripped,
      tripReason: this.tripReason,
      failed: this.failed,
      inhibits: [...this.inhibits],
    };
  }

  restore(s) {
    this.running = s.running;
    this.speed = s.speed;
    this.tripped = s.tripped;
    this.tripReason = s.tripReason;
    this.failed = !!s.failed;
    this.inhibits = new Set(s.inhibits ?? []);
  }
}

/** Fault modes a transmitter can be put into by the instructor. */
export const SENSOR_FAULTS = ['FAIL_LOW', 'FAIL_HIGH', 'FROZEN', 'DRIFT'];

export class Transmitter {
  constructor(cfg, rng) {
    this.tag = cfg.tag;
    this.lo = cfg.lo;
    this.hi = cfg.hi;
    this.noise = cfg.noise ?? 0.0006;
    this.lag = cfg.lag ?? 1;
    /** Low-flow cut-off: flow transmitters read zero below 1 % of span. */
    this.lowCut = cfg.lowCut ?? /^F/.test(cfg.tag);
    this.rng = rng;
    this.filtered = null;
    this.value = null;
    this.quality = 'GOOD';
    this.fault = null;
    this.driftRate = 0;
    this.driftOffset = 0;
    this.frozenValue = null;
  }

  get span() {
    return this.hi - this.lo;
  }

  setFault(mode, options = {}) {
    this.fault = mode;
    this.driftRate = options.rate ?? 0;
    this.driftOffset = 0;
    this.frozenValue = this.value;
  }

  clearFault() {
    this.fault = null;
    this.driftOffset = 0;
    this.driftRate = 0;
    this.frozenValue = null;
  }

  update(trueValue, dt) {
    if (!Number.isFinite(trueValue)) return;
    if (this.filtered === null) this.filtered = trueValue;
    this.filtered += (trueValue - this.filtered) * lagFactor(dt, this.lag);
    let v = this.filtered + this.noise * this.span * (this.rng ? this.rng.gauss() : 0);
    switch (this.fault) {
      case 'FAIL_LOW':
        v = this.lo - 0.0625 * this.span; // < 3.0 mA
        break;
      case 'FAIL_HIGH':
        v = this.hi + 0.0625 * this.span; // > 21 mA
        break;
      case 'FROZEN':
        v = this.frozenValue ?? v;
        break;
      case 'DRIFT':
        this.driftOffset += this.driftRate * dt;
        v += this.driftOffset;
        break;
      default:
        break;
    }
    if (this.lowCut && !this.fault && v < this.lo + 0.01 * this.span) v = this.lo;
    this.value = v;
    // NAMUR NE43: signals outside 3.8–20.5 mA are flagged as BAD.
    const margin = 0.025 * this.span;
    this.quality = v < this.lo - margin || v > this.hi + margin ? 'BAD' : 'GOOD';
  }

  snapshot() {
    return {
      filtered: this.filtered,
      value: this.value,
      quality: this.quality,
      fault: this.fault,
      driftRate: this.driftRate,
      driftOffset: this.driftOffset,
      frozenValue: this.frozenValue,
    };
  }

  restore(s) {
    Object.assign(this, s);
  }
}
