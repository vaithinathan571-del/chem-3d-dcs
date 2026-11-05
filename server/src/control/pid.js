/**
 * DCS-style PID function block.
 *
 * - Velocity (incremental) algorithm: bumpless mode transfers and inherent
 *   anti-windup at the output limits.
 * - Proportional and integral act on error, derivative acts on PV only
 *   (no derivative kick on setpoint changes).
 * - Error is normalised to the PV span, so Kc is dimensionless (% / %).
 * - Modes: MAN, AUTO, CAS (remote setpoint from a cascade master).
 * - Setpoint tracks PV in MAN (configurable) for bumpless return to AUTO.
 * - IMAN: a cascade master whose slave is not in CAS tracks the slave
 *   setpoint so the cascade can be closed without a bump.
 * - Mode shedding to MAN on BAD PV.
 */
import { clamp } from '../util/math.js';

export const MODES = ['MAN', 'AUTO', 'CAS'];

export class PIDController {
  constructor(cfg) {
    this.tag = cfg.tag;
    this.description = cfg.description ?? '';
    this.units = cfg.units ?? '';
    this.lo = cfg.lo ?? 0;
    this.hi = cfg.hi ?? 100;
    this.action = cfg.action ?? 'reverse';
    this.kc = cfg.kc ?? 1;
    this.ti = cfg.ti ?? 60;
    this.td = cfg.td ?? 0;
    this.scan = cfg.scan ?? 0.5;
    this.opLo = cfg.opLo ?? 0;
    this.opHi = cfg.opHi ?? 100;
    this.spLo = cfg.spLo ?? this.lo;
    this.spHi = cfg.spHi ?? this.hi;
    this.pvTrack = cfg.pvTrack ?? true;
    this.manualOnly = !!cfg.manualOnly;
    this.output = cfg.output ?? {};
    /** Tag of the cascade master writing this loop's remote setpoint. */
    this.master = cfg.master ?? null;
    this.mode = cfg.mode ?? 'AUTO';
    this.sp = cfg.sp ?? this.lo;
    this.op = cfg.op ?? 0;
    this.pv = null;
    this.quality = 'GOOD';
    /** Remote setpoint from cascade master. */
    this.rsp = null;
    this.iman = false;
    /** Interlock ids currently forcing this loop. */
    this.interlocks = new Set();
    this.shedReason = null;
    this.timer = 0;
    this.initialised = false;
    this.e1 = 0;
    this.pv1 = 0;
    this.d1 = 0;
  }

  get interlocked() {
    return this.interlocks.size > 0;
  }

  get availableModes() {
    if (this.manualOnly) return ['MAN'];
    return this.master ? ['MAN', 'AUTO', 'CAS'] : ['MAN', 'AUTO'];
  }

  /** Change mode; returns an error message or null. */
  setMode(mode) {
    if (!MODES.includes(mode)) return `Invalid mode ${mode}`;
    if (!this.availableModes.includes(mode)) return `${this.tag} does not support ${mode}`;
    if (this.interlocked) return `${this.tag} is interlocked by ${[...this.interlocks].join(', ')}`;
    if (mode !== 'MAN' && this.quality === 'BAD') return `${this.tag} PV is BAD – loop must stay in MAN`;
    if (mode !== this.mode) {
      this.mode = mode;
      this.initialised = false;
      this.shedReason = null;
    }
    return null;
  }

  setSetpoint(value) {
    if (this.manualOnly) return `${this.tag} has no setpoint`;
    if (this.mode === 'CAS') return `${this.tag} is in CAS – setpoint is written by ${this.master}`;
    const v = Number(value);
    if (!Number.isFinite(v)) return 'Setpoint must be a number';
    this.sp = clamp(v, this.spLo, this.spHi);
    return null;
  }

  setOutput(value) {
    if (this.mode !== 'MAN') return `${this.tag} must be in MAN to set the output`;
    if (this.interlocked) return `${this.tag} is interlocked by ${[...this.interlocks].join(', ')}`;
    const v = Number(value);
    if (!Number.isFinite(v)) return 'Output must be a number';
    this.op = clamp(v, this.opLo, this.opHi);
    return null;
  }

