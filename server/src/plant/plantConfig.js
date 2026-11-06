/**
 * Declarative configuration of Unit 100 – the "DCS database".
 *
 * Everything the operator interface needs to know about the plant (tags,
 * ranges, alarm limits, loops, interlocks, malfunctions, equipment) is defined
 * here and served to clients through /api/config, so new points can be added
 * without touching the HMI code.
 */

export const PLANT = {
  id: 'U100',
  name: 'Unit 100 – A→B Reactor & Recovery Column',
  site: 'CHEM-3D Training Plant',
};

/** Alarm priorities (ISA-18.2 style), lower number = more urgent. */
export const PRIORITIES = {
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
};

/**
 * Analog measurement points. Points whose tag matches a controller are the
 * controller PV. `alarms` holds limit alarms: {type: [limit, priority]}.
 */
export const ANALOG_POINTS = [
  // Feed section
  { tag: 'FI-100', description: 'Fresh feed flow to T-101', units: 'm³/h', lo: 0, hi: 25, equipment: 'T-101', decimals: 2 },
  {
    tag: 'LIC-101', description: 'T-101 feed tank level', units: '%', lo: 0, hi: 100, equipment: 'T-101', decimals: 1,
    alarms: { HI: [85, 'LOW'], LO: [20, 'MEDIUM'], LOLO: [8, 'HIGH'] },
  },
  { tag: 'TI-101', description: 'T-101 feed tank temperature', units: '°C', lo: 0, hi: 100, equipment: 'T-101', decimals: 1 },
  {
    tag: 'FIC-101', description: 'Reactor feed flow', units: 'm³/h', lo: 0, hi: 20, equipment: 'FV-101', decimals: 2, noise: 0.004,
    alarms: { LO: [4, 'MEDIUM'] },
  },
  {
    tag: 'TIC-102', description: 'E-101 preheater outlet temperature', units: '°C', lo: 0, hi: 150, equipment: 'E-101', decimals: 1,
    alarms: { HI: [90, 'MEDIUM'], LO: [55, 'LOW'] },
  },
  { tag: 'FI-102', description: 'E-101 steam flow', units: 't/h', lo: 0, hi: 1.5, equipment: 'E-101', decimals: 3 },

  // Reactor
  {
    tag: 'LIC-103', description: 'R-101 reactor level', units: '%', lo: 0, hi: 100, equipment: 'R-101', decimals: 1,
    alarms: { HIHI: [92, 'HIGH'], HI: [80, 'MEDIUM'], LO: [35, 'MEDIUM'], LOLO: [15, 'HIGH'] },
  },
  {
    tag: 'TIC-104', description: 'R-101 reactor temperature', units: '°C', lo: 0, hi: 200, equipment: 'R-101', decimals: 1, lag: 3,
    alarms: { HIHI: [105, 'CRITICAL'], HI: [92, 'HIGH'], LO: [75, 'MEDIUM'] },
  },
  {
    tag: 'TIC-105', description: 'R-101 jacket outlet temperature', units: '°C', lo: 0, hi: 150, equipment: 'R-101', decimals: 1,
    alarms: { HI: [85, 'MEDIUM'] },
  },
  { tag: 'FI-105', description: 'R-101 jacket cooling-water flow', units: 'm³/h', lo: 0, hi: 40, equipment: 'TV-105', decimals: 1 },
  {
    tag: 'PI-106', description: 'R-101 reactor pressure', units: 'bara', lo: 0, hi: 10, equipment: 'R-101', decimals: 2,
    alarms: { HIHI: [4.5, 'CRITICAL'], HI: [2.8, 'HIGH'] },
  },
  {
    tag: 'AI-107', description: 'R-101 outlet product (B) content', units: 'mol%', lo: 0, hi: 100, equipment: 'R-101', decimals: 1, lag: 20,
    alarms: { LO: [70, 'MEDIUM'] },
  },
  { tag: 'FI-103', description: 'Reactor effluent flow to C-101', units: 'm³/h', lo: 0, hi: 25, equipment: 'LV-103', decimals: 2 },

  // Column
  {
    tag: 'PIC-111', description: 'C-101 column top pressure', units: 'bara', lo: 0, hi: 4, equipment: 'C-101', decimals: 3, noise: 0.0008,
    alarms: { HIHI: [2.3, 'CRITICAL'], HI: [1.7, 'HIGH'], LO: [0.9, 'MEDIUM'] },
  },
  {
    tag: 'TIC-112', description: 'C-101 bottom temperature', units: '°C', lo: 0, hi: 250, equipment: 'C-101', decimals: 1, lag: 5,
    alarms: { HI: [165, 'MEDIUM'], LO: [140, 'MEDIUM'] },
  },
  { tag: 'FI-112', description: 'E-104 reboiler steam flow', units: 't/h', lo: 0, hi: 4, equipment: 'E-104', decimals: 3 },
  { tag: 'TI-113', description: 'C-101 overhead temperature', units: '°C', lo: 0, hi: 200, equipment: 'C-101', decimals: 1, lag: 5 },
  { tag: 'FIC-108', description: 'C-101 reflux flow', units: 'm³/h', lo: 0, hi: 20, equipment: 'FV-108', decimals: 2, noise: 0.004, alarms: { LO: [2, 'MEDIUM'] } },
  {
    tag: 'LIC-109', description: 'D-101 reflux drum level', units: '%', lo: 0, hi: 100, equipment: 'D-101', decimals: 1,
    alarms: { HI: [80, 'MEDIUM'], LO: [20, 'MEDIUM'], LOLO: [8, 'HIGH'] },
  },
  { tag: 'FI-109', description: 'Distillate recycle flow to T-101', units: 'm³/h', lo: 0, hi: 10, equipment: 'LV-109', decimals: 2 },
  { tag: 'FI-111', description: 'E-103 condenser cooling-water flow', units: 'm³/h', lo: 0, hi: 160, equipment: 'PV-111', decimals: 1 },
  {
    tag: 'LIC-110', description: 'C-101 column sump level', units: '%', lo: 0, hi: 100, equipment: 'C-101', decimals: 1,
    alarms: { HI: [80, 'MEDIUM'], LO: [20, 'MEDIUM'], LOLO: [8, 'HIGH'] },
  },
  { tag: 'FI-110', description: 'C-101 bottoms product flow', units: 'm³/h', lo: 0, hi: 20, equipment: 'LV-110', decimals: 2 },
  {
    tag: 'AI-114', description: 'Product purity (B) analyser', units: 'mol%', lo: 80, hi: 100, equipment: 'T-102', decimals: 2, noise: 0.0005, lag: 0.1,
    alarms: { LO: [98.5, 'HIGH'] },
  },
  { tag: 'TI-116', description: 'E-102 product rundown temperature', units: '°C', lo: 0, hi: 200, equipment: 'E-102', decimals: 1, alarms: { HI: [70, 'MEDIUM'] } },

  // Product
  {
    tag: 'LI-115', description: 'T-102 product tank level', units: '%', lo: 0, hi: 100, equipment: 'T-102', decimals: 1,
    alarms: { HIHI: [92, 'HIGH'], HI: [85, 'MEDIUM'], LO: [10, 'LOW'] },
  },
  { tag: 'FI-115', description: 'Product export flow', units: 'm³/h', lo: 0, hi: 15, equipment: 'P-105', decimals: 2 },

  // Utilities
  { tag: 'TI-901', description: 'Cooling-water supply temperature', units: '°C', lo: 0, hi: 60, equipment: 'UTIL', decimals: 1, alarms: { HI: [34, 'MEDIUM'] } },
  { tag: 'PI-902', description: 'MP steam header pressure', units: 'barg', lo: 0, hi: 16, equipment: 'UTIL', decimals: 2, alarms: { LO: [8, 'MEDIUM'], LOLO: [6, 'HIGH'] } },
];

