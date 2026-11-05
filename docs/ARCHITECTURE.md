# CHEM-3D DCS architecture

## System overview

```
┌──────────────────────── Browser (operator console) ─────────────────────────┐
│  Three.js 3D plant  ·  faceplates  ·  alarm banner  ·  trends  ·  SIS  ·  IOS │
│               store.js (state, selection)  ◀──  net/client.js               │
└───────────────────────────────▲─────────────────────────┬───────────────────┘
                     state @2 Hz │ WebSocket /ws           │ commands / REST
┌────────────────────────────────┴─────────────────────────▼───────────────────┐
│ api/httpServer.js  – REST, static files, WebSocket, auth guard               │
├──────────────────────────────────────────────────────────────────────────────┤
│ runtime.js – real-time executive (100 ms tick, fixed 0.1 s sub-steps)         │
│                                                                              │
│   malfunctions ─▶ utilities                                                  │
│        │                                                                     │
│        ▼                                                                     │
│   ProcessModel.step(dt)  ◀── valve positions, motor speeds                   │
│        │ true values                                                         │
│        ├──────────────▶ SIS (independent sensors) ─▶ force valves / trip motors│
│        ▼                                                                     │
│   Transmitters (lag, noise, faults)                                          │
│        │ PV + quality                                                        │
│        ▼                                                                     │
│   ControlSystem (PID, cascade) ─▶ valve commands                             │
│        │                                                                     │
│   Valves / motors update (stroke, ramp)                                      │
│        │                                                                     │
│   AlarmManager (every 0.5 s)  ·  Historian (every 1 s)  ·  EventLog          │
└──────────────────────────────────────────────────────────────────────────────┘
```

The server is the single source of truth. Clients receive a full live-state snapshot every `BROADCAST_MS`. They never compute plant behaviour; they only render it and send commands. Every command is authorised against the user's role, executed by the runtime and journaled with the user name.

## Process design basis

Unit 100 converts reactant **A** into product **B** with the irreversible, exothermic liquid-phase reaction A → B.

| Item | Value |
| --- | --- |
| Kinetics | r = k₀·exp(−E/RT)·C_A, k₀ = 4.65·10⁶ s⁻¹, E/R = 8000 K |
| Heat of reaction | −30 MJ/kmol (adiabatic temperature rise ≈ 160 K) |
| Liquid | C_tot = 10 kmol/m³, ρ = 850 kg/m³, c_p = 2.2 kJ/kg·K |
| Vapour pressure | ln P_A = 11 − 3883/T, ln P_B = 11 − 4543/T (bar, K); T_b ≈ 80 °C / 140 °C |
| Design feed | 10 m³/h to R-101 at 70 °C |
| R-101 | 20 m³, 60 % level, 85 °C, ≈ 80 % conversion, jacket UA = 40 kW/K |
| C-101 | 1.3 bara top pressure, 153 °C bottom, ≈ 99.1 mol% B product (spec ≥ 98.5) |
| Recycle | ≈ 2.0 m³/h distillate (≈ 93 % A) back to T-101 |

### Models

- **Vessels** use dynamic volume, composition and energy balances (explicit Euler, 0.1 s). Pump suction loses NPSH below 2–7 % level. Overfilled vessels clamp and raise an overflow alarm.
- **Reactor.** Jacket heat transfer scales with wetted area and agitation (35 % without the agitator). Reactor pressure is the N₂ blanket plus Raoult vapour pressure. PSV-106 lifts at 7 bara, venting vapour and removing latent heat.
- **Column.** Pressure integrates vapour boil-up minus condensation. Condensation depends on CW flow and (T_top − T_cw), so pressure is self-regulating. Product compositions relax towards a steady-state split:
  - the separation factor S = α^N_eff, with N_eff increasing with internal reflux L/V;
  - the overall component balance is solved for the current distillate draw.
  
  Tray temperatures are bubble points at the local pressure. The reboiler duty is limited by steam valve capacity and by UA·(T_steam − T_bottom). It therefore fails realistically when steam pressure drops.
- **Instruments.** Transmitters add first-order lag and Gaussian noise, and apply a low-flow cut-off on flows. NAMUR NE43 limits flag BAD quality. AI-114 is a sample-and-hold analyser with a 60 s cycle.

