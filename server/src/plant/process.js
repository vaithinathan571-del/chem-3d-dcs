/**
 * First-principles dynamic model of Unit 100: an exothermic CSTR with feed
 * preheating, followed by a distillation column that recycles unreacted A.
 *
 *   fresh A ─LV-101─▶ T-101 ─P-101─FV-101─▶ E-101 ─▶ R-101 ─P-102─LV-103─▶ C-101
 *                       ▲                    (steam)  (jacket CW)            │
 *                       │                                                    ├─▶ E-103 cond. ─▶ D-101 ─P-103─┬─FV-108─▶ reflux
 *                       └─────────────────────── distillate (recycle) ◀─LV-109┘                              │
 *                                                                            └─▶ sump ─P-104─LV-110─▶ E-102 ─▶ T-102 ─P-105─HV-115─▶ export
 *
 * Units used internally: volumes m³, flows m³/s, temperatures °C, pressures
 * bara (steam header barg), duties kW. Reported flows are converted to m³/h
 * and steam to t/h.
 */
import { clamp, lagFactor } from '../util/math.js';
import * as th from './thermo.js';

const H = 3600;

export const DESIGN = Object.freeze({
  t101: { area: 3.0, height: 4.0 },
  e101: { steamMax: 0.3, effectiveness: 0.9, tau: 30 },
  r101: {
    area: 4.0,
    height: 5.0,
    jacketVolume: 1.5,
    UA: 40, // kW/K at normal level with agitator running
    agitatorHeat: 15, // kW
    nitrogen: 1.1, // bara blanket partial pressure
    psvSet: 7.0, // bara
    heatLoss: 0.5, // kW/K
  },
  kinetics: { k0: 4.65e6, EoverR: 8000, dH: 30000 },
  col: {
    capacity: 0.1, // m³ liquid-equivalent vapour per bar
    Kc: 7.5e-5, // condenser m³/s per K at full CW
    Nmax: 9,
    refluxScale: 1.12,
    dp: 0.15, // bar column pressure drop
    tauTop: 120,
    tauBottom: 150,
    tauLiquid: 40,
    tauBoil: 30,
    reboilerUA: 40, // kW/K
    steamMax: 1.0, // kg/s
    psvSet: 3.5, // bara
  },
  d101: { volume: 3.0 },
  sump: { volume: 4.0 },
  t102: { area: 10.0, height: 6.0 },
  e102: { effectiveness: 0.8, tau: 30 },
  flows: {
    // maximum flows at 100 % valve opening, m³/h
    fresh: 20,
    feed: 20,
    reactorOut: 25,
    reflux: 15,
    distillate: 10,
    bottoms: 15,
    export: 12,
    cwJacket: 30,
    cwCondenser: 150,
  },
  analyzerInterval: 60, // s sampling cycle of AI-114
});

/** Default utility / boundary conditions, modified by malfunctions. */
export const BASE_UTILITIES = Object.freeze({
  cwTemp: 30, // °C cooling-water supply
  cwAvail: 1, // fraction of CW header capacity
  steamPressure: 10, // barg
  feedXA: 0.98, // fresh feed purity
  feedTemp: 25, // °C
  feedAvail: 1, // fresh feed header availability
  ambient: 25,
  e101Eff: 1, // multiplier on E-101 effectiveness (fouling)
  jacketUA: 1, // multiplier on R-101 jacket UA (fouling)
  condUA: 1, // multiplier on condenser capacity (fouling)
  rateFactor: 1, // multiplier on reaction rate constant (inhibitor)
});

/** Pump suction availability vs. vessel level fraction (loss of NPSH near empty). */
const suction = (frac) => clamp((frac - 0.02) / 0.05, 0, 1);

/**
 * Solve the steady-state component split for a column with feed F (xf), net
 * distillate D and separation factor S = [xD/(1-xD)] / [xB/(1-xB)].
 */
export function solveSplit(F, xf, D, S) {
  const B = F - D;
  const xDofB = (xB) => (S * xB) / (1 - xB + S * xB);
  if (D <= F * 1e-6) return { xD: xDofB(xf), xB: xf };
  if (B <= F * 1e-6) return { xD: xf, xB: xf / (S * (1 - xf) + xf) };
  let lo = 0;
  let hi = xf;
  for (let i = 0; i < 50; i += 1) {
    const mid = 0.5 * (lo + hi);
    const g = D * xDofB(mid) + B * mid - F * xf;
    if (g > 0) hi = mid;
    else lo = mid;
  }
  const xB = 0.5 * (lo + hi);
  return { xD: xDofB(xB), xB };
}

