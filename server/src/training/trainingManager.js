/**
 * Training engine: runs scenario timelines and scores the trainee.
 *
 * Platform independent – it only talks to the PlantRuntime – so it works in
 * the Node server and in the standalone browser build alike.
 */
const EVAL_INTERVAL = 1; // s of simulated time between evaluations
const MAX_RESULTS = 30;

export function gradeFor(score) {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

export const GRADE_TEXT = { A: 'Excellent', B: 'Good', C: 'Satisfactory', D: 'Needs practice' };

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class TrainingManager {
  /**
   * @param {import('../runtime.js').PlantRuntime} runtime
   * @param {object[]} scenarios
   */
  constructor(runtime, scenarios) {
    this.rt = runtime;
    this.scenarios = new Map(scenarios.map((s) => [s.id, s]));
    this.active = null;
    this.results = [];
    this.version = 0;
    this.seq = 0;
  }

  /** Public scenario catalogue for the client. */
  catalog() {
    return [...this.scenarios.values()].map(({ id, title, difficulty, duration, summary, briefing, criteria }) => ({
      id,
      title,
      difficulty,
      duration,
      summary,
      briefing,
      objectives: criteria.map(({ id: cid, label, weight }) => ({ id: cid, label, weight })),
    }));
  }

  // ------------------------------------------------------------- lifecycle
  start(id, user) {
    const sc = this.scenarios.get(id);
    if (!sc) return `Unknown scenario ${id}`;
    if (this.active) return `Scenario ${this.active.scenario.id} is already running – abort it first`;
    const base = this.rt.snapshots.get(sc.snapshot ?? 'baseline');
    if (!base) return 'Baseline snapshot not available';

    const rt = this.rt;
    rt.restoreState(base.data);
    this.applySetup(sc.setup);
    rt.frozen = false;

    this.seq += 1;
    this.active = {
      runId: `run-${Date.now().toString(36)}-${this.seq}`,
      scenario: sc,
      user: user.username,
      startSim: rt.simTime,
      startEpoch: rt.now,
      startSeq: rt.events.seq,
      elapsed: 0,
      timer: 0,
      nextEvent: 0,
      timeline: [],
      violations: [],
      samples: 0,
      criteria: Object.fromEntries(sc.criteria.map((c) => [c.id, this.initCriterion(c)])),
      alarms: new Map(), // key → {raisedAt, ackedAt, priority, id}
      seenTrips: new Set(),
    };
    rt.events.add({ category: 'TRAINING', user: user.username, message: `Training scenario ${sc.id} "${sc.title}" started` });
    this.addTimeline('info', `Exercise started by ${user.username}`);
    return null;
  }

  applySetup(setup) {
    if (!setup) return;
    const s = this.rt.process.s;
    const vol = this.rt.process.volumes;
    if (setup.t101Level !== undefined) s.t101.V = setup.t101Level * vol.t101;
  }

  abort(reason, user) {
    if (!this.active) return 'No scenario is running';
    this.finish('aborted', reason ?? `Aborted by ${user?.username ?? 'system'}`);
    return null;
  }

  /** Record a rule violation (e.g. SIS bypass) in the running exercise. */
  violation(text) {
    if (!this.active) return;
    this.active.violations.push({ t: this.active.elapsed, text });
    this.addTimeline('violation', text);
  }

  // --------------------------------------------------------------- engine
  tick(dt) {
    const a = this.active;
    if (!a) return;
    a.timer += dt;
    if (a.timer + 1e-9 < EVAL_INTERVAL) return;
    a.timer = 0;
    a.elapsed = this.rt.simTime - a.startSim;
    this.fireEvents();
    this.sample();
    if (a.elapsed >= a.scenario.duration) this.finish('completed');
  }

  addTimeline(kind, text) {
    const a = this.active;
    a.timeline.push({ t: Math.round(a.elapsed), kind, text });
  }

  fireEvents() {
    const a = this.active;
    const events = a.scenario.events;
    while (a.nextEvent < events.length && events[a.nextEvent].at <= a.elapsed) {
      const ev = events[a.nextEvent];
      a.nextEvent += 1;
      if (ev.malfunction) {
        const mf = this.rt.malfunctions.defs.get(ev.malfunction);
        if (ev.active) this.rt.malfunctions.activate(ev.malfunction, this.rt.now);
        else this.rt.malfunctions.clear(ev.malfunction);
        // Upsets stay hidden from the trainee (no journal entry, not in the live
        // timeline) – they only learn about them from symptoms and messages.
        this.addTimeline('upset', `${ev.active ? 'Upset' : 'Recovered'}: ${mf?.name ?? ev.malfunction}`);
      }
      if (ev.message) {
        this.rt.events.add({ category: 'TRAINING', message: ev.message });
        this.addTimeline('message', ev.message);
      }
      if (ev.hint) this.addTimeline('hint', ev.hint);
    }
  }

  initCriterion(c) {
    switch (c.type) {
      case 'limit':
        return { inside: 0, total: 0, worst: null };
      case 'endValue':
        return { window: [] };
      case 'noTrip':
      case 'noAlarm':
        return { failedAt: null, what: null };
      case 'reachBy':
      case 'modeBy':
        return { metAt: null, what: null };
      default:
        return {};
    }
  }

  value(tag) {
    // Objectives are scored on the real process, not on (possibly faulty) readings.
    const v = this.rt.truth[tag];
    return Number.isFinite(v) ? v : this.rt.transmitters.get(tag)?.value;
  }

  sample() {
    const a = this.active;
    const rt = this.rt;
    a.samples += 1;
    for (const c of a.scenario.criteria) {
      const st = a.criteria[c.id];
      switch (c.type) {
        case 'limit': {
          const v = this.value(c.tag);
          if (!Number.isFinite(v)) break;
          st.total += 1;
          const ok = (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max);
          if (ok) st.inside += 1;
          if (c.max !== undefined) st.worst = st.worst === null ? v : Math.max(st.worst, v);
          else st.worst = st.worst === null ? v : Math.min(st.worst, v);
          break;
        }
        case 'endValue': {
          const v = this.value(c.tag);
          if (Number.isFinite(v)) st.window.push([a.elapsed, v]);
          while (st.window.length && st.window[0][0] < a.elapsed - (c.window ?? 60)) st.window.shift();
          break;
        }
        case 'noTrip':
          if (st.failedAt === null) {
            const tripped = c.interlocks.find((id) => {
              const il = rt.sis.get(id);
              return il?.tripped && il.trippedAt >= a.startEpoch;
            });
            if (tripped) {
              st.failedAt = a.elapsed;
              st.what = tripped;
            }
          }
          break;
        case 'noAlarm':
          if (st.failedAt === null) {
            const hit = c.alarms.find((id) => rt.alarms.states.get(id)?.active);
            if (hit) {
              st.failedAt = a.elapsed;
              st.what = hit;
            }
          }
          break;
        case 'reachBy':
          if (st.metAt === null && a.elapsed >= (c.from ?? 0) && a.elapsed <= c.by) {
            const v = this.value(c.tag);
            if (Number.isFinite(v) && (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max)) st.metAt = a.elapsed;
          }
          break;
        case 'modeBy':
          if (st.metAt === null && a.elapsed >= (c.from ?? 0) && a.elapsed <= c.by) {
            const changed = Object.entries(c.modes).find(([tag, normal]) => rt.control.get(tag)?.mode !== normal);
            if (changed) {
              st.metAt = a.elapsed;
              st.what = `${changed[0]} → ${rt.control.get(changed[0]).mode}`;
            }
          }
          break;
        default:
          break;
      }
    }
    // SIS trips on the timeline
    for (const il of rt.sis.items.values()) {
      if (il.tripped && il.trippedAt >= a.startEpoch && !a.seenTrips.has(`${il.id}@${il.trippedAt}`)) {
        a.seenTrips.add(`${il.id}@${il.trippedAt}`);
        this.addTimeline('trip', `${il.id} tripped – ${il.description}`);
      }
    }
    // Alarm response tracking
    const now = rt.now;
    for (const [id, st] of rt.alarms.states) {
      if (st.activeAt === null || st.activeAt < a.startEpoch) continue;
      const key = `${id}@${st.activeAt}`;
      let rec = a.alarms.get(key);
      if (!rec && !st.acked) {
        rec = { id, raisedAt: st.activeAt, ackedAt: null, priority: rt.alarms.defs.get(id)?.priority };
        a.alarms.set(key, rec);
      }
      if (rec && rec.ackedAt === null && (st.acked || rt.alarms.isShelved(st, now))) rec.ackedAt = now;
    }
  }

  /** Score of one criterion: {score 0..weight, passed, detail, pending?}. */
  scoreCriterion(c, final) {
    const a = this.active;
    const st = a.criteria[c.id];
    const point = this.rt.points.get(c.tag);
    const fmt = (v) => (Number.isFinite(v) ? `${v.toFixed(point?.decimals ?? 1)} ${point?.units ?? ''}`.trim() : '—');
    switch (c.type) {
      case 'limit': {
        const frac = st.total ? st.inside / st.total : 1;
        return {
          score: c.weight * frac,
          passed: frac >= 0.999,
          detail: `${Math.round(frac * 100)} % of time within limit · ${c.max !== undefined ? 'max' : 'min'} ${fmt(st.worst)}`,
        };
      }
      case 'noTrip':
      case 'noAlarm': {
        const bypass = c.type === 'noTrip' && a.violations.some((v) => /bypass/i.test(v.text));
        const ok = st.failedAt === null && !bypass;
        return {
          score: ok ? c.weight : 0,
          passed: ok,
          detail: st.failedAt !== null ? `${st.what} at ${mmss(st.failedAt)}` : bypass ? 'SIS bypassed during the exercise' : 'none',
        };
      }
      case 'alarmResponse': {
        const recs = [...a.alarms.values()];
        if (!recs.length) return { score: c.weight, passed: true, detail: 'no alarms raised' };
        const delays = recs.map((r) => (r.ackedAt === null ? Infinity : (r.ackedAt - r.raisedAt) / 1000));
        const ontime = delays.filter((d) => d <= c.target).length;
        const pendingNow = recs.filter((r) => r.ackedAt === null && (this.rt.now - r.raisedAt) / 1000 <= c.target).length;
        const counted = final ? recs.length : recs.length - pendingNow;
        const frac = counted ? ontime / counted : 1;
        const finite = delays.filter(Number.isFinite).sort((x, y) => x - y);
        const median = finite.length ? finite[Math.floor(finite.length / 2)] : null;
        return {
          score: c.weight * frac,
          passed: frac >= 0.999,
          detail: `${ontime}/${recs.length} on time${median !== null ? ` · median ${Math.round(median)} s` : ''}`,
        };
      }
      case 'endValue': {
        const vals = st.window.map((x) => x[1]);
        const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : NaN;
        const ok = Number.isFinite(avg) && (c.min === undefined || avg >= c.min) && (c.max === undefined || avg <= c.max);
        return { score: ok ? c.weight : 0, passed: ok, pending: !final, detail: `${final ? 'final' : 'now'} ${fmt(avg)}` };
      }
      case 'reachBy':
      case 'modeBy': {
        const ok = st.metAt !== null;
        const open = !final && !ok && a.elapsed <= c.by;
        return {
          score: ok ? c.weight : 0,
          passed: ok,
          pending: open,
          detail: ok ? `${st.what ? `${st.what} ` : ''}at ${mmss(st.metAt)}` : open ? `deadline ${mmss(c.by)}` : `missed – deadline ${mmss(c.by)}`,
        };
      }
      case 'endMotor': {
        const m = this.rt.motors.get(c.motor);
        const ok = m?.status === c.status;
        return { score: ok ? c.weight : 0, passed: ok, pending: !final, detail: `${c.motor} ${m?.status ?? '?'}` };
      }
      case 'endModes': {
        const parts = Object.entries(c.modes).map(([tag, mode]) => [tag, this.rt.control.get(tag)?.mode, mode]);
        const ok = parts.every(([, cur, want]) => cur === want);
        return { score: ok ? c.weight : 0, passed: ok, pending: !final, detail: parts.map(([tag, cur]) => `${tag} ${cur}`).join(', ') };
      }
      default:
        return { score: 0, passed: false, detail: 'unknown criterion' };
    }
  }

  evaluateAll(final) {
    const a = this.active;
    const criteria = a.scenario.criteria.map((c) => ({ id: c.id, label: c.label, weight: c.weight, ...this.scoreCriterion(c, final) }));
    const score = Math.round(criteria.reduce((s, c) => s + c.score, 0));
    return { criteria: criteria.map((c) => ({ ...c, score: Math.round(c.score * 10) / 10 })), score };
  }

  finish(status, reason) {
    const a = this.active;
    a.elapsed = this.rt.simTime - a.startSim;
    const { criteria, score } = this.evaluateAll(true);
    const ops = this.rt.events.since(a.startSeq).filter((e) => e.category === 'OPERATOR' || e.category === 'ENGINEER').length;
    const alarmRecs = [...a.alarms.values()];
    if (status === 'aborted') this.addTimeline('info', `Exercise aborted: ${reason}`);
    else this.addTimeline('info', `Exercise complete – score ${score}`);
    const result = {
      runId: a.runId,
      scenarioId: a.scenario.id,
      title: a.scenario.title,
      difficulty: a.scenario.difficulty,
      user: a.user,
      startedAt: a.startEpoch,
      endedAt: this.rt.now,
      duration: Math.round(a.elapsed),
      status,
      reason: reason ?? null,
      score: status === 'completed' ? score : null,
      grade: status === 'completed' ? gradeFor(score) : null,
      criteria,
      timeline: a.timeline,
      violations: a.violations,
      stats: {
        alarms: alarmRecs.length,
        acknowledged: alarmRecs.filter((r) => r.ackedAt !== null).length,
        operatorActions: ops,
        trips: a.seenTrips.size,
      },
    };
    this.results.unshift(result);
    if (this.results.length > MAX_RESULTS) this.results.length = MAX_RESULTS;
    this.version += 1;
    this.rt.events.add({
      category: 'TRAINING',
      user: a.user,
      message: status === 'completed'
        ? `Training scenario ${a.scenario.id} complete – score ${score} (${gradeFor(score)})`
        : `Training scenario ${a.scenario.id} aborted – ${reason}`,
    });
    this.active = null;
  }

  // ------------------------------------------------------------- payloads
  status() {
    const a = this.active;
    if (!a) return { active: null, version: this.version };
    const { criteria, score } = this.evaluateAll(false);
    return {
      version: this.version,
      active: {
        runId: a.runId,
        scenarioId: a.scenario.id,
        title: a.scenario.title,
        user: a.user,
        elapsed: Math.round(a.elapsed),
        duration: a.scenario.duration,
        score,
        criteria,
        timeline: a.timeline.filter((e) => e.kind !== 'upset'),
      },
    };
  }
}