  setTuning({ kc, ti, td }) {
    const nums = { kc, ti, td };
    for (const [k, v] of Object.entries(nums)) {
      if (v === undefined) continue;
      if (!Number.isFinite(Number(v)) || Number(v) < 0) return `Invalid ${k}`;
    }
    if (kc !== undefined) this.kc = Number(kc);
    if (ti !== undefined) this.ti = Number(ti);
    if (td !== undefined) this.td = Number(td);
    return null;
  }

  /** Force the loop to MAN at a safe output (called by the SIS). */
  force(interlockId, op) {
    this.interlocks.add(interlockId);
    this.mode = 'MAN';
    this.op = clamp(op, this.opLo, this.opHi);
    this.initialised = false;
  }

  release(interlockId) {
    this.interlocks.delete(interlockId);
  }

  /**
   * Execute the block. Called every simulation step; the algorithm itself
   * only runs at the configured scan rate.
   * @returns {string|null} a mode-shed message when the loop shed to MAN
   */
  execute(pv, quality, dt) {
    this.pv = pv;
    this.quality = quality;
    this.timer += dt;
    if (this.timer + 1e-9 < this.scan) return null;
    const h = this.timer;
    this.timer = 0;
    if (this.manualOnly || pv === null || pv === undefined) return null;

    let shed = null;
    if (quality === 'BAD' && this.mode !== 'MAN') {
      shed = `${this.tag} shed to MAN – BAD PV`;
      this.mode = 'MAN';
      this.shedReason = 'BAD PV';
    }
    if (this.mode === 'CAS' && this.rsp !== null) this.sp = clamp(this.rsp, this.spLo, this.spHi);

    if (this.mode === 'MAN' || this.iman) {
      if (this.mode === 'MAN' && this.pvTrack && quality === 'GOOD') this.sp = clamp(pv, this.spLo, this.spHi);
      this.initialised = false;
      return shed;
    }

    const span = this.hi - this.lo || 1;
    const sign = this.action === 'direct' ? 1 : -1;
    const e = (sign * (pv - this.sp) * 100) / span;
    const pvn = (sign * pv * 100) / span;
    if (!this.initialised) {
      this.e1 = e;
      this.pv1 = pvn;
      this.d1 = 0;
      this.initialised = true;
    }
    const dP = e - this.e1;
    const dI = this.ti > 0 ? (h / this.ti) * e : 0;
    // Derivative on PV with a first-order filter (Tf = Td / 8), velocity form.
    let dD = 0;
    if (this.td > 0) {
      const tf = this.td / 8;
      const d = (tf * this.d1 + this.td * (pvn - this.pv1)) / (tf + h);
      dD = d - this.d1;
      this.d1 = d;
    } else {
      this.d1 = 0;
    }
    this.op = clamp(this.op + this.kc * (dP + dI + dD), this.opLo, this.opHi);
    this.e1 = e;
    this.pv1 = pvn;
    return shed;
  }

  /** Value written to the cascade slave's remote setpoint (engineering units). */
  cascadeValue() {
    const { lo, hi } = this.output;
    return lo + (this.op / 100) * (hi - lo);
  }

  /** Inverse of cascadeValue, used for IMAN output tracking. */
  trackCascade(slaveSp) {
    const { lo, hi } = this.output;
    this.op = clamp(((slaveSp - lo) / (hi - lo)) * 100, this.opLo, this.opHi);
  }

  state() {
    return {
      pv: this.pv,
      q: this.quality,
      sp: this.sp,
      op: this.op,
      mode: this.mode,
      iman: this.iman,
      il: this.interlocked ? [...this.interlocks] : undefined,
      shed: this.shedReason ?? undefined,
    };
  }

  tuning() {
    return { kc: this.kc, ti: this.ti, td: this.td };
  }

  snapshot() {
    return {
      mode: this.mode,
      sp: this.sp,
      op: this.op,
      kc: this.kc,
      ti: this.ti,
      td: this.td,
      iman: this.iman,
      interlocks: [...this.interlocks],
      shedReason: this.shedReason,
    };
  }

  restore(s) {
    this.mode = s.mode;
    this.sp = s.sp;
    this.op = s.op;
    this.kc = s.kc;
    this.ti = s.ti;
    this.td = s.td;
    this.iman = s.iman;
    this.interlocks = new Set(s.interlocks ?? []);
    this.shedReason = s.shedReason ?? null;
    this.initialised = false;
    this.timer = 0;
  }
}