/**
 * PID controllers. `action`: 'reverse' → output falls as PV rises (heating,
 * flow); 'direct' → output rises as PV rises (cooling, outlet level).
 * Tuning: kc dimensionless (% output per % of PV span), ti/td in seconds.
 */
export const CONTROLLERS = [
  { tag: 'LIC-101', action: 'reverse', kc: 3.0, ti: 900, td: 0, sp: 50, op: 40, mode: 'AUTO', output: { valve: 'LV-101' }, dev: [15, 'LOW'] },
  { tag: 'FIC-101', action: 'reverse', kc: 0.4, ti: 8, td: 0, sp: 10, op: 50, mode: 'AUTO', output: { valve: 'FV-101' }, dev: [1.5, 'MEDIUM'] },
  { tag: 'TIC-102', action: 'reverse', kc: 1.5, ti: 90, td: 0, sp: 70, op: 35, mode: 'AUTO', output: { valve: 'TV-102' }, dev: [8, 'LOW'] },
  { tag: 'LIC-103', action: 'direct', kc: 3.0, ti: 900, td: 0, sp: 60, op: 40, mode: 'AUTO', output: { valve: 'LV-103' }, dev: [10, 'LOW'] },
  {
    tag: 'TIC-104', action: 'reverse', kc: 4.0, ti: 500, td: 0, sp: 85, op: 61, mode: 'AUTO',
    output: { cascade: 'TIC-105', lo: 20, hi: 100 }, dev: [4, 'HIGH'],
  },
  { tag: 'TIC-105', action: 'direct', kc: 6, ti: 60, td: 0, sp: 72, op: 35, mode: 'CAS', output: { valve: 'TV-105' }, dev: [6, 'LOW'] },
  { tag: 'FIC-108', action: 'reverse', kc: 0.4, ti: 8, td: 0, sp: 6, op: 40, mode: 'AUTO', output: { valve: 'FV-108' }, dev: [1.5, 'LOW'] },
  { tag: 'LIC-109', action: 'direct', kc: 2.0, ti: 600, td: 0, sp: 50, op: 33, mode: 'AUTO', output: { valve: 'LV-109' }, dev: [15, 'LOW'] },
  { tag: 'LIC-110', action: 'direct', kc: 2.0, ti: 600, td: 0, sp: 50, op: 53, mode: 'AUTO', output: { valve: 'LV-110' }, dev: [15, 'LOW'] },
  { tag: 'PIC-111', action: 'direct', kc: 4.0, ti: 120, td: 0, sp: 1.3, op: 50, mode: 'AUTO', output: { valve: 'PV-111' }, dev: [0.15, 'MEDIUM'] },
  { tag: 'TIC-112', action: 'reverse', kc: 3.0, ti: 300, td: 0, sp: 153, op: 40, mode: 'AUTO', output: { valve: 'TV-112' }, dev: [4, 'MEDIUM'] },
  {
    tag: 'HIC-115', description: 'Product export valve (manual loader)', units: '%', lo: 0, hi: 100, manualOnly: true,
    op: 67, mode: 'MAN', output: { valve: 'HV-115' },
  },
];

