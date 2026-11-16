import {
  type JsonValue,
  type Response
} from '@synthetos/protocol';
import { acknowledgeDwell } from '../dwell.ts';
import {
  type Expected,
  type PendingRead,
  type SessionState
} from '../types.ts';
import { onAnswerBootGate, onAnswerGate, onAnswerJob, onAnswerJobPrep, onAnswerJobRuntime, onAnswerLineMode, onAnswerLiveness, onAnswerModes, onAnswerMotion, onAnswerNormalize, onAnswerPoll, onAnswerProbe, onAnswerProbeZ, onAnswerReadback, onAnswerReading, onAnswerReport, onAnswerRequest, onAnswerSeed, onAnswerSetting, onAnswerSplice, onAnswerVerify, type AnswerMessage } from './answerCases.ts';
import type { ReducerDeps } from './deps.ts';
import type { Tx } from './transaction.ts';

/** Pure transition handlers: only the local transaction changes; all I/O remains ordered effects. */
export function onResponse(t: Tx, message: { r: Response; at: number; }, deps: ReducerDeps): void {
  const { r, at } = message;
  const { enterFault, owedAnswers, isDataEntry, consumeOwed, onAnswer } = deps;
  if (answerBeforeReset(t)) return; // answers a line from before the reset
  if (t.s.footerRev === undefined) {
    t.set({ footerRev: r.footer.rev });
  } else if (r.footer.rev !== t.s.footerRev) {
    // H77: the answer to the line-mode write carries the new footer (revision 3 in line mode, 2 in character mode).
    const expect = t.s.rxm.footerExpect;
    if (expect === null || r.footer.rev !== expect || t.s.rxm.step?.kind !== 'write') {
      enterFault(t, 'footerRevisionChanged', 'integrity', `the footer revision changed from ${t.s.footerRev} to ${r.footer.rev}: the board was reset or reconfigured`, at);
      return;
    }
    t.set({ footerRev: r.footer.rev, rxm: { ...t.s.rxm, footerExpect: null } });
    t.emit({ kind: 'log', text: `line mode: the footer is now revision ${r.footer.rev}` });
  }
  // Line mode (H76): f[2] is the free line slots, in every answer.
  updateFreeSlots(t, r, deps);
  // The board answers lines in order; in line mode it serves control lines (`{...}`) before data lines (G-code),
  // so the answers come as two queues, each in order: data answers (no key but `gc`) match the oldest data line,
  // the rest the oldest control line. Late (timed-out) entries ahead of the match in its queue are lost. The line
  // being written comes last: its answer can arrive before the transport reports the write complete.
  const owed = owedAnswers(t.s);
  // A data answer: `r` empty, or the firmware's echo of the line (`gc` at jv 5, and `n` for an N-numbered line at jv 4
  // or more), which run accepts as it comes (independent review 2026-11-03, R7).
  const data = Object.keys(r.r).every((k) => k === 'gc' || k === 'n') && owed.some(isDataEntry);
  const index = matchingAnswer({ owed, r, data }, deps);
  if (index < 0 || r.tid !== undefined) {
    // No tid is ever sent in Phase 1, so an echoed one answers a request this session never made (SAFETY §3).
    enterFault(t, 'unexpectedResponse', 'integrity', `a response nobody asked for: ${r.line.slice(0, 80)}`, at);
    return;
  }
  const entry = owed[index] as Expected;
  consumeOwed(t, owed, index, data);
  if (entry.late) return;
  if (entry.purpose !== 'job') t.cancel('answer');
  onAnswer(t, entry, r, at);
}

/** A data line (G-code): a job line or a motion line. Control lines are JSON (`{...}`). */
export function isDataEntry(e: Expected, _deps: ReducerDeps): boolean {
  return e.purpose === 'job' || ((e.purpose === 'motion' || e.purpose === 'probeZ') && e.token === 'gc');
}

/** Answers the board owes, oldest first: the written lines, then the line being written. */
export function owedAnswers(s: SessionState, _deps: ReducerDeps): readonly Expected[] {
  return s.writing === null ? s.expected : [...s.expected, { ...s.writing, late: false }];
}

/** Removes the answered entry and the late entries of its queue before it (the last owed may be the line being written). */
export function consumeOwed(t: Tx, message: { owed: readonly Expected[]; index: number; data: boolean; }, deps: ReducerDeps): void {
  const { owed, index, data } = message;
  const { isDataEntry } = deps;
  const gone = new Set<number>([index]);
  for (let i = 0;i < index;i++) {
    const e = owed[i] as Expected;
    if (e.purpose === 'splice' || isDataEntry(e) === data) gone.add(i);
  }
  const count = t.s.expected.length;
  t.set({ expected: t.s.expected.filter((_, i) => !gone.has(i)), ...(gone.has(count) ? { writing: null } : {}) });
}

