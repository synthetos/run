import {
  type Response
} from '@synthetos/protocol';
import { allowed } from '@synthetos/safety';
import { isReadAllowed } from '@synthetos/schema';
import { noteModeRead } from '../boardModes.ts';
import { noteHomingRead } from '../homedAxes.ts';
import { HEARTBEAT_INTERVAL_MS, REPORT_DIALECTS, SEED_TOKENS, reportSteps, srListMatches, type ReportStep } from '../reports.ts';
import {
  type PendingRead,
  type ReportChange,
  type SessionState
} from '../types.ts';
import type { ReadValueLike, ReducerDeps } from './deps.ts';
import type { Tx } from './transaction.ts';

/** Pure transition handlers: only the local transaction changes; all I/O remains ordered effects. */
// --- Push-driven state: the full read at connect and the report configuration (amendment 2026-11-02) ---

/**
 * After READING: read the machine's full state once (SEED_TOKENS through the read allowlist). Nothing polls
 * afterwards: pushed status reports and the heartbeat keep the page current (SAFETY §4.2 as amended).
 */
export function startSeed(t: Tx, deps: ReducerDeps): void {
  const { dialectOf, REPORTS_IDLE, features, seedAnswered } = deps;
  const dialect = dialectOf(t.s);
  if (dialect === null || t.s.overlays.includes('ORPHANED_MOTION')) {
    t.set({ reports: { ...REPORTS_IDLE, phase: 'off' } });
    return;
  }
  const reads = SEED_TOKENS.filter((tok) => isReadAllowed(dialect.id, tok, t.s.identity?.fb));
  t.set({ reports: { ...REPORTS_IDLE, phase: 'seeding' }, queue: [...t.s.queue, ...reads.map((token) => ({ token, purpose: 'seed' as const })), ...(features.probeSeedReads?.(t.s, t.config) ?? [])] });
  seedAnswered(t, null, 0);
}

/** A seed read is still to be written. (One line is in flight at a time: when a seed is answered, the next is still queued.) */
export function isSeedOwed(s: SessionState, _deps: ReducerDeps): boolean {
  return s.queue.some((q) => q.purpose === 'seed');
}

export function onSeedAnswer(t: Tx, message: { e: PendingRead; r: Response; at: number; }, deps: ReducerDeps): void {
  const { e, r, at } = message;
  const { mergeStateValue, features, seedAnswered } = deps;
  const value = r.r[e.token];
  t.set({ values: { ...t.s.values, [e.token]: { value: value ?? null, status: r.footer.status, at } } });
  noteModeRead(t, e.token, r.footer.status, value);
  noteHomingRead(t, e.token, r.footer.status, value); // S1: a home or hom of 0 forgets what was homed here
  if (r.footer.status === 0) mergeStateValue(t, e.token, value);
  // A read-back of `home` after a change keeps the idle base honest (homed or not).
  if (e.token === 'home' && (t.s.base === 'IDLE_HOMED' || t.s.base === 'IDLE_UNHOMED')) t.set({ base: features.idleBase?.(t.s) ?? 'CONNECTED_UNKNOWN' });
  seedAnswered(t, e, at);
}

/** One seed read is answered (or `null` after queueing them): runs its follow-up, and ends the connect-time read. */
export function seedAnswered(t: Tx, message: { e: PendingRead | null; at: number; }, deps: ReducerDeps): void {
  const { e, at } = message;
  const { features, isSeedOwed, dialectOf } = deps;
  followSeedRead(t, { e, at }, deps);
  if (t.s.reports.phase !== 'seeding' || isSeedOwed(t.s)) return;
  const dialect = dialectOf(t.s);
  const applies = dialect !== null && t.config.release.reports === true && REPORT_DIALECTS.has(dialect.id) && features.motionCapable?.(t.s, t.config) && !t.s.overlays.includes('ORPHANED_MOTION');
  t.set({ reports: { ...t.s.reports, phase: applies ? 'pending' : 'off' } });
  t.emit({ kind: 'log', text: `connect: full state read${applies ? '; status reports are configured next' : '; status reports are not configured on this board in this release'}` });
}

/** Starts the configuration when it is pending and the state allows it (idle, never in alarm, nothing else in progress). */
export function maybeConfigure(t: Tx, deps: ReducerDeps): void {
  const { settingWriteActive, isSeedOwed, linkUp, matrixSnapshot, numberValue, nextReportStep } = deps;
  const s = t.s;
  if (s.reports.phase !== 'pending' || s.motion !== null || settingWriteActive(s) || isSeedOwed(s)) return;
  if (!linkUp(s) || !allowed(matrixSnapshot(s), 'configureReports', t.config.release).allowed) return;
  const steps = reportSteps({ srList: s.live.srList, sv: numberValue(s.values['sv']), si: numberValue(s.values['si']) });
  t.set({ reports: { ...s.reports, phase: 'configuring', step: null, remaining: steps } });
  t.emit({ kind: 'log', text: `reports: the status report list ${srListMatches(s.live.srList) ? 'already holds what run needs: not written' : 'differs from what run needs: it is written (and saved on the board) and read back'}` });
  nextReportStep(t, null);
}

