import type { Dialect } from '@synthetos/protocol';
import {
  PROBE_STEPS,
  buildProbeResult,
  classify,
  mapStat,
  type Classification,
  type ProbeResult
} from '@synthetos/protocol';
import { isReadAllowed } from '@synthetos/schema';
import { writeLineCapFor } from '../../writeShape.ts';
import { restingStat, restingUsesHold } from '../resting.ts';
import type { LiveState } from '../types.ts';
import {
  type Identity,
  type ProbeProgress
} from '../types.ts';
import type { ReducerDeps } from './deps.ts';
import type { Tx } from './transaction.ts';

/** Pure transition handlers: only the local transaction changes; all I/O remains ordered effects. */
export function advanceProbe(t: Tx, probe: ProbeProgress, deps: ReducerDeps): void {
  const { finishProbe } = deps;
  t.set({ probe });
  if (probe.next < PROBE_STEPS.length) {
    if (t.s.overlays.includes('ORPHANED_MOTION')) return;
    const step = PROBE_STEPS[probe.next] as (typeof PROBE_STEPS)[number];
    t.set({ queue: [...t.s.queue, { token: step.key, purpose: 'probe' }] });
    return;
  }
  finishProbe(t);
}

export function finishProbe(t: Tx, deps: ReducerDeps): void {
  const { checkUnclassifiedResting, probeRecord } = deps;
  const probe = t.s.probe as ProbeProgress;
  const outcome = buildProbeResult({ ...(probe.banner === undefined ? {} : { banner: probe.banner }), answers: new Map(probe.answers) });
  t.set({ ready: true });
  if (!outcome.ok) {
    t.emit({ kind: 'log', text: `probe: could not be read (${outcome.reason} at ${outcome.key}) → unclassified, read-only` });
    t.set({ classification: { dialectId: null, mode: 'readOnly', reason: 'probeFailed', detail: `the probe could not be read (${outcome.reason} at ${outcome.key})`, upgradeOffer: false } });
    t.addOverlay('READ_ONLY');
    t.set({ base: 'CONNECTED_UNKNOWN' });
    checkUnclassifiedResting(t);
    return;
  }
  const result = outcome.result;
  const c = classify(result, t.config.manifest);
  t.emit({ kind: 'log', text: probeRecord(result, c) });
  const identity = Object.fromEntries(
    Object.entries({ fb: result.fb, fv: result.fv, hp: result.hp, hv: result.hv, id: result.id, fbs: result.fbs }).filter(([, v]) => v !== undefined),
  ) as Identity;
  t.set({
    identity,
    dialect: c.dialect,
    classification: {
      dialectId: c.dialect?.id ?? null,
      mode: c.mode,
      reason: c.reason,
      detail: c.detail,
      upgradeOffer: c.upgradeOffer,
      ...(c.buildIdentity === undefined ? {} : { buildIdentity: c.buildIdentity }),
      ...(c.approvalSource === undefined ? {} : { approvalSource: c.approvalSource }),
    },
  });
  if (c.mode === 'readOnly') t.addOverlay('READ_ONLY');
  if (c.dialect !== null) t.emit({ kind: 'tightenLineCap', epoch: t.s.epoch, maxLineBytes: writeLineCapFor(c.dialect) });
  if (t.s.expectedDeviceId !== null && result.id !== t.s.expectedDeviceId) {
    // T-S21: the board is not the selected machine. Nothing more is written.
    t.set({ base: 'BLOCKED', blocked: { expected: t.s.expectedDeviceId, reported: result.id ?? null }, queue: [] });
    return;
  }
  beginReading(t, c, deps);
}

/** The probe result and its classification as one session-log line (ROADMAP P1-03 "Record the probe result"). */
export function probeRecord(result: ProbeResult, c: Classification, _deps: ReducerDeps): string {
  const { footers, ...rest } = result;
  const verdict = `${c.dialect?.id ?? 'unclassified'} ${c.mode === 'full' ? 'full' : 'read-only'} (${c.reason})`;
  return `probe: ${JSON.stringify({ ...rest, footers: footers.map((f) => f.raw) })} → ${verdict}: ${c.detail}`;
}

/**
 * The probe ended without a dialect (a failed or damaged probe), so READING never runs. The raw
 * values from the `{sr:null}` answer are all there is: a board that is not plainly resting is
 * treated as busy (SAFETY H14 mitigation 5, T-S60), never as merely read-only.
 */
export function checkUnclassifiedResting(t: Tx, deps: ReducerDeps): void {
  const { UNCLASSIFIED_RESTING_STAT } = deps;
  const live = t.s.live;
  const busy =
    live.stat === undefined ||
    !UNCLASSIFIED_RESTING_STAT.has(live.stat) ||
    (live.vel !== undefined && live.vel !== 0) ||
    (live.hold !== undefined && live.hold !== 0);
  if (!busy) return;
  t.addOverlay('ORPHANED_MOTION');
  t.set({ queue: [] });
  t.emit({ kind: 'log', text: `probe: unclassified board not resting (stat ${live.stat ?? 'unknown'}, vel ${live.vel ?? 'unknown'}, hold ${live.hold ?? 'unknown'}) → ORPHANED_MOTION` });
}

