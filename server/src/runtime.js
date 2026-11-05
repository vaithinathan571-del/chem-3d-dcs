/**
 * Plant runtime – the "controller" of the DCS. Owns the process model, field
 * equipment, control system, SIS, alarm system, historian and event journal,
 * runs the real-time simulation loop and executes operator commands.
 */
import { createRng, round } from './util/math.js';
import { ProcessModel } from './plant/process.js';
import { Valve, Motor, Transmitter } from './plant/equipment.js';
import {
  PLANT, PRIORITIES, ANALOG_POINTS, CONTROLLERS, VALVES, MOTORS, INTERLOCKS, MALFUNCTIONS, EQUIPMENT,
} from './plant/plantConfig.js';
import { ControlSystem } from './control/controlSystem.js';
import { InterlockSystem } from './safety/interlocks.js';
import { AlarmManager } from './alarms/alarmManager.js';
import { EventLog } from './events/eventLog.js';
import { Historian } from './historian/historian.js';
import { MalfunctionManager } from './instructor/malfunctions.js';
import { SnapshotStore } from './instructor/snapshots.js';
import { AuthService, ROLE_PERMISSIONS } from './auth/auth.js';

export const SIM_SPEEDS = [0.5, 1, 2, 5, 10, 20, 50];
const BASE_DT = 0.1;
const BASELINE_ID = 'baseline';

/** Command → required permission. */
export const COMMANDS = {
  setSP: 'operate',
  setOP: 'operate',
  setMode: 'operate',
  motorStart: 'operate',
  motorStop: 'operate',
  ackAlarm: 'ack',
  ackAll: 'ack',
  shelveAlarm: 'shelve',
  unshelveAlarm: 'shelve',
  ilReset: 'ilReset',
  esd: 'esd',
  setTuning: 'tune',
  setAlarmLimit: 'alarmConfig',
  enableAlarm: 'alarmConfig',
  ilBypass: 'ilBypass',
  simRun: 'sim',
  simFreeze: 'sim',
  simSpeed: 'sim',
  malfunction: 'malfunction',
  snapshotSave: 'snapshot',
  snapshotLoad: 'snapshot',
  snapshotDelete: 'snapshot',
};

const fmt = (v, d = 2) => (Number.isFinite(v) ? Number(v).toFixed(d) : String(v));

