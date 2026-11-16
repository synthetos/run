import {
  PROBE_STEPS,
  type JsonValue,
  type ProbeKey,
  type Response
} from '@synthetos/protocol';
import { noteModeLine } from '../boardModes.ts';
import { observeDwellPoll } from '../dwell.ts';
import { noteHomingRead } from '../homedAxes.ts';
import { onModesAnswer } from '../modes.ts';
import { JV_LINE } from '../reports.ts';
import {
  type PendingRead,
  type ProbeProgress
} from '../types.ts';
import type { ReducerDeps } from './deps.ts';
import type { Tx } from './transaction.ts';

export interface AnswerMessage { e: PendingRead; r: Response; at: number; value: JsonValue | undefined; }

export function onAnswerSplice(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { r, value } = message;
  const { isObject, mergeLive, advanceProbe } = deps;

  let probe = t.s.probe as ProbeProgress;
  if (probe.backlog > 0) {
    t.emit({ kind: 'log', text: `probe: ${probe.backlog} line${probe.backlog === 1 ? '' : 's'} of output left unread by a previous program arrived before the first answer: discarded` });
    probe = { ...probe, backlog: 0 };
    t.set({ probe });
  }
  if (!Object.hasOwn(r.r, 'sr')) {
    // The first line was answered as G-code ({"r":{},"f":[...]}, no `sr` key): a partial line another
    // program left in the board's buffer joined it. Measured on bench 2, 2026-11-02 (PROTOCOL_NOTES
    // §2.3a): rejected when the fragment does not parse, but RUN when it ends in a comment ("G0 X0.5 (rough"
    // on edge-next and 440.21) and, with the quoted form, on 440.21. Nothing tells the two apart
    // safely, so the board may be moving: only stop-class bytes from now on (SAFETY §3).
    t.emit({ kind: 'log', text: `probe: the first line was answered as G-code (no "sr" key, status ${r.footer.status}): a leftover partial line in the board's buffer joined it and may have run → ORPHANED_MOTION` });
    t.addOverlay('ORPHANED_MOTION');
    t.set({ queue: [] });
    return;
  }
  if (r.footer.status === 0) {
    if (isObject(value)) {
      mergeLive(t, value);
      t.set({ live: { ...t.s.live, srList: Object.freeze(Object.keys(value)) } });
    }
    advanceProbe(t, { ...probe, next: 1 });
  } else if (!probe.spliceRetried) {
    // A spliced fragment was rejected: send `{sr:null}` once more before continuing (PN §2.3 step 0).
    t.set({ probe: { ...probe, spliceRetried: true }, queue: [{ token: 'sr', purpose: 'splice' }, ...t.s.queue] });
  } else {
    advanceProbe(t, { ...probe, next: 1 });
  }
  return;

}

export function onAnswerProbe(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { e, r } = message;
  const { advanceProbe } = deps;

  const probe = t.s.probe as ProbeProgress;
  // OD-14: the first identity GET answered with no value at all (JSON verbosity below 3): the board can be read
  // only after its jv is raised. Write {jv:4} once (persisted; its own reply means the write is done), wait the
  // firmware's 50 ms EEPROM margin, then identify again from the top (TinyG maintainer, 2026-11-04).
  if (e.token === 'fb' && r.footer.status === 0 && Object.keys(r.r).length === 0 && !probe.normalized && t.config.release.reports === true && [1, 3, 4].includes(t.s.live.stat ?? -1)) {
    t.set({ probe: { ...probe, normalized: true, normalizing: true }, queue: [{ token: 'jv', purpose: 'normalize', line: JV_LINE }] });
    t.emit({ kind: 'log', text: 'probe: the board answered with no values (JSON verbosity below 3): Run sets jv to 4 (saved on the board) and identifies it again' });
    return;
  }
  advanceProbe(t, { ...probe, next: probe.next + 1, answers: [...probe.answers, [e.token as ProbeKey, r]] });
  return;

}

export function onAnswerNormalize(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { r } = message;
  const { advanceProbe, NORMALIZE_SETTLE_MS } = deps;

  const probe = t.s.probe as ProbeProgress;
  if (r.footer.status !== 0) {
    t.emit({ kind: 'log', text: `probe: the board refused {jv:4} (status ${r.footer.status}): it stays unidentified` });
    t.set({ probe: { ...probe, normalizing: false } });
    advanceProbe(t, { ...probe, normalizing: false, next: PROBE_STEPS.length, answers: probe.answers });
    return;
  }
  t.emit({ kind: 'log', text: 'probe: jv is 4 (saved on the board); identifying the board again' });
  t.set({ probe: { ...probe, normalizing: false, settling: 'ready' } });
  t.arm('settle', NORMALIZE_SETTLE_MS);
  return;

}

export function onAnswerReading(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { e, r, value } = message;
  const { withNumber, finishReading } = deps;

  if (r.footer.status === 0 && typeof value === 'number' && Number.isFinite(value)) {
    t.set({ live: withNumber(t, t.s.live, e.token, value) });
  }
  if (!t.s.queue.some((q) => q.purpose === 'reading')) finishReading(t);
  return;
}

