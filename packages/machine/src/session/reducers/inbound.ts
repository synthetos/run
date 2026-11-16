import {
  checkFooterForDialect,
  classifyLine,
  type ClassifiedLine,
  type Inbound
} from '@synthetos/protocol';
import type { ReducerDeps } from './deps.ts';
import type { Tx } from './transaction.ts';

/** Pure transition handlers: only the local transaction changes; all I/O remains ordered effects. */
// --- Inbound --------------------------------------------------------------
export function onInbound(t: Tx, message: { raw: Inbound; at: number; }, deps: ReducerDeps): void {
  const { raw, at } = message;
  const { watchdogMs, dialectOf } = deps;
  if (raw.kind === 'FlowSignal') {
    t.set({ xoff: raw.signal === 'xoff' });
    return;
  }
  // Receive-timestamp liveness (SAFETY §4.2): any line is proof of life.
  t.set({ live: { ...t.s.live, lastRxAt: at }, liveness: null, stale: null });
  t.removeOverlay('STALE');
  if (t.s.timers.watchdog !== undefined) t.arm('watchdog', watchdogMs(t));
  const dialect = dialectOf(t.s);
  const event: ClassifiedLine = dialect === null ? raw : checkFooterForDialect(dialect, raw);
  if (discardBacklog(t, { event, at }, deps)) return;
  if (onInboundFamily1(t, { event, at }, deps)) return;
  onInboundFamily2(t, { event, at }, deps);
}

export function bindInbound(deps: ReducerDeps): Pick<ReducerDeps, 'onInbound'> {
  return {
    onInbound: (t, raw, at) => onInbound(t, { raw: raw, at: at }, deps),
  };
}

interface InboundMessage { event: ClassifiedLine; at: number; }

function onInboundBanner(t: Tx, message: Omit<InboundMessage, 'event'> & { event: Extract<ClassifiedLine, { kind: 'Banner'; }>; }, deps: ReducerDeps): void {
  const { event, at } = message;
  const { onBanner } = deps;

  onBanner(t, event, at);
  return;
}

function onInboundResponse(t: Tx, message: Omit<InboundMessage, 'event'> & { event: Extract<ClassifiedLine, { kind: 'Response'; }>; }, deps: ReducerDeps): void {
  const { event, at } = message;
  const { onResponse } = deps;

  onResponse(t, event, at);
  return;
}

function onInboundStatusReport(t: Tx, message: Omit<InboundMessage, 'event'> & { event: Extract<ClassifiedLine, { kind: 'StatusReport'; }>; }, deps: ReducerDeps): void {
  const { event, at } = message;
  const { onStatusReport } = deps;

  onStatusReport(t, event, at);
  return;
}

function onInboundHeartbeat(t: Tx, message: Omit<InboundMessage, 'event'> & { event: Extract<ClassifiedLine, { kind: 'Heartbeat'; }>; }, deps: ReducerDeps): void {
  const { event } = message;
  const { mergeLive } = deps;

  // Proof of life (recorded above). Its stat and hold are what the board reported: kept for display.
  mergeLive(t, Object.fromEntries(Object.entries(event.hb).filter(([k]) => k === 'stat' || k === 'hold')));
  return;
}

function onInboundFeedLimitSummary(t: Tx, message: Omit<InboundMessage, 'event'> & { event: Extract<ClassifiedLine, { kind: 'FeedLimitSummary'; }>; }, deps: ReducerDeps): void {
  const { event } = message;
  const { features } = deps;

  features.onFeedLimit?.(t, 'fs', event.fs, event.totalsShort);
  return;
}

function onInboundFeedGapSummary(t: Tx, message: Omit<InboundMessage, 'event'> & { event: Extract<ClassifiedLine, { kind: 'FeedGapSummary'; }>; }, deps: ReducerDeps): void {
  const { event } = message;
  const { features } = deps;

  features.onFeedLimit?.(t, 'fg', event.fg, false);
  return;
}

function onInboundFeedLimitEvent(t: Tx, message: Omit<InboundMessage, 'event'> & { event: Extract<ClassifiedLine, { kind: 'FeedLimitEvent'; }>; }, deps: ReducerDeps): void {
  const { event } = message;
  const { features } = deps;

  features.onFeedLimit?.(t, 'fl', event.fl, false);
  return;
}

function onInboundQueueReport(t: Tx, message: Omit<InboundMessage, 'event'> & { event: Extract<ClassifiedLine, { kind: 'QueueReport'; }>; }, _deps: ReducerDeps): void {
  const { event } = message;

  t.set({ live: { ...t.s.live, qr: event.qr } });
  return;
}

function onInboundException(t: Tx, message: Omit<InboundMessage, 'event'> & { event: Extract<ClassifiedLine, { kind: 'Exception'; }>; }, deps: ReducerDeps): void {
  const { event, at } = message;
  const { TINYG_SETTINGS_DEFAULTED, features, enterFault } = deps;

  // TinyG 450.02+ (N61): settings that would not load run on their defaults, reported once right after the
  // banner, so it can arrive while the board is identified again: checked first. The board is working and the
  // user is told which settings changed. Status 90 (a setting with no valid value) and any other `er` stay FAULT.
  if (event.st === TINYG_SETTINGS_DEFAULTED && (t.s.dialect === null || t.s.dialect.id === 'tinyg-en')) {
    t.set({ notices: { ...t.s.notices, settingsDefaulted: { text: event.msg.slice(0, 200), at } } });
    t.emit({ kind: 'log', text: `the board reset stored settings to their defaults (status 118): ${event.msg.slice(0, 120)}` });
    return;
  }
  // An `er` answering the first line is the spliced fragment being rejected (PN §2.3 step 0): recorded only.
  if (t.s.probe !== null && t.s.probe.next === 0 && !t.s.ready) return;
  // A settings write refused because a cycle is active: EN prints an `er` with 106, TG answers 9
  // (SAFETY §4.6 step 6, HIL-4.2). It is a refusal of this write, answered by its own response, not a FAULT.
  if (t.s.settingWrite?.phase === 'writing' && (event.st === 106 || event.st === 9)) {
    t.set({ settingWrite: { ...t.s.settingWrite, exception: event.st } });
    t.emit({ kind: 'log', text: `settings write #${t.s.settingWrite.id}: the board reported ${event.st} (a cycle was active): refused` });
    return;
  }
  // Probe Z: the alarm a probe ends in (250, 220, 203, 207) is its outcome; the owner clears it (C13).
  if (features.onProbeAlarm?.(t, event, at)) return;
  enterFault(t, 'exceptionReport', 'integrity', `the board reported an exception (status ${event.st}): ${event.msg.slice(0, 80)}`, at);
  return;
}