## Control strategy

| Loop | PV | MV | Action | Notes |
| --- | --- | --- | --- | --- |
| LIC-101 | T-101 level | LV-101 fresh feed | reverse | Inventory control with recycle disturbance |
| FIC-101 | Reactor feed | FV-101 | reverse | Throughput manipulator |
| TIC-102 | Preheater outlet | TV-102 steam | reverse | |
| LIC-103 | Reactor level | LV-103 effluent | direct | |
| TIC-104 | Reactor temperature | TIC-105.SP | reverse | Cascade master, output 20–100 °C |
| TIC-105 | Jacket temperature | TV-105 CW | direct | Cascade slave |
| FIC-108 | Reflux | FV-108 | reverse | |
| LIC-109 | Reflux drum level | LV-109 distillate | direct | |
| LIC-110 | Column sump level | LV-110 bottoms | direct | |
| PIC-111 | Column pressure | PV-111 condenser CW | direct | |
| TIC-112 | Bottom temperature | TV-112 reboiler steam | reverse | Inferential purity control |
| HIC-115 | — | HV-115 export | manual | |

The PID block (`server/src/control/pid.js`) is the velocity form:

```
ΔOP = Kc · [ Δe + (h/Ti)·e + ΔD ],   D = filtered Td·d(±PV)/dt  (Tf = Td/8)
```

Error is normalised to the PV span, so Kc is dimensionless. In the velocity form, mode transfers are bumpless and the output limits act as anti-windup. The derivative acts on PV only. In MAN the SP tracks the PV. A cascade master whose slave is not in CAS enters IMAN and back-calculates its output from the slave SP. A loop whose PV goes BAD sheds to MAN.

## Safety instrumented system

| Function | Trip | Actions |
| --- | --- | --- |
| IL-001 | TZT-104 ≥ 115 °C | Stop P-101, close FV-101 and TV-102, open TV-105 |
| IL-002 | PZT-106 ≥ 5.0 bara | as IL-001 |
| IL-003 | LZT-101 ≤ 5 % | Stop P-101 |
| IL-004 | LZT-103 ≤ 10 % | Stop P-102 and M-101 |
| IL-005 | PZT-111 ≥ 2.5 bara | Close TV-112, open PV-111 |
| IL-006 | LZT-110 ≤ 5 % | Stop P-104, close TV-112 |
| IL-007 | LZT-115 ≥ 95 % | Stop P-104 |
| ESD-1 | Pushbutton | Reaction section shutdown, reboiler steam closed |

SIS sensors read the true process value. A DCS transmitter fault therefore cannot defeat the SIS, but it can be detected: the `DISC` alarm compares DCS and SIS readings. Trips latch and record first-out. Each trip forces its valves (the affected loops go to MAN at the safe output and are marked interlocked) and inhibits motor starts. A reset is refused while the trip condition is still present. Bypass needs the engineer role and raises a LOW alarm for as long as it is active.

## Alarm philosophy

- **Priorities.** CRITICAL (immediate action, SIS / PSV / HIHI), HIGH, MEDIUM, LOW.
- **Limit alarms.** 1 % of span deadband and a 1–3 s on-delay. Deviation alarms have a 30 s on-delay and are evaluated only in AUTO/CAS.
- **State model.** ISA-18.2. Unacknowledged alarms flash in the banner, the summary and the 3D model. A cleared but unacknowledged alarm stays listed (RTN_UNACK) until acknowledged.
- **Shelving.** Up to 8 h, then the alarm unshelves itself. CRITICAL alarms cannot be shelved.
- **Flood detection.** More than 100 annunciations in 10 minutes (an average of 10 per minute).

## Extending the plant

1. Add a point to `ANALOG_POINTS` in `server/src/plant/plantConfig.js`, with its range, units and alarm limits.
2. Return its true value from `ProcessModel.measurements()`.
3. Optionally add a controller to `CONTROLLERS` with the same tag, and a valve to `VALVES`.
4. To show it in 3D, add the valve to `VALVE_LAYOUT`, a pipe to `PIPES`, or the tag to a data card in `client/src/scene/layout.js`.

The historian, alarm system, overview, trends and faceplates pick new points up automatically from `/api/config`.
