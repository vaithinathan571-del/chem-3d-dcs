/**
 * Plot plan of Unit 100 for the 3D model: equipment placement, pipe routing,
 * valves and the data cards floating above equipment. Units are metres,
 * +y is up, the control-room camera looks from +z.
 */

export const EQUIPMENT_LAYOUT = {
  'T-101': { type: 'tank', pos: [-34, 0, -4], radius: 1.0, height: 4, base: 0.3 },
  'P-101': { type: 'pump', pos: [-30, 0, -1] },
  'E-101': { type: 'exchanger', pos: [-22, 1.2, -1], length: 4.5, radius: 0.45, axis: 'x', service: 'steam' },
  'R-101': { type: 'reactor', pos: [-12, 0, -4], radius: 1.13, height: 5, legs: 2 },
  'P-102': { type: 'pump', pos: [-8.5, 0, -1] },
  'C-101': { type: 'column', pos: [0, 0, -4], radius: 0.8, height: 18, skirt: 3 },
  'E-104': { type: 'exchanger', pos: [3.6, 1.6, -4], length: 3, radius: 0.55, axis: 'z', service: 'steam' },
  'E-103': { type: 'exchanger', pos: [5.5, 16, -4], length: 4, radius: 0.5, axis: 'x', service: 'cw' },
  'D-101': { type: 'drum', pos: [6, 10, -4], length: 3.5, radius: 0.6 },
  'P-103': { type: 'pump', pos: [7.5, 0, -1] },
  'P-104': { type: 'pump', pos: [2.5, 0, 1.5] },
  'E-102': { type: 'exchanger', pos: [10, 1.2, 2], length: 4, radius: 0.4, axis: 'x', service: 'cw' },
  'T-102': { type: 'tank', pos: [17, 0, 1], radius: 1.8, height: 6, base: 0.3 },
  'P-105': { type: 'pump', pos: [21, 0, 3.5] },
};

/**
 * Pipes: `flow` names a key of state.flows (or an array summed) that drives
 * the flow animation; `max` is the flow giving full animation speed.
 */