export function onAnswerRequest(t: Tx, message: AnswerMessage, _deps: ReducerDeps): void {
  const { e, r, at, value } = message;

  t.set({ values: { ...t.s.values, [e.token]: { value: value ?? null, status: r.footer.status, at } } });
  noteHomingRead(t, e.token, r.footer.status, value); // S1
  return;
}

export function onAnswerVerify(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { e, r, value } = message;
  const { onVerifyAnswer } = deps;

  onVerifyAnswer(t, e.token, r.footer.status === 0 && typeof value === 'number' ? value : undefined);
  return;
}

export function onAnswerLiveness(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { e, r, value } = message;
  const { withNumber } = deps;

  // The answer itself is the proof of life (already recorded on receipt); keep the value it carries.
  if (r.footer.status === 0 && typeof value === 'number') t.set({ live: withNumber(t, t.s.live, e.token, value) });
  return;
}

export function onAnswerPoll(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { e, r, value } = message;
  const { withNumber, features } = deps;

  const ok = r.footer.status === 0 && typeof value === 'number' && Number.isFinite(value);
  if (ok) t.set({ live: withNumber(t, t.s.live, e.token, value) });
  // The cycle's own record (independent review 2026-11-03, R5): a new one at its first read, each later read
  // added only when answered with status 0; a rejected answer fails the whole cycle. The motion and job layers
  // confirm from this record, never from the live view, and it is dropped once the cycle has been judged.
  if ((features.POLL_TOKENS ?? []).includes(e.token)) {
    const cycle = e.token === features.POLL_TOKENS?.[0] || t.s.polled === null ? { failed: false } : t.s.polled;
    t.set({ polled: ok ? { ...cycle, [e.token]: value as number } : { ...cycle, failed: true } });
  }
  noteHomingRead(t, e.token, r.footer.status, value); // S1: a home of 0 forgets the axes homed here
  if (e.token === 'home' && (t.s.base === 'IDLE_HOMED' || t.s.base === 'IDLE_UNHOMED')) t.set({ base: features.idleBase?.(t.s) ?? 'CONNECTED_UNKNOWN' });
  completePoll(t, message, deps);
}

export function onAnswerMotion(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { e, r, at } = message;
  const { features } = deps;

  noteModeLine(t, e.line, r.footer.status);
  // OD-19 (S1): the G90 after a Clear alarm, on its own intent, whatever motion started meanwhile.
  if (e.intent === 'alarmRestore') {
    features.onAlarmRestoreAnswered?.(t, e.line, r.footer.status, at);
    return;
  }
  if (!features.onJobMotionAnswer?.(t, e.line, r.footer.status, at)) features.onMotionAnswer?.(t, e.line, r.footer.status, at);
  return;
}

export function onAnswerJob(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { e, r, at } = message;
  const { features } = deps;

  features.onJobAnswer?.(t, e, r, at);
  return;
}

export function onAnswerJobPrep(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { e, r, at } = message;
  const { features } = deps;

  features.onJobPrepAnswer?.(t, e, r, at);
  return;
}

export function onAnswerLineMode(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { r, at } = message;
  const { features } = deps;

  features.onLineModeAnswer?.(t, r, at);
  return;
}

export function onAnswerJobRuntime(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { e, r, at } = message;
  const { features } = deps;

  features.onJobRuntimeAnswer?.(t, e, r, at);
  return;
}

export function onAnswerGate(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { e, r } = message;
  const { onGateAnswer } = deps;

  onGateAnswer(t, e.token, r);
  return;
}

export function onAnswerBootGate(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { e, r } = message;
  const { onBootGateAnswer } = deps;

  onBootGateAnswer(t, e.token, r);
  return;
}

export function onAnswerSetting(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { r } = message;
  const { onSettingAnswer } = deps;

  onSettingAnswer(t, r);
  return;
}

export function onAnswerReadback(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { r, at } = message;
  const { onReadBackAnswer } = deps;

  onReadBackAnswer(t, r, at);
  return;
}

export function onAnswerSeed(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { e, r, at } = message;
  const { onSeedAnswer } = deps;

  onSeedAnswer(t, e, r, at);
  return;
}

export function onAnswerReport(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { r, at } = message;
  const { onReportAnswer } = deps;

  onReportAnswer(t, r, at);
  return;
}

export function onAnswerProbeZ(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { e, r, at } = message;
  const { features } = deps;

  noteModeLine(t, e.line, r.footer.status);
  features.onProbeAnswer?.(t, e, r, at);
  return;
}

export function onAnswerModes(t: Tx, message: AnswerMessage, _deps: ReducerDeps): void {
  const { e, r } = message;

  onModesAnswer(t, e, r.footer.status === 0 ? r.r[e.token] : undefined);
  return;
}

function completePoll(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { e, at } = message;
  const { features } = deps;
  if (e.token === 'qr') observeDwellPoll(t, (features.completedPoll?.(t.s) ?? null), at);
  if (e.token === 'qr' && features.checkAlarm?.(t, at)) {
    features.onPollDone?.(t, at);
    features.onJobPoll?.(t, at);
    features.onProbePoll?.(t, at);
  }
  if (e.token === 'qr') t.set({ polled: null }); // the cycle has been judged: the next starts its own record
  return;

}
