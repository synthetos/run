import { allowed } from '@synthetos/safety';
import {
  type SessionConfig,
  type SessionEvent,
  type SessionState,
  type Transition
} from '../types.ts';
import type { ReducerDeps } from './deps.ts';
import { Tx } from './transaction.ts';

/** Pure transition handlers: only the local transaction changes; all I/O remains ordered effects. */
/** The next state and effects. Pure: never throws for any event in any state. */
export function reduce(config: SessionConfig, message: { state: SessionState; event: SessionEvent; }, deps: ReducerDeps): Transition {
  const { state, event } = message;
  const { linkUp, features, maybeConfigure, matrixSnapshot, pump, syncWatchdog } = deps;
  const t = new Tx(config, state);
  dispatchEvent(t, { event }, deps);
  maybeConfigure(t);
  features.maybeRestoreLineMode?.(t, linkUp(t.s) && allowed(matrixSnapshot(t.s), 'lineMode', t.config.release).allowed);
  features.maybeRereadOffsets?.(t, linkUp(t.s) && allowed(matrixSnapshot(t.s), 'read', t.config.release).allowed);
  pump(t);
  features.pumpJob?.(t, linkUp(t.s) && allowed(matrixSnapshot(t.s), 'jobLine', t.config.release).allowed);
  features.syncProbe?.(t);
  syncWatchdog(t);
  return t.done();
}

/** A job line the executor did not write (the matrix no longer allowed it): it is sent again from there. */
export function onJobLineDropped(t: Tx, index: number, deps: ReducerDeps): void {
  const { features } = deps;
  t.set({ expected: t.s.expected.filter((e) => !(e.purpose === 'job' && e.index === index)) });
  const job = t.s.job;
  if (job !== null && index < job.next) features.patchJob?.(t, { next: index });
}

export function bindEvents(deps: ReducerDeps): Pick<ReducerDeps, 'reduce' | 'onJobLineDropped'> {
  return {
    reduce: (config, state, event) => reduce(config, { state: state, event: event }, deps),
    onJobLineDropped: (t, index) => onJobLineDropped(t, index, deps),
  };
}

interface EventMessage { event: SessionEvent; }

function reduceIntent(t: Tx, message: Omit<EventMessage, 'event'> & { event: Extract<SessionEvent, { type: 'intent'; }>; }, deps: ReducerDeps): void {
  const { event } = message;
  const { onIntent } = deps;

  onIntent(t, event.request, event.at);
}

function reduceTransportAcquired(t: Tx, message: Omit<EventMessage, 'event'> & { event: Extract<SessionEvent, { type: 'transportAcquired'; }>; }, _deps: ReducerDeps): void {
  const { event } = message;

  if (event.epoch === t.s.epoch && t.s.base === 'PORT_REQUEST') {
    t.set({ base: 'OPENING' });
    t.emit({ kind: 'open', epoch: t.s.epoch });
  }
}

function reduceTransportUnavailable(t: Tx, message: Omit<EventMessage, 'event'> & { event: Extract<SessionEvent, { type: 'transportUnavailable' | 'openFailed'; }>; }, deps: ReducerDeps): void {
  const { event } = message;
  const { resetToNotConnected } = deps;

  if (event.epoch === t.s.epoch && (t.s.base === 'PORT_REQUEST' || t.s.base === 'OPENING')) {
    resetToNotConnected(t, false);
    const code = event.type === 'transportUnavailable' ? 'unavailable' : 'open-failed';
    t.set({ notices: { ...t.s.notices, connectFailed: { code, reason: event.reason } } });
  }
}

function reduceOpened(t: Tx, message: Omit<EventMessage, 'event'> & { event: Extract<SessionEvent, { type: 'opened'; }>; }, deps: ReducerDeps): void {
  const { event } = message;
  const { onOpened } = deps;

  if (event.epoch === t.s.epoch && t.s.base === 'OPENING') {
    t.set({ portInfo: Object.freeze({ ...event.info }) });
    onOpened(t);
  }
}

function reduceInbound(t: Tx, message: Omit<EventMessage, 'event'> & { event: Extract<SessionEvent, { type: 'inbound'; }>; }, deps: ReducerDeps): void {
  const { event } = message;
  const { linkUp, onInbound, features } = deps;

  if (event.epoch === t.s.epoch && linkUp(t.s)) {
    onInbound(t, event.event, event.at);
    // An alarm ends any motion of this session; a cleared alarm returns to idle (SAFETY §4.5b).
    features.checkAlarm?.(t, event.at);
  }
}

function reduceLineWritten(t: Tx, message: Omit<EventMessage, 'event'> & { event: Extract<SessionEvent, { type: 'lineWritten'; }>; }, deps: ReducerDeps): void {
  const { event } = message;
  const { linkUp, onLineWritten } = deps;

  // Only for the line being written: its answer may already have arrived (and the next line been asked for).
  if (event.epoch === t.s.epoch && linkUp(t.s) && t.s.writing?.seq === event.seq) onLineWritten(t, event.at ?? 0);
}

function reduceLineDropped(t: Tx, message: Omit<EventMessage, 'event'> & { event: Extract<SessionEvent, { type: 'lineDropped'; }>; }, deps: ReducerDeps): void {
  const { event } = message;
  const { features, onJobLineDropped } = deps;

  if (event.epoch === t.s.epoch && event.index !== undefined) onJobLineDropped(t, event.index);
  else if (event.epoch === t.s.epoch && t.s.writing?.seq === event.seq) {
    const dropped = t.s.writing;
    t.set({ writing: null });
    // Probe Z: a line the write gate held back (after Pause or Stop job) is the probe's to account for.
    if (dropped.purpose === 'probeZ' && dropped.line !== undefined) features.onProbeLineDropped?.(t, dropped.line, t.s.live.lastRxAt as number);
  }
}

