/**
 * Probe Z: the run, from the owner's Start to the result (SAFETY §4.5c "The probe", "Setting Z"; H90; T-S130,
 * T-S131). `G21`, then `G91 G38.2 Z-<depth> F<feed>`, each answered before the next; the `G38.2`'s reply is not
 * completion. The outcome is the unsolicited `{"prb":...}` report, the board's alarm and polled `stat`; only `e`=1
 * at rest, with no Pause or Stop job since the start, sets Z. Nothing is retried. Stops and the link: stops.ts.
 */
import type { Exception, JsonValue, ProbeReport, Response } from '@synthetos/protocol';
import { activeSystem, atRestPolled, completedPoll, requestPoll } from '../motion.ts';
import { UNITS_LINE } from '../motionLines.ts';
import type { Identity, PendingRead } from '../types.ts';
import { finish, probePending, probeWritten, queueLine, queueRead, restoreThen, runProbeLine, setProbe, setRun, stopOutcome, tick, writeStop, zeroWritten, type ProbeTx } from './common.ts';
import { probeInput } from './gate.ts';
import { PROBE_LIMITS } from './limits.ts';
import { SETTING_TOKENS, SWITCH_TOKENS, type ProbeRun, type ProbeSettings } from './state.ts';
import { readingOf, touchPassed, touchStep, touchTimeProblem } from './touch.ts';
import type { ProbeOutcome, ProbePlan } from './types.ts';
import { LAST_READBACK, isReadback, readbackTokens, takeReadback, zeroConfirmed, zeroLine } from './zero.ts';

/** The alarms a probe can end in (firmware facts): no contact or already tripped, soft limit, a limit input, ^D. */
const PROBE_ALARMS: ReadonlySet<number> = new Set([250, 220, 203, 207]);

/** The first build whose report is in machine mm (before: work coordinates in current units, mm after our G21). */
const MACHINE_FRAME_FB = 450.03;

/** The firmware's own words for the reply-only refusals (EN error.h:368-371, stat_251..stat_254). */
const REFUSAL_TEXT: Readonly<Record<number, string>> = {
  251: 'Probe travel is too small',
  252: 'No probe switch configured',
  253: 'Multiple probe switches configured',
  254: 'Probe switch configured on ABC axis',
};

function refusalText(status: number): string {
  return REFUSAL_TEXT[status] ?? `The controller refused it (status ${status}).`;
}

function run(t: ProbeTx): ProbeRun {
  return t.s.probeZ.run as ProbeRun;
}

/** Travel from the start to the reported Z, mm on both sides (the start was taken in mm, the report follows our G21). */
function travelMm(t: ProbeTx, reportZ: number | null): number | null {
  const r = run(t);
  // A run exists only on an identified 450.02+ board (gate.ts probeFirmware).
  const from = ((t.s.identity as Identity).fb as number) >= MACHINE_FRAME_FB ? r.fromMpo : r.fromPos;
  return from === null || reportZ === null ? null : Math.max(0, from - reportZ);
}

// --- Answers ------------------------------------------------------------------

/** An answer to one of the probe's lines or reads. */
export function onProbeAnswer(t: ProbeTx, e: PendingRead, r: Response, at: number): void {
  if (e.line !== undefined) {
    onLineAnswer(t, e.line, r.footer.status, at);
    return;
  }
  // The zero's read-back is also the session's own read of those values, as after any set zero.
  if (isReadback(e.token)) keepValue(t, e.token, r.r[e.token], r.footer.status, at);
  onRead(t, e.token, r.footer.status === 0 ? r.r[e.token] : undefined, at);
}

function keepValue(t: ProbeTx, token: string, value: JsonValue | undefined, status: number, at: number): void {
  t.set({ values: { ...t.s.values, [token]: { value: value ?? null, status, at } } });
  if (status !== 0) return;
  if (token === 'coor' && typeof value === 'number') t.set({ live: { ...t.s.live, coor: value } });
  if (token === 'pos' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const pos: Record<string, number> = { ...t.s.live.pos };
    for (const [axis, v] of Object.entries(value)) if (typeof v === 'number' && Number.isFinite(v)) pos[axis] = v;
    t.set({ live: { ...t.s.live, pos } });
  }
}

function onLineAnswer(t: ProbeTx, line: string, status: number, at: number): void {
  const p = t.s.probeZ;
  // A line's answer owed to a run that has ended is dropped with it.
  if (p.run === null) return;
  const r = p.run;
  const plan = p.plan as ProbePlan;
  if (r.zero === 'restore') {
    finish(t, r.pending as ProbeOutcome, at);
    return;
  }
  if (line === UNITS_LINE) {
    if (status !== 0) finish(t, { kind: 'refused', status, text: refusalText(status) }, at);
    else if (r.stopped === null && !r.sent) {
      queueLine(t, runProbeLine(plan));
      setRun(t, { sent: true });
      setProbe(t, { alarmExpected: true });
    }
    return;
  }
  if (line === runProbeLine(plan)) {
    // Status 0 only says the move was accepted: the outcome is still to come, within the time limit.
    if (status === 0) {
      setProbe(t, { step: 'probing' });
      setRun(t, { deadline: at + plan.maxSeconds * 1000 });
    } else {
      setProbe(t, { alarmExpected: false });
      restoreThen(t, { kind: 'refused', status, text: refusalText(status) }, at);
    }
    return;
  }
  // The zero (§4.5c "Setting Z"): answered, then the EEPROM wait before the read-back.
  if (status === 0) {
    setRun(t, { zero: 'settle', settleUntil: at + PROBE_LIMITS.zeroSettleMs });
    tick(t);
  } else {
    restoreThen(t, { kind: 'zeroRefused', status, text: refusalText(status) }, at);
  }
}