export function initialProcessState() {
  return {
    t101: { V: 6.0, xA: 0.974, T: 29.6 },
    e101: { Tout: 70 },
    r101: { V: 12.0, xA: 0.195, T: 85, Tj: 69, psvOpen: false },
    col: {
      P: 1.3,
      xTop: 0.95,
      xBot: 0.01,
      xDss: 0.95,
      xBss: 0.01,
      Vboil: 8.1 / H,
      Lin: 16.1 / H,
      psvOpen: false,
    },
    d101: { V: 1.5, xA: 0.95, T: 48 },
    sump: { V: 2.0 },
    t102: { V: 30.0, xA: 0.01, T: 40 },
    e102: { Tout: 45 },
    analyzer: { timer: 0, value: 99.0 },
  };
}

export class ProcessModel {
  constructor(design = DESIGN) {
    this.d = design;
    this.s = initialProcessState();
    this.flows = {};
    this.duties = {};
    this.derived = {};
    this.flags = {};
    /** Totalised quantities since the last reset (for KPIs). */
    this.totals = { productTonnes: 0, steamTonnes: 0 };
  }

  get volumes() {
    const d = this.d;
    return {
      t101: d.t101.area * d.t101.height,
      r101: d.r101.area * d.r101.height,
      d101: d.d101.volume,
      sump: d.sump.volume,
      t102: d.t102.area * d.t102.height,
    };
  }