function reduceWriteFailed(t: Tx, message: Omit<EventMessage, 'event'> & { event: Extract<SessionEvent, { type: 'writeFailed'; }>; }, deps: ReducerDeps): void {
  const { event } = message;
  const { linkUp, enterFault } = deps;

  if (event.epoch === t.s.epoch && linkUp(t.s)) {
    t.set({ writing: null });
    enterFault(t, 'writeFailed', 'integrity', `a write failed: ${event.detail}`, event.at);
  }
}

function reduceWriteRefused(t: Tx, message: Omit<EventMessage, 'event'> & { event: Extract<SessionEvent, { type: 'writeRefused'; }>; }, deps: ReducerDeps): void {
  const { event } = message;
  const { linkUp, enterFault } = deps;

  if (event.epoch === t.s.epoch && linkUp(t.s)) {
    t.set({ writing: null });
    enterFault(t, 'writeRefused', 'integrity', `the session's write gate refused bytes: ${event.detail}`, event.at);
  }
}

function reduceLinkLost(t: Tx, message: Omit<EventMessage, 'event'> & { event: Extract<SessionEvent, { type: 'linkLost'; }>; }, deps: ReducerDeps): void {
  const { event } = message;
  const { linkUp, onLinkLost } = deps;

  if (event.epoch === t.s.epoch && linkUp(t.s)) onLinkLost(t, event.at);
}

function reduceTimer(t: Tx, message: Omit<EventMessage, 'event'> & { event: Extract<SessionEvent, { type: 'timer'; }>; }, deps: ReducerDeps): void {
  const { event } = message;
  const { onTimer } = deps;

  if (t.s.timers[event.id] === event.seq) {
    const timers = { ...t.s.timers };
    delete timers[event.id];
    t.set({ timers });
    onTimer(t, event.id, event.at);
  }
}

function reduceDriftDetected(t: Tx, message: Omit<EventMessage, 'event'> & { event: Extract<SessionEvent, { type: 'driftDetected'; }>; }, deps: ReducerDeps): void {
  const { event } = message;
  const { linkUp } = deps;

  if (event.epoch === t.s.epoch && linkUp(t.s)) t.addOverlay('NEEDS_REVIEW');
}

function reduceDriftResolved(t: Tx, message: Omit<EventMessage, 'event'> & { event: Extract<SessionEvent, { type: 'driftResolved'; }>; }, deps: ReducerDeps): void {
  const { event } = message;
  const { linkUp } = deps;

  // "Keep the board's settings" (C23): the read became the reference and nothing on the board changed, so the
  // review is done for this link (OD-13 §5: a gate's way out is beside it). Only for the current link.
  if (event.epoch === t.s.epoch && linkUp(t.s) && t.s.overlays.includes('NEEDS_REVIEW')) {
    t.removeOverlay('NEEDS_REVIEW');
    t.emit({ kind: 'log', text: "settings: the board's settings were kept as this computer's reference (C23, nothing written): review resolved" });
  }
}

function reduceLineModeMemory(t: Tx, message: Omit<EventMessage, 'event'> & { event: Extract<SessionEvent, { type: 'lineModeMemory'; }>; }, deps: ReducerDeps): void {
  const { event } = message;
  const { linkUp, features } = deps;

  // The page's remembered line mode for this board (H77). It writes nothing; only a jobs release uses it.
  if (event.epoch === t.s.epoch && linkUp(t.s) && t.config.release.jobs === true) features.onLineModeMemory?.(t, event.remembered);
}

function reduceFamily1(t: Tx, message: EventMessage, deps: ReducerDeps): boolean {
  const { event } = message;
  switch (event.type) {
    case 'intent':
      reduceIntent(t, { ...message, event }, deps);
      return true;
    case 'transportAcquired':
      reduceTransportAcquired(t, { ...message, event }, deps);
      return true;
    case 'transportUnavailable':
    case 'openFailed':
      reduceTransportUnavailable(t, { ...message, event }, deps);
      return true;
    case 'opened':
      reduceOpened(t, { ...message, event }, deps);
      return true;
    case 'inbound':
      reduceInbound(t, { ...message, event }, deps);
      return true;
    case 'lineWritten':
      reduceLineWritten(t, { ...message, event }, deps);
      return true;
    case 'lineDropped':
      reduceLineDropped(t, { ...message, event }, deps);
      return true;
    case 'writeFailed':
      reduceWriteFailed(t, { ...message, event }, deps);
      return true;
    case 'writeRefused':
      reduceWriteRefused(t, { ...message, event }, deps);
      return true;
    case 'linkLost':
      reduceLinkLost(t, { ...message, event }, deps);
      return true;
    case 'timer':
      reduceTimer(t, { ...message, event }, deps);
      return true;
  }
  return false;
}

function reduceFamily2(t: Tx, message: EventMessage, deps: ReducerDeps): void {
  const { event } = message;
  switch (event.type) {
    case 'driftDetected':
      reduceDriftDetected(t, { ...message, event }, deps);
      return;
    case 'driftResolved':
      reduceDriftResolved(t, { ...message, event }, deps);
      return;
    case 'lineModeMemory':
      reduceLineModeMemory(t, { ...message, event }, deps);
      return;
  }
}

function dispatchEvent(t: Tx, message: EventMessage, deps: ReducerDeps): void {
  if (reduceFamily1(t, message, deps)) return;
  reduceFamily2(t, message, deps);
}