export function reportStepText(step: ReportStep, _deps: ReducerDeps): string {
  return step.line ?? `{"${step.token}":null}`;
}

/** The configuration ends unfinished. What was already changed stays recorded (W35, W36). */
export function failReports(t: Tx, why: string, _deps: ReducerDeps): void {
  const r = t.s.reports;
  if (r.phase === 'done' || r.phase === 'failed' || r.phase === 'off' || r.phase === 'idle') return;
  t.set({ reports: { ...r, phase: 'failed', step: null, remaining: [], detail: why }, queue: t.s.queue.filter((q) => q.purpose !== 'report' && q.purpose !== 'seed') });
  t.emit({ kind: 'log', text: `reports: not configured (${why}); the page shows what the board pushes, and the watchdog asks for proof of life on its own` });
}

export function nextReportStep(t: Tx, message: { detail: string | null; skipReadback?: boolean | undefined; }, _deps: ReducerDeps): void {
  const { detail, skipReadback = false } = message;
  const r = t.s.reports;
  let remaining = r.remaining;
  if (skipReadback && remaining[0]?.kind.endsWith('Readback') === true) remaining = remaining.slice(1);
  const [next, ...rest] = remaining;
  const merged = detail === null ? r.detail : r.detail === null ? detail : `${r.detail}; ${detail}`;
  if (next === undefined) {
    t.set({ reports: { ...r, phase: 'done', step: null, remaining: [], detail: merged } });
    t.emit({ kind: 'log', text: `reports: configured (heartbeat ${r.heartbeatMs === null ? 'not available' : `${r.heartbeatMs} ms`})${merged === null ? '' : `: ${merged}`}` });
    return;
  }
  t.set({ reports: { ...r, step: next, remaining: rest, detail: merged }, queue: [...t.s.queue, { token: next.token, purpose: 'report' }] });
}

export function numberValue(v: ReadValueLike, _deps: ReducerDeps): number | undefined {
  return v !== undefined && v.status === 0 && typeof v.value === 'number' ? v.value : undefined;
}

export function addChange(t: Tx, change: ReportChange, _deps: ReducerDeps): void {
  t.set({ reports: { ...t.s.reports, changes: [...t.s.reports.changes, change] } });
}

export function onReportAnswer(t: Tx, message: { r: Response; at: number; }, deps: ReducerDeps): void {
  const { r, at } = message;

  const reports = t.s.reports;
  const step = reports.step;
  /* c8 ignore next -- a report line is queued only with its step in progress, and dropped when it ends */
  if (step === null || reports.phase !== 'configuring') return;
  const status = r.footer.status;
  onReportAnswerFamily1(t, { step, r, at, status }, deps);
}

export function bindReports(deps: ReducerDeps): Pick<ReducerDeps, 'startSeed' | 'isSeedOwed' | 'onSeedAnswer' | 'seedAnswered' | 'maybeConfigure' | 'reportStepText' | 'failReports' | 'nextReportStep' | 'numberValue' | 'addChange' | 'onReportAnswer'> {
  return {
    startSeed: (t) => startSeed(t, deps),
    isSeedOwed: (s) => isSeedOwed(s, deps),
    onSeedAnswer: (t, e, r, at) => onSeedAnswer(t, { e: e, r: r, at: at }, deps),
    seedAnswered: (t, e, at) => seedAnswered(t, { e: e, at: at }, deps),
    maybeConfigure: (t) => maybeConfigure(t, deps),
    reportStepText: (step) => reportStepText(step, deps),
    failReports: (t, why) => failReports(t, why, deps),
    nextReportStep: (t, detail, skipReadback) => nextReportStep(t, { detail: detail, skipReadback: skipReadback }, deps),
    numberValue: (v) => numberValue(v, deps),
    addChange: (t, change) => addChange(t, change, deps),
    onReportAnswer: (t, r, at) => onReportAnswer(t, { r: r, at: at }, deps),
  };
}

interface ReportAnswerMessage { step: ReportStep; r: Response; at: number; status: number; }