export const VALVES = [
  { id: 'LV-101', description: 'Fresh feed inlet valve', strokeTime: 10 },
  { id: 'FV-101', description: 'Reactor feed flow valve', strokeTime: 6 },
  { id: 'TV-102', description: 'E-101 steam valve', strokeTime: 8 },
  { id: 'LV-103', description: 'Reactor effluent level valve', strokeTime: 8 },
  { id: 'TV-105', description: 'R-101 jacket cooling-water valve', strokeTime: 8, failPosition: 100 },
  { id: 'FV-108', description: 'Reflux flow valve', strokeTime: 6 },
  { id: 'LV-109', description: 'Distillate level valve', strokeTime: 8 },
  { id: 'LV-110', description: 'Bottoms level valve', strokeTime: 8 },
  { id: 'PV-111', description: 'Condenser cooling-water valve', strokeTime: 8, failPosition: 100 },
  { id: 'TV-112', description: 'Reboiler steam valve', strokeTime: 8 },
  { id: 'HV-115', description: 'Product export valve', strokeTime: 15 },
];

export const MOTORS = [
  {
    id: 'P-101', description: 'Reactor feed pump', kind: 'pump', ratedCurrent: 42, ratedPower: 18.5,
    permissives: [{ point: 'LIC-101', op: '>', value: 10, description: 'T-101 level > 10 %' }],
  },
  {
    id: 'M-101', description: 'R-101 agitator', kind: 'agitator', ratedCurrent: 68, ratedPower: 30, startTime: 5,
    permissives: [{ point: 'LIC-103', op: '>', value: 20, description: 'R-101 level > 20 % (impeller covered)' }],
  },
  {
    id: 'P-102', description: 'Reactor transfer pump', kind: 'pump', ratedCurrent: 55, ratedPower: 22,
    permissives: [{ point: 'LIC-103', op: '>', value: 15, description: 'R-101 level > 15 %' }],
  },
  {
    id: 'P-103', description: 'Reflux / distillate pump', kind: 'pump', ratedCurrent: 30, ratedPower: 11,
    permissives: [{ point: 'LIC-109', op: '>', value: 10, description: 'D-101 level > 10 %' }],
  },
  {
    id: 'P-104', description: 'Column bottoms pump', kind: 'pump', ratedCurrent: 38, ratedPower: 15,
    permissives: [{ point: 'LIC-110', op: '>', value: 10, description: 'C-101 sump level > 10 %' }],
  },
  {
    id: 'P-105', description: 'Product export pump', kind: 'pump', ratedCurrent: 38, ratedPower: 15,
    permissives: [{ point: 'LI-115', op: '>', value: 5, description: 'T-102 level > 5 %' }],
  },
];

