/**
 * Small numeric helpers shared by the simulator and control modules.
 */

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a, b, t) => a + (b - a) * t;

/** First-order lag factor for a time step `dt` and time constant `tau` (exact discretisation). */
export const lagFactor = (dt, tau) => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));

/** Round to `n` decimals; used to keep network payloads compact. */
export const round = (v, n = 3) => {
  if (!Number.isFinite(v)) return v;
  const f = 10 ** n;
  return Math.round(v * f) / f;
};

/**
 * Deterministic pseudo random generator (mulberry32). The simulator uses a
 * seeded generator so that test runs and training scenarios are repeatable.
 */
export function createRng(seed = 0x5eed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  /** Standard normal sample (Box–Muller). */
  const gauss = () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
  return {
    next,
    gauss,
    getState: () => a,
    setState: (s) => {
      a = s >>> 0;
      spare = null;
    },
  };
}