  /**
   * Integrate the process one explicit-Euler step.
   * @param {number} dt seconds
   * @param {{valve: (id: string) => number, motor: (id: string) => number, utilities: object}} io
   */
  step(dt, io) {
    const { d, s } = this;
    const u = io.utilities;
    const vol = this.volumes;
    const valve = io.valve;
    const motor = io.motor;

    const frac = {
      t101: s.t101.V / vol.t101,
      r101: s.r101.V / vol.r101,
      d101: s.d101.V / vol.d101,
      sump: s.sump.V / vol.sump,
      t102: s.t102.V / vol.t102,
    };

    // ---------------------------------------------------------------- flows
    const f = d.flows;
    const Ffresh = (f.fresh / H) * valve('LV-101') * u.feedAvail;
    const F1 = (f.feed / H) * valve('FV-101') * motor('P-101') * suction(frac.t101);
    const F2 = (f.reactorOut / H) * valve('LV-103') * motor('P-102') * suction(frac.r101);
    const p103 = motor('P-103') * suction(frac.d101);
    const R = (f.reflux / H) * valve('FV-108') * p103;
    const D = (f.distillate / H) * valve('LV-109') * p103;
    const B = (f.bottoms / H) * valve('LV-110') * motor('P-104') * suction(frac.sump);
    const Fexp = (f.export / H) * valve('HV-115') * motor('P-105') * suction(frac.t102);
    const Fcwj = (f.cwJacket / H) * valve('TV-105') * u.cwAvail;
    const cwCondFrac = valve('PV-111') * u.cwAvail;
    const Fcwc = (f.cwCondenser / H) * cwCondFrac;

    // ------------------------------------------------------- T-101 feed tank
    {
      const t = s.t101;
      const V = Math.max(t.V, 0.05);
      t.xA += (dt * (Ffresh * (u.feedXA - t.xA) + D * (s.d101.xA - t.xA))) / V;
      t.T += (dt * (Ffresh * (u.feedTemp - t.T) + D * (s.d101.T - t.T))) / V;
      t.T += (dt * 0.2 * (u.ambient - t.T)) / (V * th.RHO_CP);
      t.V += dt * (Ffresh + D - F1);
    }

    // -------------------------------------------------- E-101 feed preheater
    const Tsteam = th.steamSatTempC(u.steamPressure);
    const steamPressFactor = Math.sqrt(Math.max(u.steamPressure, 0) / 10);
    const steamE101Cap = d.e101.steamMax * valve('TV-102') * steamPressFactor;
    const Fe = Math.max(F1, 2e-5);
    const Qe101 = Math.min(
      steamE101Cap * th.LAMBDA_STEAM,
      d.e101.effectiveness * u.e101Eff * Fe * th.RHO_CP * Math.max(Tsteam - s.t101.T, 0),
    );
    const e101ss = s.t101.T + Qe101 / (Fe * th.RHO_CP);
    s.e101.Tout += (e101ss - s.e101.Tout) * lagFactor(dt, d.e101.tau);

    // ------------------------------------------------------------ R-101 CSTR
    const r = s.r101;
    const Vr = Math.max(r.V, 0.05);
    const TrK = r.T + th.KELVIN;
    const k = d.kinetics.k0 * u.rateFactor * Math.exp(-d.kinetics.EoverR / TrK);
    const reactKmol = k * th.C_TOT * r.xA * Math.max(r.V, 0); // kmol/s
    const Qrxn = reactKmol * d.kinetics.dH;
    const agit = motor('M-101');
    const wet = clamp(frac.r101 / 0.6, 0.05, 1.4);
    const UAj = d.r101.UA * wet * (0.35 + 0.65 * agit) * u.jacketUA;
    const Qjacket = UAj * (r.T - r.Tj);
    const Qagit = d.r101.agitatorHeat * agit * (frac.r101 > 0.1 ? 1 : 0);
    const Qloss = d.r101.heatLoss * (r.T - u.ambient);
    const Preactor = d.r101.nitrogen + th.mixturePvap(r.xA, TrK);
    if (Preactor > d.r101.psvSet) r.psvOpen = true;
    else if (Preactor < d.r101.psvSet - 0.4) r.psvOpen = false;
    const Vvent = r.psvOpen ? 0.004 * Math.max(Preactor - (d.r101.psvSet - 0.4), 0) : 0;
    const Qvent = Vvent * th.C_TOT * th.LAMBDA_PROCESS;

    r.xA += (dt * (F1 * (s.t101.xA - r.xA) - reactKmol / th.C_TOT)) / Vr;
    r.T += (dt * (F1 * th.RHO_CP * (s.e101.Tout - r.T) + Qrxn - Qjacket + Qagit - Qloss - Qvent)) / (Vr * th.RHO_CP);
    r.Tj += (dt * (Fcwj * th.RHO_CP_WATER * (u.cwTemp - r.Tj) + Qjacket)) / (d.r101.jacketVolume * th.RHO_CP_WATER);
    r.V += dt * (F1 - F2 - Vvent);

    // ------------------------------------------------- C-101 distillation
    const c = s.col;
    const Pbot = c.P + d.col.dp;
    const Ttop = th.bubbleTempC(c.xTop, c.P);
    const Tbot = th.bubbleTempC(c.xBot, Pbot);

    const steamRebCap = d.col.steamMax * valve('TV-112') * steamPressFactor;
    const QrebMax = d.col.reboilerUA * Math.max(Tsteam - Tbot, 0);
    const Qreb = Math.min(steamRebCap * th.LAMBDA_STEAM, QrebMax) * suction(frac.sump);
    const VboilTarget = Qreb / th.LAMBDA_PROCESS / th.C_TOT;
    c.Vboil += (VboilTarget - c.Vboil) * lagFactor(dt, d.col.tauBoil);

    const Vcond = d.col.Kc * u.condUA * cwCondFrac * Math.max(Ttop - u.cwTemp, 0);
    c.P += (dt * (c.Vboil - Vcond)) / d.col.capacity;
    if (c.P > d.col.psvSet) c.psvOpen = true;
    else if (c.P < d.col.psvSet - 0.3) c.psvOpen = false;
    if (c.psvOpen) c.P -= dt * 0.05 * Math.max(c.P - (d.col.psvSet - 0.3), 0);
    c.P = Math.max(c.P, 0.1);

    c.Lin += (F2 + R - c.Lin) * lagFactor(dt, d.col.tauLiquid);

    if (F2 > 1e-5) {
      const Vb = Math.max(c.Vboil, 1e-7);
      const internalLV = clamp(R / Vb, 0, 1);
      const alpha = th.relativeVolatility(0.5 * (Ttop + Tbot) + th.KELVIN);
      const Neff = d.col.Nmax * (1 - Math.exp(-internalLV / d.col.refluxScale));
      const S = alpha ** Neff;
      const Dss = clamp(Vb - R, 0, F2 * 0.999);
      const split = solveSplit(F2, clamp(r.xA, 0, 1), Dss, S);
      c.xDss = split.xD;
      c.xBss = split.xB;
    }
    c.xTop += (c.xDss - c.xTop) * lagFactor(dt, d.col.tauTop);
    c.xBot += (c.xBss - c.xBot) * lagFactor(dt, d.col.tauBottom);

    // D-101 reflux drum
    const dr = s.d101;
    const Vd = Math.max(dr.V, 0.02);
    const Tsub = u.cwTemp + 0.3 * Math.max(Ttop - u.cwTemp, 0);
    dr.xA += (dt * Vcond * (c.xTop - dr.xA)) / Math.max(Vd, Vcond * dt * 2);
    dr.T += (dt * Vcond * (Tsub - dr.T)) / Math.max(Vd, Vcond * dt * 2);
    dr.V += dt * (Vcond - R - D);

    // Column sump
    s.sump.V += dt * (c.Lin - c.Vboil - B);

    // E-102 product cooler and T-102 product tank
    const e102ss = Tbot - d.e102.effectiveness * Math.sqrt(u.cwAvail) * (Tbot - u.cwTemp);
    s.e102.Tout += (e102ss - s.e102.Tout) * lagFactor(dt, d.e102.tau);
    const p = s.t102;
    const Vp = Math.max(p.V, 0.1);
    p.xA += (dt * B * (c.xBot - p.xA)) / Vp;
    p.T += (dt * (B * (s.e102.Tout - p.T) + (0.5 * (u.ambient - p.T)) / th.RHO_CP)) / Vp;
    p.V += dt * (B - Fexp);

    // On-line analyser AI-114: sample and hold
    s.analyzer.timer += dt;
    if (s.analyzer.timer >= d.analyzerInterval) {
      s.analyzer.timer = 0;
      s.analyzer.value = (1 - c.xBot) * 100;
    }

    // ------------------------------------------------ bounds and overflow
    this.flags = {
      t101Overflow: s.t101.V > vol.t101,
      r101Overflow: s.r101.V > vol.r101,
      d101Overflow: s.d101.V > vol.d101,
      sumpFlooded: s.sump.V > vol.sump,
      t102Overflow: s.t102.V > vol.t102,
    };
    s.t101.V = clamp(s.t101.V, 0, vol.t101);
    s.r101.V = clamp(s.r101.V, 0, vol.r101);
    s.d101.V = clamp(s.d101.V, 0, vol.d101);
    s.sump.V = clamp(s.sump.V, 0, vol.sump);
    s.t102.V = clamp(s.t102.V, 0, vol.t102);
    for (const x of [s.t101, s.r101, s.d101, s.t102]) x.xA = clamp(x.xA, 0, 1);
    c.xTop = clamp(c.xTop, 0, 1);
    c.xBot = clamp(c.xBot, 0, 1);

    // ------------------------------------------------ reporting
    const steamE101 = Qe101 / th.LAMBDA_STEAM; // kg/s
    const steamReb = Qreb / th.LAMBDA_STEAM;
    this.flows = {
      fresh: Ffresh * H,
      feed: F1 * H,
      reactorOut: F2 * H,
      reflux: R * H,
      distillate: D * H,
      bottoms: B * H,
      export: Fexp * H,
      cwJacket: Fcwj * H,
      cwCondenser: Fcwc * H,
      vapour: c.Vboil * H,
      condensate: Vcond * H,
      steamE101: steamE101 * 3.6, // t/h
      steamReboiler: steamReb * 3.6,
      reactorVent: Vvent * H,
    };
    this.duties = { e101: Qe101, reaction: Qrxn, jacket: Qjacket, reboiler: Qreb, condenser: Vcond * th.C_TOT * th.LAMBDA_PROCESS };
    this.derived = {
      Preactor,
      Ttop,
      Tbot,
      Pbot,
      Tsteam,
      k,
      frac,
      conversion: s.t101.xA > 1e-6 ? clamp((s.t101.xA - r.xA) / s.t101.xA, 0, 1) * 100 : 0,
    };
    this.totals.productTonnes += (B * dt * th.RHO) / 1000;
    this.totals.steamTonnes += ((steamE101 + steamReb) * dt) / 1000;

    // Motor loading for current indication.
    io.setMotorLoad?.('P-101', valve('FV-101'));
    io.setMotorLoad?.('P-102', valve('LV-103'));
    io.setMotorLoad?.('P-103', (R + D) / ((f.reflux + f.distillate) / H));
    io.setMotorLoad?.('P-104', valve('LV-110'));
    io.setMotorLoad?.('P-105', valve('HV-115'));
    io.setMotorLoad?.('M-101', clamp(frac.r101 / 0.6, 0, 1.2));
  }