function onReportAnswerSrList(t: Tx, message: ReportAnswerMessage, deps: ReducerDeps): void {
  const { status } = message;
  const step = message.step as ReportStep & { kind: 'srList' | 'sv' | 'si'; };
  const { nextReportStep, addChange } = deps;

  if (status !== 0) {
    nextReportStep(t, `the board refused ${step.line as string} (status ${status})`, true);
    return;
  }
  const change: ReportChange = { setting: step.kind === 'srList' ? 'sr' : step.kind, ...(step.from === undefined ? {} : { from: step.from }), ...(step.kind === 'sv' ? { to: 1 } : step.kind === 'si' ? { to: 250 } : {}) };
  addChange(t, change);
  t.emit({ kind: 'log', text: `reports: ${step.kind === 'srList' ? "Run set this board's status reports to include position, spindle, coolant and tool" : `Run changed ${step.kind} from ${step.from as number} to ${change.to as number}`} (saved on the board)` });
  nextReportStep(t, null);
  return;

}

function onReportAnswerSrReadback(t: Tx, message: ReportAnswerMessage, deps: ReducerDeps): void {
  const { r, status } = message;
  const { nextReportStep, isObject, mergeLive } = deps;

  const sr = r.r['sr'];
  if (status === 0 && isObject(sr)) {
    mergeLive(t, sr);
    t.set({ live: { ...t.s.live, srList: Object.freeze(Object.keys(sr)) } });
  }
  nextReportStep(t, status === 0 && isObject(sr) && srListMatches(Object.keys(sr)) ? null : 'the status report list read back is not the one run set');
  return;

}

function onReportAnswerSvReadback(t: Tx, message: ReportAnswerMessage, deps: ReducerDeps): void {
  const { step, r, at, status } = message;
  const { nextReportStep } = deps;

  const value = r.r[step.token];
  t.set({ values: { ...t.s.values, [step.token]: { value: value ?? null, status, at } } });
  const want = step.token === 'sv' ? 1 : 250;
  nextReportStep(t, status === 0 && value === want ? null : `${step.token} reads back ${JSON.stringify(value ?? null)}, not ${want}`);
  return;

}

function onReportAnswerRtProbe(t: Tx, message: ReportAnswerMessage, deps: ReducerDeps): void {
  const { r, status } = message;
  const { nextReportStep, isObject } = deps;

  const rt = r.r['rt'];
  if (status === 0 && isObject(rt)) {
    // The leaves it answers with are the capability probe of the job flag and the feed-limit window (Phase 3).
    t.set({ rtLeaves: Object.freeze(Object.keys(rt)) });
    nextReportStep(t, null);
    return;
  }
  t.set({ reports: { ...t.s.reports, remaining: t.s.reports.remaining.filter((x) => x.kind !== 'heartbeat') } });
  t.emit({ kind: 'log', text: `reports: no heartbeat on this firmware ({"rt":null} answered status ${status}); the watchdog asks for proof of life after ${t.config.timings.livenessIdleMs} ms of silence` });
  nextReportStep(t, null);
  return;

}

function onReportAnswerHeartbeat(t: Tx, message: ReportAnswerMessage, deps: ReducerDeps): void {
  const { status } = message;
  const { nextReportStep } = deps;

  if (status !== 0) {
    nextReportStep(t, `the board refused the heartbeat (status ${status})`);
    return;
  }
  t.set({ reports: { ...t.s.reports, heartbeatMs: HEARTBEAT_INTERVAL_MS }, link: { heartbeatMs: HEARTBEAT_INTERVAL_MS, silenceMs: t.config.timings.reportSilenceMs }, liveness: null });
  t.arm('watchdog', t.config.timings.reportSilenceMs);
  nextReportStep(t, null);
  return;

}

function onReportAnswerFamily1(t: Tx, message: ReportAnswerMessage, deps: ReducerDeps): void {
  const { step } = message;
  switch (step.kind) {
    case 'srList':
    case 'sv':
    case 'si':
      onReportAnswerSrList(t, { ...message, step }, deps);
      return;
    case 'srReadback':
      onReportAnswerSrReadback(t, { ...message, step }, deps);
      return;
    case 'svReadback':
    case 'siReadback':
      onReportAnswerSvReadback(t, { ...message, step }, deps);
      return;
    case 'rtProbe':
      onReportAnswerRtProbe(t, { ...message, step }, deps);
      return;
    case 'heartbeat':
      onReportAnswerHeartbeat(t, { ...message, step }, deps);
      return;
  }
}

function followSeedRead(t: Tx, message: { e: PendingRead | null; at: number; }, deps: ReducerDeps): void {
  const { e, at } = message;
  const { features } = deps;
  if (e?.then === 'typedCheck') features.onTypedReadsIn?.(t, at);
  else if (e?.then !== undefined) features.onFollowUp?.(t, e.then, at);

}