/**
 * Safety instrumented functions. Each reads an independent SIS sensor (the
 * true process value, unaffected by DCS transmitter faults). Actions:
 *   {motor, stop: true}                    – trip and inhibit a motor
 *   {valve, position, loop?}               – force a valve; put its loop in MAN
 */
export const INTERLOCKS = [
  {
    id: 'IL-001', description: 'Reactor high-high temperature', sensor: 'TIC-104', sensorTag: 'TZT-104', compare: '>=', trip: 115, units: '°C',
    actions: [
      { motor: 'P-101', stop: true },
      { valve: 'FV-101', position: 0, loop: 'FIC-101' },
      { valve: 'TV-102', position: 0, loop: 'TIC-102' },
      { valve: 'TV-105', position: 100, loop: 'TIC-105' },
    ],
  },
  {
    id: 'IL-002', description: 'Reactor high-high pressure', sensor: 'PI-106', sensorTag: 'PZT-106', compare: '>=', trip: 5.0, units: 'bara',
    actions: [
      { motor: 'P-101', stop: true },
      { valve: 'FV-101', position: 0, loop: 'FIC-101' },
      { valve: 'TV-102', position: 0, loop: 'TIC-102' },
      { valve: 'TV-105', position: 100, loop: 'TIC-105' },
    ],
  },
  {
    id: 'IL-003', description: 'Feed tank low-low level (P-101 dry-run protection)', sensor: 'LIC-101', sensorTag: 'LZT-101', compare: '<=', trip: 5, units: '%',
    actions: [{ motor: 'P-101', stop: true }],
  },
  {
    id: 'IL-004', description: 'Reactor low-low level (P-102 / M-101 protection)', sensor: 'LIC-103', sensorTag: 'LZT-103', compare: '<=', trip: 10, units: '%',
    actions: [{ motor: 'P-102', stop: true }, { motor: 'M-101', stop: true }],
  },
  {
    id: 'IL-005', description: 'Column high-high pressure', sensor: 'PIC-111', sensorTag: 'PZT-111', compare: '>=', trip: 2.5, units: 'bara',
    actions: [{ valve: 'TV-112', position: 0, loop: 'TIC-112' }, { valve: 'PV-111', position: 100, loop: 'PIC-111' }],
  },
  {
    id: 'IL-006', description: 'Column sump low-low level (reboiler protection)', sensor: 'LIC-110', sensorTag: 'LZT-110', compare: '<=', trip: 5, units: '%',
    actions: [{ motor: 'P-104', stop: true }, { valve: 'TV-112', position: 0, loop: 'TIC-112' }],
  },
  {
    id: 'IL-007', description: 'Product tank high-high level (overfill protection)', sensor: 'LI-115', sensorTag: 'LZT-115', compare: '>=', trip: 95, units: '%',
    actions: [{ motor: 'P-104', stop: true }],
  },
  {
    id: 'ESD-1', description: 'Manual emergency shutdown – reaction section', sensor: null, manual: true,
    actions: [
      { motor: 'P-101', stop: true },
      { valve: 'FV-101', position: 0, loop: 'FIC-101' },
      { valve: 'TV-102', position: 0, loop: 'TIC-102' },
      { valve: 'TV-105', position: 100, loop: 'TIC-105' },
      { valve: 'TV-112', position: 0, loop: 'TIC-112' },
    ],
  },
];