/** A read of the input, the settings or the zero's read-back; `value` undefined when refused, damaged or unread. */
export function onRead(t: ProbeTx, token: string, value: JsonValue | undefined, at: number): void {
  const p = t.s.probeZ;
  if (SETTING_TOKENS.includes(token)) {
    const settings = takeSetting(p.settings, token, value, t.s.live.unit);
    setProbe(t, { settings, ...(p.refreshing && token === SETTING_TOKENS.at(-1) ? { refreshing: false } : {}) });
    return;
  }
  if (isReadback(token)) {
    const r = p.run;
    if (r === null || r.zero !== 'readback') return;
    setRun(t, { readback: takeReadback(r.readback, token, value) });
    if (token !== LAST_READBACK) return;
    const plan = p.plan as ProbePlan;
    // Pause or Stop job pressed while the zero was in flight: the zero may or may not be set, so none is claimed.
    const confirmed = r.stopped === null && zeroConfirmed(run(t).readback, r.system as number, plan);
    restoreThen(t, confirmed ? { kind: 'contactZeroSet', zeroZ: plan.zeroZ, travelMm: travelMm(t, (r.report as NonNullable<ProbeRun['report']>).z) ?? 0, stopMm: plan.stopMm } : { kind: 'zeroUnconfirmed' }, at);
    return;
  }
  onInput(t, readingOf(value), at);
}

function takeSetting(settings: ProbeSettings, token: string, value: JsonValue | undefined, unit: number | undefined): ProbeSettings {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : null;
  const switchIndex = SWITCH_TOKENS.indexOf(token);
  if (switchIndex >= 0) return { ...settings, modes: settings.modes.map((m, i) => (i === switchIndex ? n : m)) };
  if (token === 'prbp') return { ...settings, prbp: n };
  // `zjh` is converted to inches in G20 (EN config_app.c:313, _fipc): back to mm, or unread when the units are not known.
  return { ...settings, zjh: n === null || (unit !== 0 && unit !== 1) ? null : unit === 0 ? n * 25.4 : n };
}

/** One reading of the probe input: the live words, and the touch test's marks. */
function onInput(t: ProbeTx, reading: ReturnType<typeof readingOf>, at: number): void {
  const p = t.s.probeZ;
  setProbe(t, { reading, readingAt: at });
  if (p.step !== 'touch') return;
  const touch = touchStep(p.touch, reading);
  if (touch === p.touch) return;
  const passed = touchPassed(touch);
  setProbe(t, { touch, touchAt: at, ...(passed ? { step: 'ready', passedAt: at } : {}) });
  if (touch.problem !== null) t.cancel('probe');
}

// --- Polls, reports, alarms ---------------------------------------------------------

/**
 * A poll cycle completed: after Pause, `!` again while the probe cycle runs without a hold (edge-next ignores `!`
 * before the cycle moves; motion.ts does the same for jogs); the check before the first line; the rest after a contact.
 */
export function onProbePoll(t: ProbeTx, at: number): void {
  const p = t.s.probeZ;
  const r = p.run;
  if (r === null) return;
  const polled = completedPoll(t.s);
  const resting = polled !== null && atRestPolled(t.s, polled);
  if (r.stopped === 'pause') {
    const byte = (t.s.dialect as NonNullable<typeof t.s.dialect>).realtime.feedhold.byte;
    if (polled !== null && polled.hold === 0 && (polled.stat === 7 || p.step === 'probing')) writeStop(t, 'feedhold', 'feedhold', byte);
  } else if (r.stopped !== null) {
    // After Stop job nothing more is sent: its ALARM 207 (or the time limit) ends the run.
  } else if (p.step === 'starting' && !r.checked) {
    // §4.5c preconditions: IDLE at rest by polled values, right before the first line.
    if (resting) {
      setRun(t, { checked: true });
      queueLine(t, UNITS_LINE);
    } else if (polled !== null) finish(t, { kind: 'refused', status: 0, text: 'The machine was not at rest, so nothing was sent.' }, at);
    else requestPoll(t);
  } else if (p.step === 'zeroing' && r.zero === null) {
    const confirmed = resting ? r.confirmed + 1 : 0;
    setRun(t, { confirmed });
    const system = activeSystem(t.s);
    if (confirmed < 2 || system === null) return;
    setRun(t, { zero: 'line', system });
    queueLine(t, zeroLine(system, p.plan as ProbePlan));
  }
}

