/**
 * Training scenarios (operator exercises).
 *
 * Each scenario starts from a snapshot, optionally adjusts the plant in
 * `setup`, then plays a timeline of events (malfunctions, field messages,
 * hints) while the trainee operates. Objectives are scored continuously; the
 * weights of a scenario add up to 100.
 *
 * Event:      { at: s, malfunction?: id, active?: bool, message?: text, hint?: text }
 * Criterion:  { id, label, weight, type, ... } with type
 *   limit          – process value stays within min/max (fraction of time)
 *   noTrip         – none of the listed SIS functions trips
 *   noAlarm        – none of the listed alarms activates
 *   alarmResponse  – alarms acknowledged within `target` seconds
 *   reachBy        – process value reaches min/max between `from` and `by` s
 *   modeBy         – operator takes a loop out of its normal mode between `from` and `by` s
 *   endValue       – average over the last `window` s is within min/max
 *   endMotor       – motor in `status` at the end
 *   endModes       – loops in the given modes at the end
 */

export const SCENARIOS = [
  {
    id: 'SC-01',
    title: 'Reactor temperature change',
    difficulty: 'Beginner',
    duration: 1200,
    summary: 'Raise the reactor temperature to increase conversion without overshoot or off-spec product.',
    briefing:
      'The unit is running normally at 85 °C. Production planning wants higher conversion. ' +
      'You will be asked to move the reactor to 88 °C. Use the TIC-104 faceplate, avoid overshooting ' +
      'and keep the product on specification while the column adjusts to the new feed composition.',
    events: [
      { at: 30, message: 'Shift supervisor: please raise the reactor temperature TIC-104 to 88 °C. Keep the product on spec.' },
      { at: 240, hint: 'Hint: open TIC-104 (click the R-101 data card or the overview table) and enter 88 in the SP field. Small steps avoid overshoot.' },
    ],
    criteria: [
      { id: 'final-temp', type: 'endValue', tag: 'TIC-104', min: 87, max: 89, window: 120, weight: 45, label: 'Reactor at 88 ± 1 °C at the end' },
      { id: 'overshoot', type: 'limit', tag: 'TIC-104', max: 90, weight: 20, label: 'No overshoot above 90 °C' },
      { id: 'purity', type: 'limit', tag: 'AI-114', min: 98.5, weight: 10, label: 'Product purity ≥ 98.5 mol%' },
      { id: 'no-trip', type: 'noTrip', interlocks: ['IL-001', 'IL-002', 'IL-003', 'IL-004', 'IL-005', 'IL-006', 'IL-007', 'ESD-1'], weight: 10, label: 'No SIS trips' },
      { id: 'alarms', type: 'alarmResponse', target: 60, weight: 15, label: 'Alarms acknowledged within 60 s' },
    ],
  },
  {
    id: 'SC-02',
    title: 'Agitator trip',
    difficulty: 'Intermediate',
    duration: 1200,
    summary: 'The reactor agitator trips. Protect the reactor until maintenance repairs it, then restore normal operation.',
    briefing:
      'Without agitation the jacket removes far less heat and the reactor temperature will climb. ' +
      'Keep the reactor below 92 °C, avoid any SIS trip, restart the agitator once maintenance releases it ' +
      'and bring the feed rate back to normal before the end of the exercise.',
    events: [
      { at: 90, malfunction: 'MF-04', active: true, message: 'Field operator: R-101 agitator M-101 has tripped on overload. Investigating.' },
      { at: 240, hint: 'Hint: reduce the reactor feed FIC-101 to cut heat generation while the agitator is down.' },
      { at: 600, malfunction: 'MF-04', active: false, message: 'Maintenance: M-101 motor replaced and tested – you may restart the agitator.' },
      { at: 720, hint: 'Hint: restart M-101 from its faceplate (click the agitator on top of the reactor), then raise FIC-101 back to 10 m³/h.' },
    ],
    criteria: [
      { id: 'no-trip', type: 'noTrip', interlocks: ['IL-001', 'IL-002', 'ESD-1'], weight: 25, label: 'No reactor SIS trip' },
      { id: 'temp', type: 'limit', tag: 'TIC-104', max: 92, weight: 25, label: 'Reactor temperature ≤ 92 °C' },
      { id: 'agitator', type: 'endMotor', motor: 'M-101', status: 'RUNNING', weight: 20, label: 'Agitator restarted' },
      { id: 'feed', type: 'endValue', tag: 'FIC-101', min: 9, window: 120, weight: 15, label: 'Feed restored to ≥ 9 m³/h' },
      { id: 'alarms', type: 'alarmResponse', target: 60, weight: 15, label: 'Alarms acknowledged within 60 s' },
    ],
  },
  {
    id: 'SC-03',
    title: 'Cooling-water failure',
    difficulty: 'Advanced',
    duration: 1800,
    summary: 'Loss of cooling water threatens a reactor runaway. Prevent the trip and recover production afterwards.',
    briefing:
      'The site cooling-water system supplies the reactor jacket and the column condenser. ' +
      'If it fails, the exothermic reaction will run away unless heat generation is cut quickly. ' +
      'Keep the reactor below 105 °C, prevent the high-high temperature trip and any relief-valve lift, ' +
      'and restore feed once cooling water is back.',
    events: [
      { at: 120, malfunction: 'MF-01', active: true, message: 'Utilities: cooling-water header pressure low alarm.' },
      { at: 160, message: 'Field operator: both cooling-tower pumps have tripped. Electricians estimate 20–25 minutes.' },
      { at: 300, hint: 'Hint: cut reactor feed FIC-101 hard and lower the preheater setpoint TIC-102 – cold feed helps cool the reactor.' },
      { at: 1500, malfunction: 'MF-01', active: false, message: 'Utilities: cooling-water pumps restarted, header pressure normal.' },
      { at: 1530, hint: 'Hint: reset any tripped SIS functions on the Safety tab, return their loops to AUTO, then bring FIC-101 and TIC-102 back to normal.' },
    ],
    criteria: [
      { id: 'no-trip', type: 'noTrip', interlocks: ['IL-001', 'IL-002', 'ESD-1'], weight: 25, label: 'No reactor SIS trip' },
      { id: 'feed-cut', type: 'reachBy', tag: 'FIC-101', max: 5, from: 120, by: 420, weight: 20, label: 'Feed cut to ≤ 5 m³/h within 5 min of the failure' },
      { id: 'temp', type: 'limit', tag: 'TIC-104', max: 100, weight: 15, label: 'Reactor temperature ≤ 100 °C' },
      { id: 'no-psv', type: 'noAlarm', alarms: ['PSV-106.LIFT', 'PSV-111.LIFT'], weight: 10, label: 'No relief-valve lift' },
      { id: 'feed', type: 'endValue', tag: 'FIC-101', min: 7, window: 120, weight: 15, label: 'Feed restored to ≥ 7 m³/h' },
      { id: 'alarms', type: 'alarmResponse', target: 60, weight: 15, label: 'Alarms acknowledged within 60 s' },
    ],
  },
  {
    id: 'SC-04',
    title: 'Fresh-feed supply loss',
    difficulty: 'Intermediate',
    duration: 1500,
    summary: 'Fresh feed stops with the feed tank already low. Stretch the inventory and avoid the low-level trip.',
    briefing:
      'The feed tank T-101 is at a low working level after a tank-farm transfer problem, and the fresh-feed ' +
      'supply is about to stop completely. At full throughput the tank drains in minutes. Keep T-101 above ' +
      '15 %, avoid the low-low level trip on the feed pump and restore throughput and product quality when feed returns.',
    setup: { t101Level: 0.25 },
    events: [
      { at: 5, malfunction: 'MF-12', active: true, message: 'Tank farm: fresh-feed transfer pump has tripped – no fresh A to T-101.' },
      { at: 240, hint: 'Hint: T-101 is draining. Reduce FIC-101 to slow the draw-down – the recycle keeps topping it up.' },
      { at: 1200, malfunction: 'MF-12', active: false, message: 'Tank farm: fresh-feed transfer restored.' },
    ],
    criteria: [
      { id: 'no-trip', type: 'noTrip', interlocks: ['IL-003', 'IL-004', 'ESD-1'], weight: 30, label: 'No feed-pump or reactor low-level trip' },
      { id: 'level', type: 'limit', tag: 'LIC-101', min: 15, weight: 25, label: 'Feed tank level ≥ 15 %' },
      { id: 'feed', type: 'endValue', tag: 'FIC-101', min: 8, window: 120, weight: 15, label: 'Throughput restored to ≥ 8 m³/h' },
      { id: 'purity', type: 'endValue', tag: 'AI-114', min: 98.5, window: 120, weight: 15, label: 'Product on spec at the end' },
      { id: 'alarms', type: 'alarmResponse', target: 60, weight: 15, label: 'Alarms acknowledged within 60 s' },
    ],
  },
  {
    id: 'SC-05',
    title: 'Temperature transmitter drift',
    difficulty: 'Advanced',
    duration: 1200,
    summary: 'The reactor temperature transmitter drifts silently. Detect it and take the loop out of automatic in time.',
    briefing:
      'Instrument faults are not always obvious: a drifting transmitter still reads GOOD. The DCS compares ' +
      'TIC-104 with the independent SIS transmitter TZT-104. Watch for discrepancies, protect the reactor and ' +
      'return the cascade (TIC-104 AUTO, TIC-105 CAS) to normal once the instrument is repaired.',
    events: [
      { at: 60, malfunction: 'MF-13', active: true },
      { at: 420, hint: 'Hint: compare TIC-104 with TZT-104 on the Safety tab. Put TIC-104 in MAN or take TIC-105 out of CAS to stop chasing the false reading.' },
      { at: 840, malfunction: 'MF-13', active: false, message: 'Instrument technician: TT-104 recalibrated and back in service.' },
      { at: 900, hint: 'Hint: put TIC-105 back in CAS and TIC-104 in AUTO.' },
    ],
    criteria: [
      { id: 'no-trip', type: 'noTrip', interlocks: ['IL-001', 'IL-002', 'ESD-1'], weight: 25, label: 'No reactor SIS trip' },
      { id: 'temp', type: 'limit', tag: 'TIC-104', max: 92, weight: 25, label: 'True reactor temperature ≤ 92 °C' },
      { id: 'intervene', type: 'modeBy', modes: { 'TIC-104': 'AUTO', 'TIC-105': 'CAS' }, from: 60, by: 420, weight: 20, label: 'Cascade taken off automatic within 6 min of the drift starting' },
      { id: 'modes', type: 'endModes', modes: { 'TIC-104': 'AUTO', 'TIC-105': 'CAS' }, weight: 10, label: 'Cascade back in normal mode at the end' },
      { id: 'alarms', type: 'alarmResponse', target: 60, weight: 20, label: 'Alarms acknowledged within 60 s' },
    ],
  },
];