/** Does `r` answer `e`? A GET's answer holds its own key or nothing; the first line accepts any answer (a splice). */
export function answers(e: Expected, r: Response, _deps: ReducerDeps): boolean {
  if (e.purpose === 'splice') return true;
  const keys = Object.keys(r.r);
  // A motion line is answered with an empty `r`, or with the line echoed as `gc` (jv ≥ 5), or `clear`.
  if (e.purpose === 'motion' || (e.purpose === 'probeZ' && e.line !== undefined)) return keys.every((k) => k === 'gc' || k === e.token);
  // A job line is G-code too: the same echo shape (`{"r":{"gc":"N1 G21 G90","n":1}}`: `gc` when another sender
  // left jv at 5, `n` for its N word from jv 4); run does not normalise jv (independent review 2026-11-03, R7).
  if (e.purpose === 'job') return keys.every((k) => k === 'gc' || k === 'n');
  return keys.length === 0 || (keys.length === 1 && keys[0] === e.token);
}

export function onAnswer(t: Tx, message: { e: PendingRead; r: Response; at: number; }, deps: ReducerDeps): void {
  const { e, r, at } = message;

  if (r.footer.status === 0) {
    if (e.purpose === 'job') acknowledgeDwell(t, t.s.job?.lines[e.index as number]?.text);
    else if (e.purpose === 'motion' && e.token === 'gc') acknowledgeDwell(t, e.line);
  }
  const value: JsonValue | undefined = r.r[e.token];
  if (onAnswerFamily1(t, { e, r, at, value }, deps)) return;
  onAnswerFamily2(t, { e, r, at, value }, deps);
}

export function bindAnswers(deps: ReducerDeps): Pick<ReducerDeps, 'onResponse' | 'isDataEntry' | 'owedAnswers' | 'consumeOwed' | 'answers' | 'onAnswer'> {
  return {
    onResponse: (t, r, at) => onResponse(t, { r: r, at: at }, deps),
    isDataEntry: (e) => isDataEntry(e, deps),
    owedAnswers: (s) => owedAnswers(s, deps),
    consumeOwed: (t, owed, index, data) => consumeOwed(t, { owed: owed, index: index, data: data }, deps),
    answers: (e, r) => answers(e, r, deps),
    onAnswer: (t, e, r, at) => onAnswer(t, { e: e, r: r, at: at }, deps),
  };
}

function onAnswerFamily1(t: Tx, message: AnswerMessage, deps: ReducerDeps): boolean {
  const { e } = message;
  switch (e.purpose) {
    case 'splice':
      onAnswerSplice(t, { ...message, e }, deps);
      return true;
    case 'probe':
      onAnswerProbe(t, { ...message, e }, deps);
      return true;
    case 'normalize':
      onAnswerNormalize(t, { ...message, e }, deps);
      return true;
    case 'reading':
      onAnswerReading(t, { ...message, e }, deps);
      return true;
    case 'request':
      onAnswerRequest(t, { ...message, e }, deps);
      return true;
    case 'verify':
      onAnswerVerify(t, { ...message, e }, deps);
      return true;
    case 'liveness':
      onAnswerLiveness(t, { ...message, e }, deps);
      return true;
    case 'poll':
      onAnswerPoll(t, { ...message, e }, deps);
      return true;
    case 'motion':
      onAnswerMotion(t, { ...message, e }, deps);
      return true;
    case 'job':
      onAnswerJob(t, { ...message, e }, deps);
      return true;
    case 'jobPrep':
      onAnswerJobPrep(t, { ...message, e }, deps);
      return true;
    case 'lineMode':
      onAnswerLineMode(t, { ...message, e }, deps);
      return true;
  }
  return false;
}

function onAnswerFamily2(t: Tx, message: AnswerMessage, deps: ReducerDeps): void {
  const { e } = message;
  switch (e.purpose) {
    case 'jobRuntime':
      onAnswerJobRuntime(t, { ...message, e }, deps);
      return;
    case 'gate':
      onAnswerGate(t, { ...message, e }, deps);
      return;
    case 'bootGate':
      onAnswerBootGate(t, { ...message, e }, deps);
      return;
    /* c8 ignore next 2 -- the link closes as soon as {"boot":1} is written, so its answer is never read */
    case 'boot':
      return;
    case 'setting':
      onAnswerSetting(t, { ...message, e }, deps);
      return;
    case 'readback':
      onAnswerReadback(t, { ...message, e }, deps);
      return;
    case 'seed':
      onAnswerSeed(t, { ...message, e }, deps);
      return;
    case 'report':
      onAnswerReport(t, { ...message, e }, deps);
      return;
    case 'probeZ':
      onAnswerProbeZ(t, { ...message, e }, deps);
      return;
    case 'modes':
      onAnswerModes(t, { ...message, e }, deps);
      return;
  }
}

function matchingAnswer(message: { owed: readonly Expected[]; r: Response; data: boolean; }, deps: ReducerDeps): number {
  const { owed, r, data } = message;
  const { isDataEntry, answers } = deps;
  let index = -1;
  for (let i = 0;i < owed.length;i++) {
    const e = owed[i] as Expected;
    if (e.purpose !== 'splice' && isDataEntry(e) !== data) continue;
    if (answers(e, r)) {
      index = i;
      break;
    }
    if (!e.late) break;
  }

  return index;
}

function answerBeforeReset(t: Tx): boolean {
  return t.s.probe !== null && t.s.probe.settling !== 'none';
}

function updateFreeSlots(t: Tx, r: Response, deps: ReducerDeps): void {
  const { features } = deps;
  if (r.footer.rev === 3 && t.s.job !== null) features.patchJob?.(t, { free: r.footer.field3 });
}