export const PIPES = [
  // Process
  { id: 'fresh-feed', service: 'process', flow: 'fresh', max: 20, path: [[-44, 1.2, -4], [-37.5, 1.2, -4], [-37.5, 4.9, -4], [-34.5, 4.9, -4], [-34.5, 4.45, -4]] },
  { id: 't101-p101', service: 'process', flow: 'feed', max: 20, path: [[-34, 0.45, -3.0], [-34, 0.45, -1], [-30.75, 0.45, -1]] },
  { id: 'p101-e101', service: 'process', flow: 'feed', max: 20, path: [[-30.35, 0.95, -1], [-30.35, 1.2, -1], [-24.6, 1.2, -1]] },
  { id: 'e101-r101', service: 'process', flow: 'feed', max: 20, path: [[-19.4, 1.2, -1], [-16.5, 1.2, -1], [-16.5, 8.6, -1], [-16.5, 8.6, -4], [-12.5, 8.6, -4], [-12.5, 7.5, -4]] },
  { id: 'r101-p102', service: 'process', flow: 'reactorOut', max: 25, path: [[-12, 1.42, -4], [-12, 0.45, -4], [-12, 0.45, -1], [-9.25, 0.45, -1]] },
  { id: 'p102-c101', service: 'process', flow: 'reactorOut', max: 25, path: [[-8.85, 0.95, -1], [-8.85, 1.2, -1], [-2.2, 1.2, -1], [-2.2, 11, -1], [-2.2, 11, -4], [-0.8, 11, -4]] },
  { id: 'c101-vapour', service: 'vapour', flow: 'vapour', max: 16, radius: 0.16, path: [[0, 21.4, -4], [0, 22.3, -4], [4, 22.3, -4], [4, 16.5, -4]] },
  { id: 'e103-d101', service: 'process', flow: 'condensate', max: 16, path: [[7, 15.5, -4], [7, 10.6, -4]] },
  { id: 'd101-p103', service: 'process', flow: ['reflux', 'distillate'], max: 20, path: [[6.75, 9.4, -4], [6.75, 0.45, -4], [6.75, 0.45, -1]] },
  { id: 'reflux', service: 'process', flow: 'reflux', max: 15, path: [[7.85, 0.95, -1], [7.85, 1.2, -1], [11, 1.2, -1], [11, 20.5, -1], [11, 20.5, -2.5], [0, 20.5, -2.5], [0, 20.5, -3.2]] },
  { id: 'recycle', service: 'process', flow: 'distillate', max: 10, path: [[8.6, 1.2, -1], [8.6, 1.2, 0.3], [13, 1.2, 0.3], [13, 6.6, 0.3], [13, 6.6, -7.4], [-33.5, 6.6, -7.4], [-33.5, 6.6, -4.4], [-33.5, 4.45, -4.4]] },
  { id: 'c101-p104', service: 'process', flow: 'bottoms', max: 15, path: [[0.8, 3.4, -4], [1.6, 3.4, -4], [1.6, 0.45, -4], [1.6, 0.45, 1.5], [1.75, 0.45, 1.5]] },
  { id: 'reboiler-liquid', service: 'process', flow: 'vapour', max: 16, path: [[0.75, 3.1, -4.3], [2.6, 3.1, -4.3], [2.6, 1.6, -4.3], [3.05, 1.6, -4.3]] },
  { id: 'reboiler-vapour', service: 'vapour', flow: 'vapour', max: 16, radius: 0.13, path: [[3.6, 2.15, -3.4], [3.6, 4.6, -3.4], [0.7, 4.6, -3.6]] },
  { id: 'p104-e102', service: 'product', flow: 'bottoms', max: 15, path: [[2.85, 0.95, 1.5], [2.85, 1.2, 1.5], [7.4, 1.2, 1.5], [7.4, 1.2, 2], [7.6, 1.2, 2]] },
  { id: 'e102-t102', service: 'product', flow: 'bottoms', max: 15, path: [[12.4, 1.2, 2], [14, 1.2, 2], [14, 7, 2], [14, 7, 1], [16.4, 7, 1], [16.4, 6.5, 1]] },
  { id: 't102-p105', service: 'product', flow: 'export', max: 12, path: [[17, 0.45, 2.8], [17, 0.45, 3.5], [20.25, 0.45, 3.5]] },
  { id: 'export', service: 'product', flow: 'export', max: 12, path: [[21.65, 0.95, 3.5], [21.65, 1.2, 3.5], [29, 1.2, 3.5]] },

  // Utility headers on the pipe rack
  { id: 'steam-header', service: 'steam', flow: ['steamE101', 'steamReboiler'], max: 4, radius: 0.12, path: [[-26, 7.4, -8.6], [6, 7.4, -8.6]] },
  { id: 'cws-header', service: 'cw', flow: ['cwJacket', 'cwCondenser'], max: 180, radius: 0.14, path: [[-18, 6.0, -8.9], [14, 6.0, -8.9]] },
  { id: 'cwr-header', service: 'cwr', flow: ['cwJacket', 'cwCondenser'], max: 180, radius: 0.14, path: [[14, 5.5, -9.4], [-18, 5.5, -9.4]] },

  // Utility branches
  { id: 'steam-e101', service: 'steam', flow: 'steamE101', max: 1.1, path: [[-21, 7.4, -8.6], [-21, 2.4, -8.6], [-21, 2.4, -1], [-21, 1.65, -1]] },
  { id: 'cw-jacket', service: 'cw', flow: 'cwJacket', max: 30, path: [[-14.5, 6.0, -8.9], [-14.5, 2.6, -8.9], [-14.5, 2.6, -4], [-13.21, 2.6, -4]] },
  { id: 'cwr-jacket', service: 'cwr', flow: 'cwJacket', max: 30, path: [[-10.79, 6.6, -4], [-10.3, 6.6, -4], [-10.3, 6.6, -9.4], [-10.3, 5.5, -9.4]] },
  { id: 'steam-reboiler', service: 'steam', flow: 'steamReboiler', max: 3.6, path: [[3.6, 7.4, -8.6], [3.6, 1.6, -8.6], [3.6, 1.6, -5.8]] },
  { id: 'cw-condenser', service: 'cw', flow: 'cwCondenser', max: 150, path: [[9, 6.0, -8.9], [9, 16, -8.9], [9, 16, -4], [7.8, 16, -4]] },
  { id: 'cwr-condenser', service: 'cwr', flow: 'cwCondenser', max: 150, path: [[3.2, 16, -4], [2.6, 16, -4], [2.6, 16, -9.4], [2.6, 5.5, -9.4]] },
  { id: 'cw-e102', service: 'cw', flow: 'cwE102', max: 20, path: [[11, 6.0, -8.9], [11, 2.2, -8.9], [11, 2.2, 2], [11, 1.6, 2]] },
];

