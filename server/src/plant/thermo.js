/**
 * Physical property package for the binary A/B liquid system.
 *
 * The plant processes a reactant "A" (light key, normal boiling point ≈ 80 °C)
 * into a product "B" (heavy key, normal boiling point ≈ 140 °C) by the
 * irreversible exothermic liquid-phase reaction A → B. Both components are
 * treated as having the same molar density, so the total molar concentration
 * of any liquid stream is constant and a single mole fraction (xA) fully
 * describes composition.
 */

export const KELVIN = 273.15;

/** Total molar concentration of the liquid [kmol/m³]. */
export const C_TOT = 10;
/** Liquid density [kg/m³]. */
export const RHO = 850;
/** Liquid heat capacity [kJ/(kg·K)]. */
export const CP = 2.2;
/** Volumetric heat capacity of process liquid [kJ/(m³·K)]. */
export const RHO_CP = RHO * CP;
/** Volumetric heat capacity of cooling water [kJ/(m³·K)]. */
export const RHO_CP_WATER = 4180;
/** Latent heat of condensing utility steam [kJ/kg]. */
export const LAMBDA_STEAM = 2000;
/** Molar latent heat of vaporisation of the process mixture [kJ/kmol]. */
export const LAMBDA_PROCESS = 35000;

/** Clausius–Clapeyron style vapour pressure of A [bara]; Tb(1 atm) ≈ 80 °C. */
export const pvapA = (TK) => Math.exp(11.0 - 3883 / TK);

/** Vapour pressure of B [bara]; Tb(1 atm) ≈ 140 °C. */
export const pvapB = (TK) => Math.exp(11.0 - 4543 / TK);

/** Raoult's-law vapour pressure of a liquid with mole fraction xA [bara]. */
export const mixturePvap = (xA, TK) => xA * pvapA(TK) + (1 - xA) * pvapB(TK);

/** Relative volatility of A to B at temperature TK. */
export const relativeVolatility = (TK) => pvapA(TK) / pvapB(TK);

/**
 * Bubble-point temperature [°C] of a liquid with mole fraction xA at pressure P [bara].
 * Solved by bisection (the vapour pressure is monotonic in T).
 */
export function bubbleTempC(xA, P) {
  const x = Math.min(Math.max(xA, 0), 1);
  const p = Math.max(P, 0.01);
  let lo = 200;
  let hi = 700;
  for (let i = 0; i < 48; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (mixturePvap(x, mid) > p) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi) - KELVIN;
}

/** Approximate saturation temperature of utility steam [°C] for a header pressure in barg. */
export const steamSatTempC = (Pbarg) => 100 * ((Math.max(Pbarg, 0) + 1.013) / 1.013) ** 0.25;
