import {
  type Banner
} from '@synthetos/protocol';
import { PROBE_CLOSED } from '../inactiveFeatures.ts';
import {
  type ProbeProgress
} from '../types.ts';
import type { ReducerDeps } from './deps.ts';
import type { Tx } from './transaction.ts';

/** Pure transition handlers: only the local transaction changes; all I/O remains ordered effects. */
/** Back to NOT_CONNECTED on a new epoch (late events of the old link are ignored). */
export function resetToNotConnected(t: Tx, unknownOnNextConnect: boolean, deps: ReducerDeps): void {
  const { initialState, features } = deps;
  t.cancelAll();
  t.s = { ...initialState(), epoch: t.s.epoch + 1, unknownOnNextConnect, timerSeq: t.s.timerSeq, notices: { adviseEstop: false }, probeZ: features.probeCarried?.(t.s.probeZ) ?? PROBE_CLOSED };
}

// --- Link events ----------------------------------------------------------
export function onOpened(t: Tx, deps: ReducerDeps): void {
  const { startProbe } = deps;
  const timings = t.config.timings;
  t.set({ base: 'IDENTIFYING', link: { heartbeatMs: null, silenceMs: timings.livenessIdleMs + timings.staleAfterMs } });
  if (t.s.unknownOnNextConnect) {
    t.addOverlay('UNKNOWN');
    t.set({ unknownOnNextConnect: false });
  }
  startProbe(t, 0, undefined);
}

/** (Re)starts the probe from `{sr:null}`: the first line written on every connect path (T-S86, H49). */
export function startProbe(t: Tx, message: { restarts: number; banner: Banner | undefined; normalized?: boolean | undefined; }, deps: ReducerDeps): void {
  const { restarts, banner, normalized = false } = message;
  const { REPORTS_IDLE } = deps;
  t.set({
    probe: { next: 0, answers: [], banner, spliceRetried: false, settling: 'none', restarts, backlog: 0, normalized, normalizing: false },
    classification: null,
    dialect: null,
    identity: null,
    ready: false,
    footerRev: undefined,
    queue: [{ token: 'sr', purpose: 'splice' }],
    reports: REPORTS_IDLE,
    link: { heartbeatMs: null, silenceMs: t.config.timings.livenessIdleMs + t.config.timings.staleAfterMs },
  });
}

export function onLinkLost(t: Tx, at: number, deps: ReducerDeps): void {
  const { interruptSettingWrite, features } = deps;
  interruptSettingWrite(t, 'the connection was lost');
  features.onJobLinkLost?.(t, at);
  features.abandonLoad?.(t, at, 'the connection was lost');
  features.abandonMotion?.(t);
  features.abandonProbe?.(t, 'lost', at);
  t.cancelAll();
  t.addOverlay('LOST');
  t.set({ queue: [], expected: [], writing: null, ackVerify: null, xoff: false, enqOutstanding: false, liveness: null, unknownOnNextConnect: true });
  t.emit({ kind: 'close', epoch: t.s.epoch });
}

export function onBanner(t: Tx, message: { banner: Banner; at: number; }, deps: ReducerDeps): void {
  const { banner, at } = message;
  const { interruptSettingWrite, features, enterFault } = deps;
  t.set({ dwellWait: null }); // a board reset cancels its dwell timer
  interruptSettingWrite(t, 'the board reset');
  // The board restarted: it boots in XON and never says so (@cite EN xio/xio_usart.c:128-130).
  // An ENQ written before the reset was either answered before the banner (lines arrive in order) or
  // lost with the RX ring, so no `ack` is still owed.
  t.set({ xoff: false, enqOutstanding: false });
  if (t.s.ready) {
    // SAFETY H19, T-S10: any banner after Ready means the board reset. FAULT, then UNKNOWN. A job is over (H72).
    // The reset also ended whatever motion was queued or held: ORPHANED_MOTION is over (its documented exit, §3).
    t.removeOverlay('ORPHANED_MOTION');
    features.onJobReset?.(t, at);
    features.abandonLoad?.(t, at, 'the controller reset');
    enterFault(t, 'bannerAfterReady', 'integrity', `the board printed a boot banner (${banner.shape}) after it was ready: it reset`, at);
    t.addOverlay('UNKNOWN');
    return;
  }
  // Not ready means IDENTIFYING with a probe running (ready is cleared only when a probe starts).
  const probe = t.s.probe as ProbeProgress;
  // The board is booting while it is being identified: every line sent before the reset is lost with its RX ring.
  if (t.s.overlays.includes('ORPHANED_MOTION') && t.s.classification === null) {
    // The reset ended whatever motion was running (SAFETY §3 ORPHANED_MOTION exits); the position is gone.
    t.removeOverlay('ORPHANED_MOTION');
    t.addOverlay('UNKNOWN');
  }
  t.cancel('answer');
  const isReady = banner.ready !== false;
  t.set({ queue: [], expected: [], probe: { ...probe, banner, settling: isReady ? 'ready' : 'boot' } });
  // N93: startup input may be discarded on 450.04. Retry the splice guard only after READY
  // and at least 500 ms quiet; a silent/damaged unclassified answer still fails closed.
  const readyDelay = typeof banner.fb === 'number' && banner.fb >= 450.04 ? Math.max(500, t.config.timings.bannerSettleMs) : t.config.timings.bannerSettleMs;
  t.arm('settle', isReady ? readyDelay : t.config.timings.bannerWaitMs);
}

export function bindConnect(deps: ReducerDeps): Pick<ReducerDeps, 'resetToNotConnected' | 'onOpened' | 'startProbe' | 'onLinkLost' | 'onBanner'> {
  return {
    resetToNotConnected: (t, unknownOnNextConnect) => resetToNotConnected(t, unknownOnNextConnect, deps),
    onOpened: (t) => onOpened(t, deps),
    startProbe: (t, restarts, banner, normalized) => startProbe(t, { restarts: restarts, banner: banner, normalized: normalized }, deps),
    onLinkLost: (t, at) => onLinkLost(t, at, deps),
    onBanner: (t, banner, at) => onBanner(t, { banner: banner, at: at }, deps),
  };
}