/** READING is complete: a board that is not resting is ORPHANED_MOTION (SAFETY H14, PN §2.3 step 0). */
export function finishReading(t: Tx, deps: ReducerDeps): void {
  const { dialectOf, ALARM_CLASSES, features, startSeed } = deps;
  const dialect = dialectOf(t.s);
  const live = t.s.live;
  const quiet = readingQuiet(dialect, live);
  // One rule for "at rest" (SAFETY H14 as amended 2026-11-02): idle or ended, or on edge-next a finished cycle
  // (stat 3 with hold 0), shared with the motion layer (resting.ts).
  const resting = quiet && live.stat !== undefined && restingStat(dialect, live.stat, live.hold);
  const cls = readingClass(dialect, live);
  // A motion session (Phase 2): a controller in alarm with nothing moving, held or queued is not motion
  // from elsewhere; it is ALARM, left only by Clear alarm (C13, SAFETY §4.5b).
  const alarmed = t.config.release.motion && quiet && cls !== undefined && ALARM_CLASSES.has(cls);
  if (!resting && !alarmed) t.addOverlay('ORPHANED_MOTION');
  checkFlowControl(t, live, deps);
  t.set({ base: 'CONNECTED_UNKNOWN', queue: t.s.queue.filter((q) => q.purpose !== 'reading') });
  // A motion session with nothing in the way goes to idle (or ALARM). UNKNOWN (after a reconnect) waits
  // for "I've checked the machine" (positionVerify); any other overlay keeps CONNECTED_UNKNOWN.
  if (features.motionCapable?.(t.s, t.config) && t.s.overlays.length === 0) t.set({ base: alarmed ? 'ALARM' : features.idleBase?.(t.s) ?? 'CONNECTED_UNKNOWN' });
  startSeed(t);
}

export function bindIdentify(deps: ReducerDeps): Pick<ReducerDeps, 'advanceProbe' | 'finishProbe' | 'probeRecord' | 'checkUnclassifiedResting' | 'finishReading'> {
  return {
    advanceProbe: (t, probe) => advanceProbe(t, probe, deps),
    finishProbe: (t) => finishProbe(t, deps),
    probeRecord: (result, c) => probeRecord(result, c, deps),
    checkUnclassifiedResting: (t) => checkUnclassifiedResting(t, deps),
    finishReading: (t) => finishReading(t, deps),
  };
}

function beginReading(t: Tx, c: Classification, deps: ReducerDeps): void {
  const { READING_TOKENS, MOTION_READING_TOKENS, REPORTS_IDLE, checkUnclassifiedResting } = deps;
  const dialect = c.dialect;
  const tokens = t.config.release.motion ? [...READING_TOKENS, ...MOTION_READING_TOKENS] : READING_TOKENS;
  const reads = dialect === null ? [] : tokens.filter((tok) => isReadAllowed(dialect.id, tok, t.s.identity?.fb));
  if (reads.length === 0 || t.s.overlays.includes('ORPHANED_MOTION')) {
    t.set({ base: 'CONNECTED_UNKNOWN', reports: { ...REPORTS_IDLE, phase: 'off' } });
    if (dialect === null) checkUnclassifiedResting(t);
    return;
  }
  // Only READING's own answers count: values from the earlier `{sr:null}` answer are dropped, so a
  // read that fails leaves its value unknown and the board is not trusted as resting.
  const { stat: _stat, machineClass: _class, hold: _hold, vel: _vel, qr: _qr, ...kept } = t.s.live;
  t.set({ base: 'READING', live: kept, queue: [...t.s.queue, ...reads.map((token) => ({ token, purpose: 'reading' as const }))] });
}

function readingQuiet(dialect: Dialect | null, live: LiveState): dialect is Dialect {
  return dialect !== null && (!restingUsesHold(dialect) || live.hold === 0) && live.vel === 0 && live.qr === dialect.limits.plannerBlocks;
}

function checkFlowControl(t: Tx, live: LiveState, deps: ReducerDeps): void {
  const { FULL_SESSION_FLOW_CONTROL } = deps;
  const c = t.s.classification;
  if (c !== null && c.mode === 'full' && (live.ex === undefined || !FULL_SESSION_FLOW_CONTROL.has(live.ex))) {
    const shown = live.ex === undefined ? 'could not be read' : `is ${live.ex}`;
    t.set({ classification: { ...c, mode: 'readOnly', reason: 'flowControl', detail: `${c.detail}; flow control (ex) ${shown}: read-only, Run knows only ex 0, 1 and 2` } });
    t.addOverlay('READ_ONLY');
    t.emit({ kind: 'log', text: `classification: read-only, flow control (ex) ${shown}` });
  }

}

function readingClass(dialect: Dialect | null, live: LiveState): ReturnType<typeof mapStat> | undefined {
  return dialect !== null && live.stat !== undefined ? mapStat(dialect, live.stat) : undefined;
}