/** Instructor-triggered malfunctions for operator training. */
export const MALFUNCTIONS = [
  { id: 'MF-01', name: 'Cooling-water supply failure', description: 'CW circulation pump trip – header capacity falls to 10 %.', category: 'Utilities', effect: { cwAvail: 0.1 } },
  { id: 'MF-02', name: 'Steam header pressure loss', description: 'Boiler upset – MP steam header drops to 4 barg.', category: 'Utilities', effect: { steamPressure: 4 } },
  { id: 'MF-03', name: 'High cooling-water temperature', description: 'Cooling tower fan failure – CW supply rises to 38 °C.', category: 'Utilities', effect: { cwTemp: 38 } },
  { id: 'MF-04', name: 'Agitator M-101 trip', description: 'Agitator motor overload trip – poor mixing and heat transfer.', category: 'Equipment', effect: { failMotor: 'M-101' } },
  { id: 'MF-05', name: 'Transfer pump P-102 trip', description: 'Reactor transfer pump mechanical seal failure.', category: 'Equipment', effect: { failMotor: 'P-102' } },
  { id: 'MF-06', name: 'FV-101 valve stuck', description: 'Reactor feed valve stem seized at current position.', category: 'Equipment', effect: { stuckValve: 'FV-101' } },
  { id: 'MF-07', name: 'E-101 preheater fouling', description: 'Tube-side fouling reduces preheater effectiveness by 55 %.', category: 'Process', effect: { e101Eff: 0.45 } },
  { id: 'MF-08', name: 'Reactor jacket fouling', description: 'Jacket scaling halves the reactor heat-transfer coefficient.', category: 'Process', effect: { jacketUA: 0.5 } },
  { id: 'MF-09', name: 'Condenser E-103 fouling', description: 'Condenser capacity reduced to 55 %.', category: 'Process', effect: { condUA: 0.55 } },
  { id: 'MF-10', name: 'Fresh feed contamination', description: 'Fresh feed purity drops from 98 % to 85 % A.', category: 'Process', effect: { feedXA: 0.85 } },
  { id: 'MF-11', name: 'Reaction inhibitor in feed', description: 'Inhibitor slows the reaction rate by 40 %.', category: 'Process', effect: { rateFactor: 0.6 } },
  { id: 'MF-12', name: 'Fresh feed supply loss', description: 'Battery-limit feed supply interrupted.', category: 'Process', effect: { feedAvail: 0 } },
  { id: 'MF-13', name: 'TIC-104 transmitter drift', description: 'Reactor temperature transmitter drifts low at 0.05 °C/s (undetected).', category: 'Instrument', effect: { sensorFault: { tag: 'TIC-104', mode: 'DRIFT', rate: -0.05 } } },
  { id: 'MF-14', name: 'LIC-110 transmitter fail low', description: 'Column sump level transmitter fails below range (BAD PV).', category: 'Instrument', effect: { sensorFault: { tag: 'LIC-110', mode: 'FAIL_LOW' } } },
  { id: 'MF-15', name: 'FIC-108 transmitter frozen', description: 'Reflux flow transmitter output frozen at last value.', category: 'Instrument', effect: { sensorFault: { tag: 'FIC-108', mode: 'FROZEN' } } },
];

/**
 * Equipment metadata for the operator interface (3D model and navigation).
 * `points` lists the tags shown on the equipment faceplate.
 */
export const EQUIPMENT = [
  { id: 'T-101', type: 'tank', description: 'Feed tank', points: ['LIC-101', 'TI-101', 'FI-100'] },
  { id: 'P-101', type: 'pump', description: 'Reactor feed pump', points: ['FIC-101'] },
  { id: 'E-101', type: 'exchanger', description: 'Feed preheater (steam)', points: ['TIC-102', 'FI-102'] },
  { id: 'R-101', type: 'reactor', description: 'Jacketed CSTR', points: ['TIC-104', 'TIC-105', 'LIC-103', 'PI-106', 'AI-107', 'FI-105'] },
  { id: 'M-101', type: 'agitator', description: 'Reactor agitator', points: ['TIC-104'] },
  { id: 'P-102', type: 'pump', description: 'Reactor transfer pump', points: ['FI-103', 'LIC-103'] },
  { id: 'C-101', type: 'column', description: 'Recovery column', points: ['PIC-111', 'TIC-112', 'TI-113', 'LIC-110', 'FIC-108'] },
  { id: 'E-103', type: 'exchanger', description: 'Overhead condenser', points: ['PIC-111', 'FI-111'] },
  { id: 'E-104', type: 'exchanger', description: 'Reboiler (steam)', points: ['TIC-112', 'FI-112'] },
  { id: 'D-101', type: 'drum', description: 'Reflux drum', points: ['LIC-109', 'FIC-108', 'FI-109'] },
  { id: 'P-103', type: 'pump', description: 'Reflux / distillate pump', points: ['FIC-108', 'FI-109'] },
  { id: 'P-104', type: 'pump', description: 'Column bottoms pump', points: ['FI-110', 'LIC-110'] },
  { id: 'E-102', type: 'exchanger', description: 'Product cooler', points: ['TI-116'] },
  { id: 'T-102', type: 'tank', description: 'Product tank', points: ['LI-115', 'AI-114', 'FI-115'] },
  { id: 'P-105', type: 'pump', description: 'Product export pump', points: ['FI-115', 'HIC-115'] },
  { id: 'UTIL', type: 'utility', description: 'Utilities', points: ['TI-901', 'PI-902'] },
];