export class PlantRuntime {
  /**
   * @param {{seed?: number, snapshotDir?: string|null, historianHours?: number,
   *          prerunSeconds?: number, startEpoch?: number}} opts
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.rng = createRng(opts.seed ?? 20240611);
    this.simTime = 0;
    this.speed = 1;
    this.frozen = false;
    this.epoch0 = opts.startEpoch ?? Math.floor(Date.now() / 1000) * 1000;
    this.alarmTimer = 0;
    this.timer = null;
    this.recording = true;

    this.points = new Map(ANALOG_POINTS.map((p) => [p.tag, p]));
    this.process = new ProcessModel();
    this.valves = new Map(VALVES.map((v) => [v.id, new Valve(v)]));
    this.motors = new Map(MOTORS.map((m) => [m.id, new Motor(m)]));
    this.transmitters = new Map(ANALOG_POINTS.map((p) => [p.tag, new Transmitter(p, this.rng)]));

    const loopConfigs = CONTROLLERS.map((c) => {
      const p = this.points.get(c.tag) ?? {};
      return { description: p.description, units: p.units, lo: p.lo, hi: p.hi, ...c };
    });
    // Initial valve commands from the controller initial outputs.
    for (const c of loopConfigs) {
      if (c.output?.valve) {
        const v = this.valves.get(c.output.valve);
        v.command = c.op;
        v.position = c.op;
      }
    }
    this.control = new ControlSystem(loopConfigs, this.valves);

    this.events = new EventLog({ clock: () => this.now });
    const log = (e) => this.events.add(e);
    this.alarms = new AlarmManager(log);
    this.sis = new InterlockSystem(INTERLOCKS, { motors: this.motors, valves: this.valves, control: this.control }, log);
    this.malfunctions = new MalfunctionManager(MALFUNCTIONS, { motors: this.motors, valves: this.valves, transmitters: this.transmitters });
    this.historian = new Historian({ capacity: Math.round((opts.historianHours ?? 4) * 3600), interval: 1 });
    this.snapshots = new SnapshotStore({ dir: opts.snapshotDir ?? null });

    this.defineAlarms();
    for (const p of ANALOG_POINTS) this.historian.register(`${p.tag}.PV`);
    for (const loop of this.control.loops.values()) {
      if (!loop.manualOnly) this.historian.register(`${loop.tag}.SP`);
      this.historian.register(`${loop.tag}.OP`);
    }
    this.utilities = this.malfunctions.utilities();
    this.truth = this.process.measurements(this.utilities);
  }

  get now() {
    return this.epoch0 + this.simTime * 1000;
  }

  // ------------------------------------------------------------------ alarms
  defineAlarms() {
    const a = this.alarms;
    for (const p of ANALOG_POINTS) {
      const span = p.hi - p.lo;
      for (const [type, [limit, priority]] of Object.entries(p.alarms ?? {})) {
        a.define({
          id: `${p.tag}.${type}`, tag: p.tag, type, priority, limit, units: p.units, decimals: p.decimals,
          deadband: 0.01 * span, delay: type.length === 4 ? 1 : 3,
          message: `${p.description} ${type === 'HIHI' ? 'high-high' : type === 'LOLO' ? 'low-low' : type === 'HI' ? 'high' : 'low'}`,
        });
      }
      a.define({ id: `${p.tag}.BAD`, tag: p.tag, type: 'BAD', priority: 'HIGH', message: `${p.description} – transmitter failure (BAD PV)`, delay: 1 });
    }
    for (const c of CONTROLLERS) {
      if (!c.dev) continue;
      const p = this.points.get(c.tag);
      a.define({
        id: `${c.tag}.DEV`, tag: c.tag, type: 'DEV', priority: c.dev[1], limit: c.dev[0], units: p.units, decimals: p.decimals,
        delay: 30, message: `${p.description} deviation from setpoint`,
      });
    }
    for (const m of MOTORS) a.define({ id: `${m.id}.TRIP`, tag: m.id, type: 'TRIP', priority: 'HIGH', message: `${m.description} tripped` });
    for (const il of INTERLOCKS) {
      a.define({ id: `${il.id}.TRIP`, tag: il.id, type: 'TRIP', priority: 'CRITICAL', message: `SIS ${il.description} – TRIPPED` });
      if (!il.manual) {
        a.define({ id: `${il.id}.BYP`, tag: il.id, type: 'BYP', priority: 'LOW', message: `SIS ${il.description} – BYPASSED` });
        a.define({
          id: `${il.sensor}.DISC`, tag: il.sensor, type: 'DISC', priority: 'MEDIUM', delay: 15,
          message: `${il.sensor} / ${il.sensorTag} transmitter discrepancy (DCS vs SIS)`,
        });
      }
    }
    a.define({ id: 'PSV-106.LIFT', tag: 'R-101', type: 'PSV', priority: 'CRITICAL', message: 'R-101 relief valve PSV-106 lifting to flare' });
    a.define({ id: 'PSV-111.LIFT', tag: 'C-101', type: 'PSV', priority: 'CRITICAL', message: 'C-101 relief valve PSV-111 lifting to flare' });
    a.define({ id: 'M-101.STOP', tag: 'M-101', type: 'STATE', priority: 'HIGH', delay: 5, message: 'Reactor agitator not running with reactor in service' });
    const vessels = { t101Overflow: 'T-101', r101Overflow: 'R-101', d101Overflow: 'D-101', sumpFlooded: 'C-101', t102Overflow: 'T-102' };
    this.overflowAlarms = vessels;
    for (const [flag, id] of Object.entries(vessels)) {
      a.define({ id: `${id}.OVFL`, tag: id, type: 'OVFL', priority: 'HIGH', message: `${id} overfilled / flooded` });
    }
  }

  evaluateAlarms() {
    const now = this.now;
    const a = this.alarms;
    for (const [tag, t] of this.transmitters) {
      a.evaluateAnalog(tag, t.value, t.quality, now);
      a.set(`${tag}.BAD`, t.quality === 'BAD', t.value, now);
    }
    for (const loop of this.control.loops.values()) {
      if (!a.defs.has(`${loop.tag}.DEV`)) continue;
      const deviating = (loop.mode === 'AUTO' || loop.mode === 'CAS') && !loop.iman && loop.quality === 'GOOD'
        && Math.abs(loop.pv - loop.sp) > a.defs.get(`${loop.tag}.DEV`).limit;
      a.set(`${loop.tag}.DEV`, deviating, loop.pv, now);
    }
    for (const m of this.motors.values()) a.set(`${m.id}.TRIP`, m.tripped, undefined, now);
    for (const il of this.sis.items.values()) {
      a.set(`${il.id}.TRIP`, il.tripped, undefined, now);
      if (!il.manual) {
        a.set(`${il.id}.BYP`, il.bypassed, undefined, now);
        const t = this.transmitters.get(il.sensor);
        const span = t.hi - t.lo;
        const disc = t.quality === 'GOOD' && Math.abs(t.value - this.truth[il.sensor]) > 0.03 * span;
        a.set(`${il.sensor}.DISC`, disc, t.value, now);
      }
    }
    const s = this.process.s;
    a.set('PSV-106.LIFT', s.r101.psvOpen, undefined, now);
    a.set('PSV-111.LIFT', s.col.psvOpen, undefined, now);
    a.set('M-101.STOP', this.motors.get('M-101').speed < 0.5 && this.truth['LIC-103'] > 20, undefined, now);
    for (const [flag, id] of Object.entries(this.overflowAlarms)) a.set(`${id}.OVFL`, !!this.process.flags[flag], undefined, now);
    a.housekeeping(now);
  }

  // ---------------------------------------------------------------- dynamics
  readPoint(tag) {
    const t = this.transmitters.get(tag);
    return t ? { value: t.value, quality: t.quality } : null;
  }

  checkPermissive(p) {
    const v = this.transmitters.get(p.point)?.value;
    if (!Number.isFinite(v)) return false;
    return p.op === '>' ? v > p.value : p.op === '<' ? v < p.value : p.op === '>=' ? v >= p.value : v <= p.value;
  }

  step(dt) {
    const u = this.malfunctions.utilities();
    this.utilities = u;
    this.process.step(dt, {
      valve: (id) => this.valves.get(id).fraction,
      motor: (id) => this.motors.get(id).speed,
      setMotorLoad: (id, load) => {
        this.motors.get(id).load = load;
      },
      utilities: u,
    });
    this.truth = this.process.measurements(u);
    for (const [tag, t] of this.transmitters) t.update(this.truth[tag], dt);

    // Safety system acts on independent sensors, before the BPCS.
    this.sis.evaluate(this.truth, this.now);

    const shed = this.control.execute(dt, (tag) => this.readPoint(tag));
    for (const msg of shed) this.events.add({ category: 'SYSTEM', priority: 'MEDIUM', message: msg });

    for (const v of this.valves.values()) v.update(dt);
    for (const m of this.motors.values()) m.update(dt);

    this.simTime += dt;
    this.alarmTimer += dt;
    if (this.alarmTimer >= 0.5) {
      this.alarmTimer = 0;
      if (this.recording) this.evaluateAlarms();
    }
    if (this.recording) this.historian.maybeRecord(this.now, (id) => this.seriesValue(id));
  }

  seriesValue(id) {
    const dot = id.lastIndexOf('.');
    const tag = id.slice(0, dot);
    const field = id.slice(dot + 1);
    if (field === 'PV') return this.transmitters.get(tag)?.value;
    const loop = this.control.get(tag);
    if (!loop) return NaN;
    return field === 'SP' ? loop.sp : loop.op;
  }

  /** Advance the simulation by `seconds` of simulated time. */
  advance(seconds, dt = BASE_DT) {
    const n = Math.max(1, Math.ceil(seconds / dt - 1e-9));
    const h = seconds / n;
    for (let i = 0; i < n; i += 1) this.step(h);
  }

