/**
 * Probe Z: the run, from the owner's Start to the result (SAFETY §4.5c "The probe", "Setting Z", "Stops"; H90;
 * T-S130, T-S131). `G21`, then `G91 G38.2 Z-<depth> F<feed>`, each answered before the next; the `G38.2`'s reply
 * is not completion. The outcome is the unsolicited `{"prb":...}` report, the board's alarm and polled `stat`;
 * only `e`=1 at rest, with no Pause or Stop job since the start, sets Z. Nothing is retried.
 */
import type { Exception, JsonValue, ProbeReport, Response } from '@synthetos/protocol';
import { activeSystem, atRestPolled, completedPoll, requestPoll, type MotionDeps } from '../motion.ts';
import { UNITS_LINE } from '../motionLines.ts';
import type { Expected, Identity, PendingRead, SessionIntent } from '../types.ts';
import { dropQueuedLines, finish, probePending, probeWritten, queueLine, queueRead, restoreThen, runProbeLine, setProbe, setRun, tick, zeroWritten, type ProbeTx } from './common.ts';
import { probeInput } from './gate.ts';
import { PROBE_LIMITS } from './limits.ts';
import { SETTING_TOKENS, SWITCH_TOKENS, probeRunning, type ProbeRun, type ProbeSettings } from './state.ts';
import { readingOf, touchPassed, touchStep, touchTimeProblem } from './touch.ts';
import type { ProbeOutcome, ProbePlan } from './types.ts';
import { READBACK_TOKENS, takeReadback, zeroConfirmed, zeroLine } from './zero.ts';

/** The alarms a probe can end in (firmware facts): no contact or already tripped, soft limit, a limit input, ^D. */
const PROBE_ALARMS: ReadonlySet<number> = new Set([250, 220, 203, 207]);

/** The first build whose report is in machine mm (before: work coordinates in current units). */
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

/** Travel from the start to the reported Z, mm, in the report's frame. Null when either is unknown. */
function travelMm(t: ProbeTx, reportZ: number | null): number | null {
  const r = run(t);
  // A run exists only on an identified 450.02+ board (gate.ts probeFirmware).
  const from = ((t.s.identity as Identity).fb as number) >= MACHINE_FRAME_FB ? r.fromMpo : r.fromPos;
  return from === null || reportZ === null ? null : Math.max(0, from - reportZ);
}

/** The outcome after Pause or Stop job, which always wins: nothing is zeroed after either (H90 mitigation 3). */
function stopOutcome(r: ProbeRun): ProbeOutcome | null {
  if (r.stopped === 'stopJob') return { kind: 'stopJob', status: 207 };
  if (r.stopped === 'pause') return { kind: 'paused' };
  return null;
}

// --- Answers ------------------------------------------------------------------

/** An answer to one of the probe's lines or reads. */
export function onProbeAnswer(t: ProbeTx, e: PendingRead, r: Response, at: number): void {
  if (e.line !== undefined) onLineAnswer(t, e.line, r.footer.status, at);
  else onRead(t, e.token, r.footer.status === 0 ? r.r[e.token] : undefined, at);
}

function onLineAnswer(t: ProbeTx, line: string, status: number, at: number): void {
  const p = t.s.probeZ;
  // A run has a plan; a line's answer owed to a run that has ended is dropped with it (a lost link or a fault).
  /* c8 ignore next */
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
      restoreThen(t, { kind: 'refused', status, text: refusalText(status) });
    }
    return;
  }
  // The zero (§4.5c "Setting Z"): answered, then the EEPROM wait before the read-back.
  if (status === 0) {
    setRun(t, { zero: 'settle', settleUntil: at + PROBE_LIMITS.zeroSettleMs });
    tick(t);
  } else {
    restoreThen(t, { kind: 'zeroRefused', status, text: refusalText(status) });
  }
}

