import { allowed } from '@synthetos/safety';
import { heartbeatCoversHold } from '../reports.ts';
import {
  READY_BASES,
  type SessionState
} from '../types.ts';
import type { ReducerDeps } from './deps.ts';
import type { Tx } from './transaction.ts';

/** Pure transition handlers: only the local transaction changes; all I/O remains ordered effects. */
/** The watchdog runs on a classified, connected link (it needs the dialect's ENQ or its read allowlist). */
export function watchdogActive(s: SessionState, deps: ReducerDeps): boolean {
  const { linkUp, dialectOf } = deps;
  return linkUp(s) && READY_BASES.has(s.base) && dialectOf(s) !== null;
}

/** Arms the watchdog when it should run and is not armed; stops it when it should not run. */
/**
 * How long received silence may last before the watchdog acts: with the heartbeat on, the report silence
 * window (then STALE, nothing sent); otherwise the fallback idle time before one proof-of-life ask.
 */
export function watchdogMs(t: Tx, _deps: ReducerDeps): number {
  return t.s.reports.heartbeatMs !== null ? t.config.timings.reportSilenceMs : t.config.timings.livenessIdleMs;
}

export function syncWatchdog(t: Tx, deps: ReducerDeps): void {
  const { watchdogActive, watchdogMs } = deps;
  if (watchdogActive(t.s)) {
    if (t.s.timers.watchdog === undefined) t.arm('watchdog', watchdogMs(t));
    return;
  }
  t.cancel('watchdog');
  t.set({ liveness: null });
}

export function enterStale(t: Tx, at: number, deps: ReducerDeps): void {
  const { features } = deps;
  if (t.s.overlays.includes('STALE')) return;
  t.addOverlay('STALE');
  // The watchdog and the read timeouts run only after the board has answered, so a receive time exists.
  t.set({ stale: { at, silentForMs: Math.max(0, at - (t.s.live.lastRxAt as number)) } });
  features.abandonProbe?.(t, 'stale', at);
}

/**
 * True when the last known state is one in which the edge-next heartbeat is silent and no report is due, so a
 * silent window proves nothing (SAFETY §4.2 amendment "heartbeat silence during hold and dwell"): the heartbeat
 * beats only while the machine is quiet, with nothing moving, held, flushing or queued (@cite EN
 * runtime.c:37-52, :62-71), and a finished feedhold or a long G4 dwell pushes no report either. That is a hold
 * (`hold` ≠ 0, or a held `stat`), or a cycle that is not stepping: a dwell, or moves queued but not moving
 * (a running, homing, jogging or probing `stat`, or planner buffers in use), with `vel` 0. Never while steps may
 * be moving (`vel` not 0, or unknown): pushed position reports cover liveness then, and nothing is sent. A finished
 * hold is the exception: nothing steps whatever `vel` says, and from 450.02 a hold entered during a dwell keeps
 * reporting the last move's final segment velocity (EN canonical_machine.c:2597-2610).
 */
export function silentWhileBusy(s: SessionState, deps: ReducerDeps): boolean {
  const { dialectOf, MOTION_CLASSES } = deps;
  const live = s.live;
  if (live.hold !== undefined && dialectOf(s)?.hold[live.hold] === 'HOLD') return true;
  if (live.vel !== 0) return false;
  if ((live.hold !== undefined && live.hold !== 0) || live.machineClass === 'held') return true;
  if (live.machineClass !== undefined && MOTION_CLASSES.has(live.machineClass)) return true;
  const blocks = dialectOf(s)?.limits.plannerBlocks;
  return blocks !== undefined && live.qr !== undefined && live.qr < blocks;
}

export function onWatchdog(t: Tx, at: number, deps: ReducerDeps): void {
  const { enterStale, silentWhileBusy, askForLife } = deps;
  // Armed only while the watchdog is active: syncWatchdog cancels it in the transition that ends that.
  if (t.s.reports.heartbeatMs !== null) {
    if (t.s.liveness !== null) {
      // Asked once for this silent window and no byte came back within `staleAfterMs`: unexpected silence.
      enterStale(t, at);
      t.set({ liveness: null });
      t.arm('watchdog', t.config.timings.reportSilenceMs);
      return;
    }
    if (silentWhileBusy(t.s) && !heartbeatCoversHold()) {
      // Held, dwelling or queued without stepping: the heartbeat does not beat and no report is due, so the
      // silence is expected. Ask ONCE for this window (ENQ, else a `stat` GET); STALE only if that goes unanswered.
      t.set({ liveness: { since: at, via: askForLife(t) } });
      t.arm('watchdog', t.config.timings.staleAfterMs);
      return;
    }
    // Neither a report, a heartbeat nor an answer for the whole window: "No reports from the board". The link
    // is suspect (STALE: only reads and stops), and nothing is sent to ask: while the machine is quiet the
    // heartbeat is the proof of life, and while steps move the pushed position reports are.
    enterStale(t, at);
    t.arm('watchdog', t.config.timings.reportSilenceMs);
    return;
  }
  if (t.s.liveness !== null) {
    // Asked for proof of life `staleAfterMs` ago and nothing came back: unexpected silence.
    enterStale(t, at);
  }
  t.set({ liveness: { since: at, via: askForLife(t) } });
  t.arm('watchdog', t.config.timings.staleAfterMs);
}

/**
 * Asks the board for proof of life. ENQ on edge-next after a rev-2/3 footer
 * when none is outstanding (an unanswered one stays outstanding: at most one,
 * SAFETY §4.2), else a `stat` GET, queued like any read (the matrix and the
 * allowlist are checked when it is written). A line already owed or waiting
 * is proof enough to wait for.
 */
export function askForLife(t: Tx, deps: ReducerDeps): 'enq' | 'get' {
  const { enqByte, matrixSnapshot, writeEnq, LIVENESS_TOKEN } = deps;
  const byte = enqByte(t.s);
  if (byte !== undefined && !t.s.enqOutstanding && allowed(matrixSnapshot(t.s), 'enq', t.config.release).allowed) {
    writeEnq(t, byte);
    return 'enq';
  }
  if (t.s.queue.length === 0 && t.s.writing === null && !t.s.expected.some((e) => !e.late)) {
    t.set({ queue: [{ token: LIVENESS_TOKEN, purpose: 'liveness' }] });
  }
  return 'get';
}

export function bindWatchdog(deps: ReducerDeps): Pick<ReducerDeps, 'watchdogActive' | 'watchdogMs' | 'syncWatchdog' | 'enterStale' | 'silentWhileBusy' | 'onWatchdog' | 'askForLife'> {
  return {
    watchdogActive: (s) => watchdogActive(s, deps),
    watchdogMs: (t) => watchdogMs(t, deps),
    syncWatchdog: (t) => syncWatchdog(t, deps),
    enterStale: (t, at) => enterStale(t, at, deps),
    silentWhileBusy: (s) => silentWhileBusy(s, deps),
    onWatchdog: (t, at) => onWatchdog(t, at, deps),
    askForLife: (t) => askForLife(t, deps),
  };
}