/** Control / manual valves placed in the pipe routes. `axis` is the pipe direction. */
export const VALVE_LAYOUT = {
  'LV-101': { pos: [-40, 1.2, -4], axis: 'x' },
  'FV-101': { pos: [-27.5, 1.2, -1], axis: 'x' },
  'TV-102': { pos: [-21, 2.4, -5], axis: 'z' },
  'LV-103': { pos: [-5.5, 1.2, -1], axis: 'x' },
  'TV-105': { pos: [-14.5, 2.6, -6.6], axis: 'z' },
  'FV-108': { pos: [9.6, 1.2, -1], axis: 'x' },
  'LV-109': { pos: [10.8, 1.2, 0.3], axis: 'x' },
  'LV-110': { pos: [5, 1.2, 1.5], axis: 'x' },
  'PV-111': { pos: [9, 12, -8.9], axis: 'y' },
  'TV-112': { pos: [3.6, 1.6, -7.2], axis: 'z' },
  'HV-115': { pos: [24, 1.2, 3.5], axis: 'x' },
};

/** Data cards floating above equipment: which points to show. */
export const CARDS = [
  { id: 'T-101', pos: [-34, 6.2, -4], points: ['LIC-101', 'TI-101', 'FI-100'] },
  { id: 'E-101', pos: [-22, 3.6, -1], points: ['TIC-102', 'FI-102'] },
  { id: 'R-101', pos: [-12, 11.2, -4], points: ['TIC-104', 'TIC-105', 'LIC-103', 'PI-106', 'AI-107'] },
  { id: 'C-101', pos: [-3.2, 22.4, -4], points: ['PIC-111', 'TI-113', 'FIC-108'] },
  { id: 'C-101 bottom', equipment: 'C-101', pos: [-2.6, 6.2, -2.4], points: ['TIC-112', 'LIC-110', 'FI-112'] },
  { id: 'D-101', pos: [10.2, 11.6, -4], points: ['LIC-109', 'FI-109'] },
  { id: 'T-102', pos: [17, 8.8, 1], points: ['LI-115', 'AI-114', 'FI-115'] },
  { id: 'E-102', pos: [10, 2.8, 2], points: ['TI-116', 'FI-110'] },
];

/** Pipe-rack bents (x positions). */
export const RACK = { xs: [-36, -30, -24, -18, -12, -6, 0, 6, 12], z: [-7, -10], beams: [5.2, 7.0] };

/** Steel structure supporting the reflux drum and condenser. */
export const STRUCTURE = { x: [3.2, 8.8], z: [-5.6, -2.4], floors: [9.3, 15.4] };

export const CAMERA_VIEWS = {
  overview: { position: [-7, 32, 38], target: [-7, 6, -4] },
  feed: { position: [-38, 9, 12], target: [-28, 2, -2] },
  reactor: { position: [-4, 10, 12], target: [-12, 4.5, -3] },
  column: { position: [16, 16, 18], target: [3, 11, -4] },
  product: { position: [26, 10, 16], target: [15, 3, 1] },
};