  /** "True" process values keyed by measurement point (before transmitter effects). */
  measurements(u) {
    const { s, flows, derived } = this;
    const vol = this.volumes;
    return {
      'FI-100': flows.fresh ?? 0,
      'LIC-101': (s.t101.V / vol.t101) * 100,
      'TI-101': s.t101.T,
      'FIC-101': flows.feed ?? 0,
      'TIC-102': s.e101.Tout,
      'FI-102': flows.steamE101 ?? 0,
      'LIC-103': (s.r101.V / vol.r101) * 100,
      'TIC-104': s.r101.T,
      'TIC-105': s.r101.Tj,
      'FI-105': flows.cwJacket ?? 0,
      'PI-106': derived.Preactor ?? 1.5,
      'AI-107': (1 - s.r101.xA) * 100,
      'FI-103': flows.reactorOut ?? 0,
      'FIC-108': flows.reflux ?? 0,
      'LIC-109': (s.d101.V / vol.d101) * 100,
      'FI-109': flows.distillate ?? 0,
      'LIC-110': (s.sump.V / vol.sump) * 100,
      'FI-110': flows.bottoms ?? 0,
      'PIC-111': s.col.P,
      'FI-111': flows.cwCondenser ?? 0,
      'TIC-112': derived.Tbot ?? 150,
      'FI-112': flows.steamReboiler ?? 0,
      'TI-113': derived.Ttop ?? 90,
      'AI-114': s.analyzer.value,
      'LI-115': (s.t102.V / vol.t102) * 100,
      'FI-115': flows.export ?? 0,
      'TI-116': s.e102.Tout,
      'TI-901': u.cwTemp,
      'PI-902': u.steamPressure,
    };
  }