function onInboundProbeReport(t: Tx, message: Omit<InboundMessage, 'event'> & { event: Extract<ClassifiedLine, { kind: 'ProbeReport'; }>; }, deps: ReducerDeps): void {
  const { event, at } = message;
  const { features } = deps;

  features.onProbeReport?.(t, event, at);
  return;
}

function onInboundAck(t: Tx, message: Omit<InboundMessage, 'event'> & { event: Extract<ClassifiedLine, { kind: 'Ack'; }>; }, _deps: ReducerDeps): void {
  const { at } = message;

  t.set({ enqOutstanding: false, lastAckAt: at });
  return;
}

function onInboundGarbled(t: Tx, message: Omit<InboundMessage, 'event'> & { event: Extract<ClassifiedLine, { kind: 'Garbled'; }>; }, deps: ReducerDeps): void {
  const { at } = message;
  const { onGarbled } = deps;

  onGarbled(t, at);
  return;
}

function onInboundRxReport(_t: Tx, _message: Omit<InboundMessage, 'event'> & { event: Extract<ClassifiedLine, { kind: 'RxReport' | 'Text'; }>; }, _deps: ReducerDeps): void {

  return;
}

function onInboundFamily1(t: Tx, message: InboundMessage, deps: ReducerDeps): boolean {
  const { event } = message;
  switch (event.kind) {
    case 'Banner':
      onInboundBanner(t, { ...message, event }, deps);
      return true;
    case 'Response':
      onInboundResponse(t, { ...message, event }, deps);
      return true;
    case 'StatusReport':
      onInboundStatusReport(t, { ...message, event }, deps);
      return true;
    case 'Heartbeat':
      onInboundHeartbeat(t, { ...message, event }, deps);
      return true;
    case 'FeedLimitSummary':
      onInboundFeedLimitSummary(t, { ...message, event }, deps);
      return true;
    case 'FeedGapSummary':
      onInboundFeedGapSummary(t, { ...message, event }, deps);
      return true;
    case 'FeedLimitEvent':
      onInboundFeedLimitEvent(t, { ...message, event }, deps);
      return true;
    case 'QueueReport':
      onInboundQueueReport(t, { ...message, event }, deps);
      return true;
    case 'Exception':
      onInboundException(t, { ...message, event }, deps);
      return true;
    case 'ProbeReport':
      onInboundProbeReport(t, { ...message, event }, deps);
      return true;
    case 'Ack':
      onInboundAck(t, { ...message, event }, deps);
      return true;
    case 'Garbled':
      onInboundGarbled(t, { ...message, event }, deps);
      return true;
  }
  return false;
}

function onInboundFamily2(t: Tx, message: InboundMessage, deps: ReducerDeps): void {
  const { event } = message;
  switch (event.kind) {
    case 'RxReport':
    case 'Text':
      onInboundRxReport(t, { ...message, event }, deps);
      return;
  }
}

function discardBacklog(t: Tx, message: InboundMessage, deps: ReducerDeps): boolean {
  const { event, at } = message;
  const { TINYG_SETTINGS_DEFAULTED, onResponse } = deps;
  // Before the first answer on this link, a line is output a previous program left unread: pushed reports and
  // heartbeats (the board keeps sending them to a port nobody drains), and fragments of them torn by the USB and
  // tty buffers (bench 2, 2026-11-03). The board answers in order, so that backlog ends at the first `r` frame:
  // it is counted and discarded, never merged into the live view and never taken for a damaged answer (H49
  // amendment 2026-11-03). A banner still means the board reset.
  const probe = t.s.probe;
  // A status 118 (TinyG 450.02, settings run on their defaults) follows the banner, so it is in that output after a
  // reset; it is true whenever it was printed, so it is kept, not discarded (handled under Exception).
  const defaulted = event.kind === 'Exception' && event.st === TINYG_SETTINGS_DEFAULTED;
  if (probe !== null && probe.settling === 'none' && probe.next === 0 && !probe.spliceRetried && !t.s.ready && event.kind !== 'Banner' && event.kind !== 'Response' && !defaulted) {
    // A torn frame of that output can run straight into the answer (bench 3, 2026-11-04: half a heartbeat, then
    // the reply to {sr:null} on the same line). The answer is a complete frame at the line's end: take it.
    const from = event.kind === 'Garbled' ? event.line.lastIndexOf('{"r":') : -1;
    const answer = from > 0 ? classifyLine(event.line.slice(from)) : null;
    t.set({ probe: { ...probe, backlog: probe.backlog + 1 } });
    if (answer !== null && answer.kind === 'Response') onResponse(t, answer, at);
    return true;
  }

  return false;
}