  /** Run the plant without recording to settle at steady state. */
  prerun(seconds, dt = 0.25) {
    this.recording = false;
    this.advance(seconds, dt);
    this.recording = true;
    this.simTime = 0;
    this.alarms.resetAll();
    this.events.clear();
    this.historian.clear();
    this.process.totals = { productTonnes: 0, steamTonnes: 0 };
  }

  /** Bring the plant to its operating point and record the baseline snapshot. */
  initialise() {
    this.prerun(this.opts.prerunSeconds ?? 4 * 3600);
    this.snapshots.save({ id: BASELINE_ID, name: 'Normal operation (steady state)', data: this.captureState(), user: 'system', simTime: 0, builtin: true });
    this.events.add({ category: 'SYSTEM', message: `${PLANT.name} – DCS started, plant at normal operation` });
    return this;
  }

  /** Start the real-time loop. */
  start(tickMs = 100) {
    if (this.timer) return;
    let last = performance.now();
    this.timer = setInterval(() => {
      const nowMs = performance.now();
      const wall = Math.min((nowMs - last) / 1000, 0.5);
      last = nowMs;
      if (this.frozen) return;
      try {
        this.advance(wall * this.speed);
      } catch (err) {
        console.error('[runtime] simulation step failed', err);
        this.frozen = true;
        this.events.add({ category: 'SYSTEM', priority: 'CRITICAL', message: `Simulation frozen after an internal error: ${err.message}` });
      }
    }, tickMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  // --------------------------------------------------------------- snapshots
  captureState() {
    const mapSnap = (m) => Object.fromEntries([...m].map(([k, v]) => [k, v.snapshot()]));
    return {
      process: this.process.snapshot(),
      valves: mapSnap(this.valves),
      motors: mapSnap(this.motors),
      transmitters: mapSnap(this.transmitters),
      control: this.control.snapshot(),
      sis: this.sis.snapshot(),
      malfunctions: this.malfunctions.snapshot(),
      alarmConfig: this.alarms.snapshotConfig(),
      rng: this.rng.getState(),
    };
  }

  restoreState(data) {
    const data2 = structuredClone(data);
    this.process.restore(data2.process);
    for (const [k, s] of Object.entries(data2.valves)) this.valves.get(k)?.restore(s);
    for (const [k, s] of Object.entries(data2.motors)) this.motors.get(k)?.restore(s);
    for (const [k, s] of Object.entries(data2.transmitters)) this.transmitters.get(k)?.restore(s);
    this.control.restore(data2.control);
    this.sis.restore(data2.sis);
    this.malfunctions.restore(data2.malfunctions);
    this.alarms.restoreConfig(data2.alarmConfig);
    this.alarms.resetAll();
    this.rng.setState(data2.rng);
    this.utilities = this.malfunctions.utilities();
    this.truth = this.process.measurements(this.utilities);
  }

  // ---------------------------------------------------------------- commands
  /**
   * Execute an operator / engineer / instructor command.
   * @returns {{ok: boolean, message?: string, data?: any}}
   */
  executeCommand(user, action, params = {}) {
    const perm = COMMANDS[action];
    if (!perm) return { ok: false, message: `Unknown command "${action}"` };
    if (!AuthService.can(user, perm)) return { ok: false, message: `Permission denied – role "${user?.role ?? 'none'}" cannot ${action}` };
    try {
      const result = this.dispatch(user, action, params ?? {});
      if (typeof result === 'string') return { ok: false, message: result };
      return { ok: true, ...(result ?? {}) };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  dispatch(user, action, p) {
    const who = user.username;
    const log = (category, message, tag) => this.events.add({ category, user: who, tag, message });
    const loop = () => {
      const l = this.control.get(p.tag);
      if (!l) throw new Error(`Unknown loop ${p.tag}`);
      return l;
    };
    const motor = () => {
      const m = this.motors.get(p.id);
      if (!m) throw new Error(`Unknown motor ${p.id}`);
      return m;
    };
    const now = this.now;

    switch (action) {
      case 'setSP': {
        const l = loop();
        const old = l.sp;
        const err = l.setSetpoint(p.value);
        if (err) return err;
        log('OPERATOR', `${l.tag} SP ${fmt(old)} → ${fmt(l.sp)} ${l.units}`, l.tag);
        return null;
      }
      case 'setOP': {
        const l = loop();
        const old = l.op;
        const err = l.setOutput(p.value);
        if (err) return err;
        log('OPERATOR', `${l.tag} OP ${fmt(old, 1)} → ${fmt(l.op, 1)} %`, l.tag);
        return null;
      }
      case 'setMode': {
        const l = loop();
        const old = l.mode;
        const err = l.setMode(String(p.mode));
        if (err) return err;
        if (old !== l.mode) log('OPERATOR', `${l.tag} mode ${old} → ${l.mode}`, l.tag);
        return null;
      }
      case 'setTuning': {
        const l = loop();
        const old = l.tuning();
        const err = l.setTuning(p);
        if (err) return err;
        const t = l.tuning();
        log('ENGINEER', `${l.tag} tuning Kc ${old.kc}→${t.kc}, Ti ${old.ti}→${t.ti} s, Td ${old.td}→${t.td} s`, l.tag);
        return null;
      }
      case 'motorStart': {
        const m = motor();
        const r = m.start((perm) => this.checkPermissive(perm));
        if (!r.ok) return r.message;
        log('OPERATOR', `${m.id} START command`, m.id);
        return null;
      }
      case 'motorStop': {
        const m = motor();
        m.stop();
        log('OPERATOR', `${m.id} STOP command`, m.id);
        return null;
      }
      case 'ackAlarm':
        return this.alarms.ack(String(p.id), who);
      case 'ackAll':
        return this.alarms.ackAll(who, now);
      case 'shelveAlarm':
        return this.alarms.shelve(String(p.id), p.minutes ?? 30, who, now);
      case 'unshelveAlarm':
        return this.alarms.unshelve(String(p.id), who);
      case 'setAlarmLimit':
        return this.alarms.setLimit(String(p.id), p.limit, who);
      case 'enableAlarm':
        return this.alarms.setEnabled(String(p.id), p.enabled, who);
      case 'ilReset':
        return this.sis.reset(String(p.id), who);
      case 'ilBypass':
        return this.sis.bypass(String(p.id), who, !!p.bypass);
      case 'esd':
        return this.sis.manualTrip(String(p.id ?? 'ESD-1'), who, now);
      case 'simRun':
        this.frozen = false;
        log('INSTRUCTOR', 'Simulation RUN');
        return null;
      case 'simFreeze':
        this.frozen = true;
        log('INSTRUCTOR', 'Simulation FROZEN');
        return null;
      case 'simSpeed': {
        const s = Number(p.speed);
        if (!SIM_SPEEDS.includes(s)) return `Speed must be one of ${SIM_SPEEDS.join(', ')}`;
        this.speed = s;
        log('INSTRUCTOR', `Simulation speed set to ${s}×`);
        return null;
      }
      case 'malfunction': {
        const id = String(p.id);
        const def = MALFUNCTIONS.find((m) => m.id === id);
        const err = p.active ? this.malfunctions.activate(id, now) : this.malfunctions.clear(id);
        if (err) return err;
        log('INSTRUCTOR', `Malfunction ${id} (${def.name}) ${p.active ? 'ACTIVATED' : 'cleared'}`);
        return null;
      }
      case 'snapshotSave': {
        const snap = this.snapshots.save({ name: p.name, data: this.captureState(), user: who, simTime: this.simTime });
        log('INSTRUCTOR', `Snapshot "${snap.name}" saved`);
        return { data: { id: snap.id } };
      }
      case 'snapshotLoad': {
        const snap = this.snapshots.get(String(p.id));
        if (!snap) return `Unknown snapshot ${p.id}`;
        this.restoreState(snap.data);
        log('INSTRUCTOR', `Snapshot "${snap.name}" loaded – plant state restored`);
        return null;
      }
      case 'snapshotDelete': {
        const snap = this.snapshots.get(String(p.id));
        const err = this.snapshots.delete(String(p.id));
        if (err) return err;
        log('INSTRUCTOR', `Snapshot "${snap.name}" deleted`);
        return null;
      }
      default:
        return `Unhandled command ${action}`;
    }
  }

  // --------------------------------------------------------------- payloads
  /** Static configuration for clients. */
  configPayload() {
    return {
      plant: PLANT,
      priorities: PRIORITIES,
      points: ANALOG_POINTS.map(({ tag, description, units, lo, hi, equipment, decimals }) => ({
        tag, description, units, lo, hi, equipment, decimals: decimals ?? 2, isLoop: this.control.loops.has(tag),
      })),
      controllers: [...this.control.loops.values()].map((l) => ({
        tag: l.tag,
        description: l.description,
        units: l.units,
        lo: l.lo,
        hi: l.hi,
        action: l.action,
        modes: l.availableModes,
        output: l.output,
        master: l.master,
        manualOnly: l.manualOnly,
      })),
      valves: VALVES,
      motors: MOTORS,
      interlocks: INTERLOCKS.map((il) => ({ ...il })),
      malfunctions: MALFUNCTIONS,
      equipment: EQUIPMENT,
      alarms: this.alarms.config(),
      roles: ROLE_PERMISSIONS,
      commands: COMMANDS,
      simSpeeds: SIM_SPEEDS,
      historian: { series: this.historian.ids, hours: this.historian.capacity / 3600 },
    };
  }

  /** Dynamic state broadcast to clients. */
  liveState() {
    const now = this.now;
    const points = {};
    const bad = [];
    for (const [tag, t] of this.transmitters) {
      points[tag] = round(t.value, 4);
      if (t.quality === 'BAD') bad.push(tag);
    }
    const loops = {};
    for (const l of this.control.loops.values()) {
      loops[l.tag] = {
        sp: l.manualOnly ? null : round(l.sp, 4),
        op: round(l.op, 2),
        mode: l.mode,
        ...(l.iman ? { iman: true } : {}),
        ...(l.interlocked ? { il: [...l.interlocks] } : {}),
        ...(l.shedReason ? { shed: l.shedReason } : {}),
        kc: l.kc,
        ti: l.ti,
        td: l.td,
      };
    }
    const valves = {};
    for (const v of this.valves.values()) {
      valves[v.id] = { pos: round(v.position, 1), cmd: round(v.command, 1), ...(v.stuck ? { stuck: true } : {}), ...(v.forced !== null ? { forced: v.forced } : {}) };
    }
    const motors = {};
    for (const m of this.motors.values()) {
      motors[m.id] = {
        status: m.status,
        speed: round(m.speed, 3),
        current: round(m.current, 1),
        ...(m.inhibits.size ? { inhibit: [...m.inhibits] } : {}),
        ...(m.failed ? { failed: true } : {}),
        ...(m.tripReason ? { tripReason: m.tripReason } : {}),
        permissives: m.permissives.map((p) => this.checkPermissive(p)),
      };
    }
    const flows = Object.fromEntries(Object.entries(this.process.flows).map(([k, v]) => [k, round(v, 3)]));
    const kpis = Object.fromEntries(Object.entries(this.process.kpis()).map(([k, v]) => [k, v === null ? null : round(v, 3)]));
    const visual = this.process.visual();
    for (const v of Object.values(visual)) for (const k of Object.keys(v)) if (typeof v[k] === 'number') v[k] = round(v[k], 4);
    return {
      t: now,
      simTime: round(this.simTime, 1),
      speed: this.speed,
      frozen: this.frozen,
      points,
      bad,
      loops,
      valves,
      motors,
      sis: this.sis.status().map((s) => ({ ...s, value: round(s.value, 3) })),
      alarms: this.alarms.list(now),
      alarmSummary: this.alarms.summary(now),
      malfunctions: this.malfunctions.status(),
      flows,
      kpis,
      visual,
      utilities: { cwTemp: this.utilities.cwTemp, steamPressure: this.utilities.steamPressure, cwAvail: this.utilities.cwAvail },
      eventSeq: this.events.seq,
    };
  }
}