/** A read of the input, the settings or the zero's read-back; `value` undefined when refused, damaged or unread. */
function onRead(t: ProbeTx, token: string, value: JsonValue | undefined, at: number): void {
  const p = t.s.probeZ;
  if (SETTING_TOKENS.includes(token)) {
    const settings = takeSetting(p.settings, token, value, t.s.live.unit);
    setProbe(t, { settings, ...(p.refreshing && token === SETTING_TOKENS.at(-1) ? { refreshing: false } : {}) });
    return;
  }
  if (READBACK_TOKENS.includes(token)) {
    const r = p.run;
    if (r === null || r.zero !== 'readback') return;
    setRun(t, { readback: takeReadback(r.readback, token, value) });
    if (token !== READBACK_TOKENS.at(-1)) return;
    const plan = p.plan as ProbePlan;
    const system = activeSystem(t.s);
    // Pause or Stop job pressed while the zero was in flight: the zero may or may not be set, so none is claimed.
    const confirmed = r.stopped === null && system !== null && zeroConfirmed(run(t).readback, system, plan);
    restoreThen(t, confirmed ? { kind: 'contactZeroSet', zeroZ: plan.zeroZ, travelMm: travelMm(t, (r.report as NonNullable<ProbeRun['report']>).z) ?? 0, stopMm: plan.stopMm } : { kind: 'zeroUnconfirmed' });
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

/** A poll cycle completed: the check before the first line, or the rest after a contact before the zero. */
export function onProbePoll(t: ProbeTx, at: number): void {
  const p = t.s.probeZ;
  const r = p.run;
  if (r === null) return;
  const polled = completedPoll(t.s);
  const resting = polled !== null && atRestPolled(t.s, polled);
  if (p.step === 'starting' && !r.checked) {
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
    setRun(t, { zero: 'line' });
    queueLine(t, zeroLine(system, p.plan as ProbePlan));
  }
}

/** The unsolicited `{"prb":...}` report (§4.5c): `e`=1 is contact, anything else is not. */
export function onProbeReport(t: ProbeTx, report: ProbeReport, at: number): void {
  const p = t.s.probeZ;
  const r = p.run;
  if (r === null || (p.step !== 'starting' && p.step !== 'probing')) {
    t.emit({ kind: 'log', text: `probe Z: a probe report arrived with no probe running: ${report.line.slice(0, 80)}` });
    return;
  }
  const z = report.prb['z'];
  setRun(t, { report: { e: report.e, z: typeof z === 'number' ? z : null } });
  if (report.e === 0) return; // ALARM 250 follows the report: that is the outcome
  const stopped = stopOutcome(r);
  // A contact with Pause pressed raises no alarm; with Stop job pressed the ^D's 207 is still to come.
  if (stopped !== null) {
    if (r.stopped === 'pause') setProbe(t, { alarmExpected: false });
    finish(t, stopped, at);
    return;
  }
  // Contact: no alarm will follow. Wait for the machine at rest by two polled reads, then set Z.
  setProbe(t, { step: 'zeroing', alarmExpected: false });
  requestPoll(t);
  tick(t);
}

/**
 * An `er` from the board. Returns true when it is the probe's own alarm (the outcome, never a FAULT): one of the
 * probe's statuses while its `G38.2` may still be running or after its ^D.
 */
export function onProbeAlarm(t: ProbeTx, event: Exception, at: number): boolean {
  const p = t.s.probeZ;
  if (!p.alarmExpected || !PROBE_ALARMS.has(event.st)) return false;
  setProbe(t, { alarmExpected: false });
  const r = p.run;
  t.emit({ kind: 'log', text: `probe Z: the board alarmed with status ${event.st}: ${event.msg.slice(0, 80)}` });
  // After the zero went out, a Stop job's alarm does not end the sequence: the read-back and the restore still run,
  // and the result never claims the zero (see onRead).
  if (r === null || zeroWritten(t.s)) return true;
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

// --- Timer, stops, the link ---------------------------------------------------------

/** The `probe` timer: the input poll every 150 ms, the touch test's time limits, the report's time limit, the EEPROM wait. */
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
  // The time limit covers the move and, after a contact, the wait for the machine at rest before the zero.
  if (r !== null && (p.step === 'probing' || (p.step === 'zeroing' && r.zero === null)) && r.deadline !== null && at > r.deadline) {
    finish(t, { kind: 'noReport' }, at);
    return;
  }
  if (r !== null && p.step === 'zeroing') {
    if (r.zero === null) requestPoll(t);
    if (r.zero === 'settle' && at >= (r.settleUntil as number)) {
      setRun(t, { zero: 'readback', readback: {} });
      for (const token of READBACK_TOKENS) queueRead(t, token);
      return;
    }
    if (r.zero === null || r.zero === 'settle') tick(t);
    return;
  }
  const input = probeInput(p.settings);
  if (input !== null && !probePending(t.s, (e) => e.token === input.token)) queueRead(t, input.token);
  tick(t);
}

/**
 * Pause, Stop job and Spindle off while the probe runs (§4.5c "Stops"; never gated): Pause writes `!` (it ends the
 * cycle, so Resume is never offered), Stop job and Spindle off write ^D (ALARM 207). Lines not yet written are
 * dropped. Returns false when no probe is running (the ordinary stop handles it).
 */
export function onProbeStop(t: ProbeTx, request: SessionIntent, at: number): boolean {
  const p = t.s.probeZ;
  const r = p.run;
  if (!probeRunning(p.step) || r === null || (request.intent === 'feedhold' && 'release' in request)) return false;
  const kill = request.intent !== 'feedhold';
  const realtime = t.s.dialect?.realtime;
  /* c8 ignore next -- a probe runs only on edge-next, which has both bytes */
  if (realtime === undefined || realtime.kill === undefined) return false;
  // Once the zero has gone to the transport it may be set: its read-back still runs, but no zero is claimed (H90 mitigation 3).
  const zeroOut = zeroWritten(t.s);
  const moved = probeWritten(t.s);
  if (!zeroOut) dropQueuedLines(t);
  t.set({ sent: { ...t.s.sent, realtime: t.s.sent.realtime + 1 }, notices: { ...t.s.notices, pauseRequestedAt: at } });
  t.emit({ kind: 'writeRealtime', epoch: t.s.epoch, name: kill ? 'kill' : 'feedhold', byte: kill ? realtime.kill.byte : realtime.feedhold.byte, intent: request.intent });
  if (r.stopped !== 'stopJob') setRun(t, { stopped: kill ? 'stopJob' : 'pause' });
  if (kill) setProbe(t, { alarmExpected: true });
  // Nothing moved yet (the probe move never went out), or the machine was at rest before the zero: that is the result.
  if (!zeroOut && (!moved || p.step === 'zeroing')) finish(t, kill ? { kind: 'stopJob', status: 207 } : { kind: 'paused' }, at);
  return true;
}

/** The link dropped or a FAULT latched while the probe ran: what is known is said, nothing more is sent. */
export function abandonProbe(t: ProbeTx, why: 'lost' | 'fault', at: number): void {
  const p = t.s.probeZ;
  if (why === 'lost') setProbe(t, { alarmExpected: false });
  if (!probeRunning(p.step)) return;
  const zeroing = p.step === 'zeroing' && p.run?.zero !== null;
  const outcome: ProbeOutcome = why === 'lost' ? { kind: 'lost', during: zeroing ? 'zero' : 'probe' } : zeroing ? { kind: 'zeroUnconfirmed' } : { kind: 'noReport' };
  finish(t, outcome, at);
}

/**
 * One of the probe's lines can no longer be written (the matrix refuses it: an alarm, STALE): it is dropped. Putting
 * the modes back is skipped (a board in alarm refuses lines anyway); a probe or zero line not sent is said plainly.
 */
export function onProbeLineDropped(t: ProbeTx, line: string, at: number): void {
  t.set({ queue: t.s.queue.filter((q) => !(q.purpose === 'probeZ' && q.line === line)) });
  const r = t.s.probeZ.run;
  if (r === null) return;
  const text = 'Not sent: the machine left the state that allows it.';
  if (r.zero === 'restore') finish(t, r.pending as ProbeOutcome, at);
  else if (r.zero === 'line') finish(t, { kind: 'zeroRefused', status: 0, text }, at);
  else finish(t, { kind: 'refused', status: 0, text }, at);
}

/** One of the probe's answers timed out (the link goes STALE). */
export function onProbeMissed(t: ProbeTx, missed: Expected, at: number): void {
  const p = t.s.probeZ;
  if (p.run === null) {
    if (SETTING_TOKENS.includes(missed.token) && p.refreshing) setProbe(t, { refreshing: false });
    return;
  }
  if (missed.line === undefined && !READBACK_TOKENS.includes(missed.token)) return; // the input poll asks again
  if (p.run.zero === 'restore') finish(t, p.run.pending as ProbeOutcome, at);
  else if (p.run.zero !== null) finish(t, { kind: 'zeroUnconfirmed' }, at);
  else finish(t, { kind: 'noReport' }, at);
}

/** One of the probe's answers arrived damaged: a line's is a FAULT (nothing shows whether it ran), a read's counts as unread. */
export function onProbeGarbled(t: ProbeTx, deps: MotionDeps, entry: Expected, at: number): void {
  if (entry.line !== undefined) deps.fault(t, 'unexpectedResponse', 'integrity', `the answer to a probe line (${entry.line}) arrived damaged`, at);
  else onRead(t, entry.token, undefined, at);
}