  kpis() {
    const { s, flows, derived, duties } = this;
    const productTph = ((flows.bottoms ?? 0) * th.RHO) / 1000;
    const purity = (1 - s.col.xBot) * 100;
    const steam = (flows.steamE101 ?? 0) + (flows.steamReboiler ?? 0);
    return {
      conversion: derived.conversion ?? 0,
      productRate: productTph * (purity / 100),
      purity,
      steam,
      specificSteam: productTph > 0.05 ? steam / productTph : null,
      coolingWater: (flows.cwJacket ?? 0) + (flows.cwCondenser ?? 0),
      reactionHeat: duties.reaction ?? 0,
      recycle: flows.distillate ?? 0,
      productTonnes: this.totals.productTonnes,
      steamTonnes: this.totals.steamTonnes,
    };
  }

  /** Visual hints for the 3D client (compositions, vessel fill fractions). */
  visual() {
    const { s } = this;
    const vol = this.volumes;
    return {
      'T-101': { level: s.t101.V / vol.t101, xA: s.t101.xA, T: s.t101.T },
      'R-101': { level: s.r101.V / vol.r101, xA: s.r101.xA, T: s.r101.T, psv: s.r101.psvOpen },
      'C-101': { level: s.sump.V / vol.sump, xA: s.col.xBot, xTop: s.col.xTop, T: this.derived.Tbot ?? 150, psv: s.col.psvOpen },
      'D-101': { level: s.d101.V / vol.d101, xA: s.d101.xA, T: s.d101.T },
      'T-102': { level: s.t102.V / vol.t102, xA: s.t102.xA, T: s.t102.T },
    };
  }

  snapshot() {
    return { s: structuredClone(this.s), totals: { ...this.totals } };
  }

  restore(snap) {
    this.s = structuredClone(snap.s);
    this.totals = { ...snap.totals };
  }
}