/** The unsolicited `{"prb":...}` report (§4.5c): `e`=1 is contact, anything else is not. Only after our `G38.2` went out. */
export function onProbeReport(t: ProbeTx, report: ProbeReport, at: number): void {
  const p = t.s.probeZ;
  const r = p.run;
  if (r === null || (p.step !== 'starting' && p.step !== 'probing') || !probeWritten(t.s)) {
    t.emit({ kind: 'log', text: `probe Z: a probe report arrived with no probe move of ours out: ${report.line.slice(0, 80)}` });
    return;
  }
  const z = report.prb['z'];
  setRun(t, { report: { e: report.e, z: typeof z === 'number' ? z : null } });
  if (report.e === 0) return; // ALARM 250 follows the report: that is the outcome
  // A contact with Pause pressed raises no alarm; with Stop job pressed the ^D's 207 is still to come.
  if (r.stopped === 'pause') finish(t, { kind: 'paused' }, at);
  if (r.stopped !== null) return;
  // Contact: no alarm will follow. Wait for the machine at rest by two polled reads, then set Z.
  setProbe(t, { step: 'zeroing', alarmExpected: false });
  requestPoll(t);
  tick(t);
}

/**
 * An `er` from the board. Returns true when it is the probe's own alarm (the outcome, never a FAULT): one of the
 * probe's statuses during its run, while its `G38.2` may still be running or after its ^D.
 */
export function onProbeAlarm(t: ProbeTx, event: Exception, at: number): boolean {
  const p = t.s.probeZ;
  const r = p.run;
  if (!p.alarmExpected || r === null || !PROBE_ALARMS.has(event.st)) return false;
  setProbe(t, { alarmExpected: false });
  t.emit({ kind: 'log', text: `probe Z: the board alarmed with status ${event.st}: ${event.msg.slice(0, 80)}` });
  // After the zero went out, a Stop job's alarm does not end the read-back; no zero is claimed (see onRead).
  if (zeroWritten(t.s)) return true;
  const outcome: ProbeOutcome =
    stopOutcome(r) ??
    (event.st === 250
      ? { kind: /already tripped/i.test(event.msg) ? 'alreadyTripped' : 'noContact', travelMm: travelMm(t, r.report?.z ?? null), status: 250 }
      : event.st === 220
        ? { kind: 'softLimit', status: 220 }
        : event.st === 203
          ? { kind: 'limit', status: 203 }
          : { kind: 'stopJob', status: 207 });
  finish(t, outcome, at, true);
  return true;
}

// --- Timer -----------------------------------------------------------------------

/** A run out of time: the stop when one was pressed, no report once the probe move may have run, else not sent. */
function timeUp(t: ProbeTx, at: number): void {
  const stopped = stopOutcome(run(t));
  if (stopped !== null) finish(t, stopped, at);
  else if (probeWritten(t.s)) finish(t, { kind: 'noReport' }, at);
  else finish(t, { kind: 'refused', status: 0, text: 'The board did not answer in time, so the probe move was not sent.' }, at);
}

/** The `probe` timer: the input poll every 150 ms, the touch test's time limits, the run's time limits, the EEPROM wait. */
export function onProbeTimer(t: ProbeTx, at: number): void {
  const p = t.s.probeZ;
  if (p.step === 'touch' || p.step === 'ready') {
    if (p.block !== null || p.refreshing || p.touch.problem !== null) {
      if (p.refreshing) tick(t);
      return;
    }
    const problem = touchTimeProblem(p.touchAt ?? at, p.passedAt, at);
    if (problem === 'noChange') setProbe(t, { touch: { ...p.touch, problem } });
    if (problem === 'timedOut') setProbe(t, { step: 'touch', touch: { ...p.touch, problem }, passedAt: null });
    if (problem !== null) return;
    if (p.touchAt === null) setProbe(t, { touchAt: at });
  }
  const r = p.run;
  // The time limit covers the start, the move and, after a contact, the wait for the machine at rest before the zero.
  if (r !== null && (p.step !== 'zeroing' || r.zero === null) && r.deadline < at) {
    timeUp(t, at);
    return;
  }
  if (r !== null && p.step === 'zeroing') {
    if (r.zero === null) requestPoll(t);
    if (r.zero === 'settle' && at >= (r.settleUntil as number)) {
      setRun(t, { zero: 'readback', readback: {} });
      for (const token of readbackTokens(r.system as number)) queueRead(t, token);
      return;
    }
    if (r.zero === null || r.zero === 'settle') tick(t);
    return;
  }
  // After Pause: a polled cycle every tick shows whether the cycle took the hold (onProbePoll sends `!` again).
  if (r?.stopped === 'pause') requestPoll(t);
  const input = probeInput(p.settings);
  if (input !== null && !probePending(t.s, (e) => e.token === input.token)) queueRead(t, input.token);
  tick(t);
}
