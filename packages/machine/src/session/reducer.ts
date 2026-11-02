/**
 * The read-only session statechart as a pure reducer (ROADMAP P1-02; SAFETY
 * §3, §4.1, §4.4; PN §2.3; OLD-TP §4.2).
 *
 * `reduce(config, state, event)` returns the next state and the effects the
 * executor (machineSession.ts) must carry out. It reads no clock, timer,
 * port or global: time arrives in events, and timers are effects.
 *
 * The path: NOT_CONNECTED → PORT_REQUEST (the worker asks the build's
 * transport source for the chosen port) → OPENING → IDENTIFYING (the
 * capability probe, PN §2.3, `{sr:null}` first) → READING (`stat`,
 * `hold`, `vel`, `qr`, `ex`) → CONNECTED_UNKNOWN. The probe result and the
 * classification are recorded in the session log (a `log` effect). BLOCKED when the board's id is
 * not the selected machine's (T-S21): nothing more is written.
 *
 * Overlays (SAFETY §3), in precedence order FAULT > LOST > ORPHANED_MOTION >
 * UNKNOWN > STALE > READ_ONLY > NEEDS_REVIEW:
 * - FAULT: a banner after the board was ready (T-S10), a write failure or a
 *   refused write, an unexpected response, a footer revision change, an
 *   `er` report, a board that keeps resetting during the probe. Latched;
 *   `ackFault` completes only when two polled reads 250 ms apart show
 *   `hold` = 0 and `qr` = the dialect's `plannerBlocks`, then the board is
 *   probed again from `{sr:null}`.
 * - LOST: the link dropped. The port is closed; acknowledging it returns to
 *   NOT_CONNECTED and the next connect starts with UNKNOWN.
 * - ORPHANED_MOTION: no answer to a probe GET (3 s for the first line), an
 *   unsolicited report showing motion while connecting, or READING finds
 *   the board not idle (`stat` not idle/end, `hold` ≠ 0, `vel` ≠ 0, `qr`
 *   not `plannerBlocks`). A boot banner while unclassified ends it (the
 *   reset ended the motion) and the probe restarts.
 * - UNKNOWN: after LOST, after a reset banner.
 * - STALE: the receive watchdog (SAFETY §4.2, P1-04). On a classified,
 *   connected link, after `livenessIdleMs` of received silence the session
 *   asks for proof of life: ENQ on edge-next after a rev-2/3 footer (at
 *   most one outstanding), otherwise a `stat` GET. No byte within
 *   `staleAfterMs` of asking is unexpected silence: STALE. A read after
 *   classification that goes unanswered is STALE as well. Cleared by the
 *   next line received.
 * - READ_ONLY: the classifier returned READ_ONLY, or READING found `ex`
 *   other than 0 or 1 (2 is RTS/CTS, READ_ONLY on both dialects, PN §5.3;
 *   an unread `ex` counts the same, fail closed).
 * - NEEDS_REVIEW: a settings drift (the drift check that raises it arrives
 *   with the settings read; the overlay and its matrix rules exist now).
 *
 * Phase 1 writes (the only ones this file can produce): single-token GETs
 * from the probe list before classification and from the dialect's read
 * allowlist after it, ENQ (classified `tinyg-en`, after a rev-2/3 footer,
 * at most one outstanding), and the feedhold `!` for Pause, Stop job and
 * Spindle off (the last two with "Use your E-stop", SAFETY §4.4 READ_ONLY
 * row). Every intent goes through `safety.allowed` with the configured
 * release first, and every line through the matrix again when it is sent.
 */
import {
  BYTE,
  PROBE_STEPS,
  buildProbeResult,
  checkFooterForDialect,
  classify,
  mapStat,
  type Banner,
  type ClassifiedLine,
  type Dialect,
  type Inbound,
  type JsonObject,
  type JsonValue,
  type MachineClass,
  type Classification,
  type ProbeKey,
  type ProbeResult,
  type Response,
  type StatusReport,
} from '@synthetos/protocol';
import { OVERLAYS, allowed, type Decision, type Intent, type MatrixSnapshot, type Overlay } from '@synthetos/safety';
import { getLineFor, isReadAllowed } from '@synthetos/schema';
import { writeLineCapFor } from '../writeShape.ts';
import { gateTokens, judgeGate, readBackMatches, readBackValue, settingLine, settingRefusal } from './settingWrite.ts';
import {
  MAX_PROBE_RESTARTS,
  MAX_QUEUED_READS,
  type Axis,
  type Expected,
  type FaultCause,
  type FaultKind,
  type Identity,
  type LiveState,
  type PendingRead,
  type ProbeProgress,
  type ReadPurpose,
  type SessionConfig,
  type SessionEffect,
  type SessionEvent,
  type SessionIntent,
  type SessionState,
  type SettingWriteOutcome,
  type SettingWriteState,
  type TimerId,
  type Transition,
} from './types.ts';

/** Tokens READING reads, where the dialect's allowlist has them (SAFETY H14 inputs, PN §2.3 step 0). */
export const READING_TOKENS: readonly string[] = Object.freeze(['stat', 'hold', 'vel', 'qr', 'ex']);

/**
 * `ex` values a full session accepts: FLOW_CONTROL_OFF and FLOW_CONTROL_XON
 * (@cite EN config.h:204-206; TG config.h:206-208). FLOW_CONTROL_RTS (2)
 * makes the session READ_ONLY on both dialects until B-FC-1 (PN §5.3,
 * OLD-PN §7.1).
 */
export const FULL_SESSION_FLOW_CONTROL: ReadonlySet<number> = new Set([0, 1]);

/** Tokens the `ackFault` verification reads (SAFETY §3 FAULT exits). */
export const VERIFY_TOKENS: readonly string[] = Object.freeze(['hold', 'qr']);

/** The probe's tokens: the only GETs written before the board is classified (PN §2.3, probe.ts). */
export const PROBE_TOKENS: ReadonlySet<string> = new Set(PROBE_STEPS.map((s) => s.key));

const AXES: readonly Axis[] = ['x', 'y', 'z', 'a', 'b', 'c'];

/** Machine classes that mean the board is moving or about to (unsolicited report while connecting). */
const MOTION_CLASSES: ReadonlySet<MachineClass> = new Set(['running', 'homing', 'jogging', 'probing']);

/** Classes READING accepts as "not running anything" (PN §2.3 step 0: stat ∈ {1, 4}). */
const RESTING_CLASSES: ReadonlySet<MachineClass> = new Set(['idle', 'end']);

const EMPTY_LIVE: LiveState = Object.freeze({ pos: Object.freeze({}), mpo: Object.freeze({}) });

export function initialState(): SessionState {
  return Object.freeze({
    base: 'NOT_CONNECTED',
    overlays: Object.freeze([]),
    epoch: 0,
    port: null,
    expectedDeviceId: null,
    unknownOnNextConnect: false,
    xoff: false,
    footerRev: undefined,
    probe: null,
    ready: false,
    identity: null,
    classification: null,
    dialect: null,
    portInfo: null,
    queue: Object.freeze([]),
    expected: Object.freeze([]),
    writing: null,
    enqOutstanding: false,
    liveness: null,
    stale: null,
    live: EMPTY_LIVE,
    values: Object.freeze({}),
    fault: null,
    ackVerify: null,
    blocked: null,
    notices: Object.freeze({ adviseEstop: false }),
    timers: Object.freeze({}),
    timerSeq: 0,
    sent: Object.freeze({ lines: 0, realtime: 0 }),
    settingWrite: null,
  });
}

/** The classified dialect, or null (unclassified, or not yet probed). */
export function dialectOf(state: SessionState): Dialect | null {
  return state.dialect;
}

/** What the allow-matrix needs to know about this state. */
export function matrixSnapshot(state: SessionState): MatrixSnapshot {
  const dialect = dialectOf(state);
  return { base: state.base, overlays: state.overlays, classified: dialect !== null, enqCapable: dialect?.caps.enq === true };
}

/** True when a GET of `token` may be written in this state (probe tokens before classification, the allowlist after). */
export function readableNow(state: SessionState, token: string): boolean {
  const dialect = dialectOf(state);
  if (dialect !== null) return isReadAllowed(dialect.id, token);
  return state.classification === null && PROBE_TOKENS.has(token);
}

/**
 * True when the dialect side of ENQ holds: classified, the dialect has ENQ,
 * and a rev-2/3 footer was seen on this link (T-S24b, T-S87). The
 * allow-matrix (`enq`, with the session's release) is checked separately,
 * at the intent and again right before the write.
 */
export function enqAllowedNow(state: SessionState): boolean {
  return enqByte(state) !== undefined;
}

/** The ENQ byte when `enqAllowedNow` holds (dialect data: present exactly where `caps.enq`), else undefined. */
function enqByte(state: SessionState): number | undefined {
  if (state.footerRev !== 2 && state.footerRev !== 3) return undefined;
  return dialectOf(state)?.realtime.enq?.byte;
}

/** One transition being built. */
class Tx {
  s: SessionState;
  readonly fx: SessionEffect[] = [];
  readonly config: SessionConfig;

  constructor(config: SessionConfig, state: SessionState) {
    this.config = config;
    this.s = state;
  }

  set(patch: Partial<SessionState>): void {
    this.s = { ...this.s, ...patch };
  }

  emit(effect: SessionEffect): void {
    this.fx.push(Object.freeze(effect));
  }

  decide(intent: Intent, decision: Decision): void {
    this.emit({ kind: 'decision', intent, decision: Object.freeze(decision) });
  }

  arm(id: TimerId, ms: number): void {
    const seq = this.s.timerSeq + 1;
    this.set({ timerSeq: seq, timers: { ...this.s.timers, [id]: seq } });
    this.emit({ kind: 'armTimer', id, seq, ms });
  }

  cancel(id: TimerId): void {
    if (this.s.timers[id] === undefined) return;
    const timers = { ...this.s.timers };
    delete timers[id];
    this.set({ timers });
    this.emit({ kind: 'cancelTimer', id });
  }

  cancelAll(): void {
    for (const id of Object.keys(this.s.timers) as TimerId[]) this.cancel(id);
  }

  addOverlay(o: Overlay): void {
    if (this.s.overlays.includes(o)) return;
    this.set({ overlays: OVERLAYS.filter((x) => x === o || this.s.overlays.includes(x)) });
  }

  removeOverlay(o: Overlay): void {
    if (!this.s.overlays.includes(o)) return;
    this.set({ overlays: this.s.overlays.filter((x) => x !== o) });
  }

  done(): Transition {
    return { state: deepFreezeState(this.s), effects: Object.freeze(this.fx) };
  }
}

/** The next state and effects. Pure: never throws for any event in any state. */
export function reduce(config: SessionConfig, state: SessionState, event: SessionEvent): Transition {
  const t = new Tx(config, state);
  switch (event.type) {
    case 'intent':
      onIntent(t, event.request, event.at);
      break;
    case 'transportAcquired':
      if (event.epoch === t.s.epoch && t.s.base === 'PORT_REQUEST') {
        t.set({ base: 'OPENING' });
        t.emit({ kind: 'open', epoch: t.s.epoch });
      }
      break;
    case 'transportUnavailable':
    case 'openFailed':
      if (event.epoch === t.s.epoch && (t.s.base === 'PORT_REQUEST' || t.s.base === 'OPENING')) {
        resetToNotConnected(t, false);
        const code = event.type === 'transportUnavailable' ? 'unavailable' : 'open-failed';
        t.set({ notices: { ...t.s.notices, connectFailed: { code, reason: event.reason } } });
      }
      break;
    case 'opened':
      if (event.epoch === t.s.epoch && t.s.base === 'OPENING') {
        t.set({ portInfo: Object.freeze({ ...event.info }) });
        onOpened(t);
      }
      break;
    case 'inbound':
      if (event.epoch === t.s.epoch && linkUp(t.s)) onInbound(t, event.event, event.at);
      break;
    case 'lineWritten':
      // Only for the line being written: its answer may already have arrived (and the next line been asked for).
      if (event.epoch === t.s.epoch && linkUp(t.s) && t.s.writing?.seq === event.seq) onLineWritten(t);
      break;
    case 'lineDropped':
      if (event.epoch === t.s.epoch && t.s.writing?.seq === event.seq) t.set({ writing: null });
      break;
    case 'writeFailed':
      if (event.epoch === t.s.epoch && linkUp(t.s)) {
        t.set({ writing: null });
        enterFault(t, 'writeFailed', 'integrity', `a write failed: ${event.detail}`, event.at);
      }
      break;
    case 'writeRefused':
      if (event.epoch === t.s.epoch && linkUp(t.s)) {
        t.set({ writing: null });
        enterFault(t, 'writeRefused', 'integrity', `the session's write gate refused bytes: ${event.detail}`, event.at);
      }
      break;
    case 'linkLost':
      if (event.epoch === t.s.epoch && linkUp(t.s)) onLinkLost(t);
      break;
    case 'timer':
      if (t.s.timers[event.id] === event.seq) {
        const timers = { ...t.s.timers };
        delete timers[event.id];
        t.set({ timers });
        onTimer(t, event.id, event.at);
      }
      break;
    case 'driftDetected':
      if (event.epoch === t.s.epoch && linkUp(t.s)) t.addOverlay('NEEDS_REVIEW');
      break;
  }
  pump(t);
  syncWatchdog(t);
  return t.done();
}

/** The port is open and the link has not been lost. */
function linkUp(s: SessionState): boolean {
  return (s.base === 'IDENTIFYING' || s.base === 'READING' || s.base === 'BLOCKED' || s.base === 'CONNECTED_UNKNOWN') && !s.overlays.includes('LOST');
}

// --- Intents -------------------------------------------------------------

const PHASE_1_NOT_HANDLED = {
  reason: 'The machine session does not handle this request in this release.',
  remedy: 'This release only reads the machine; use your usual sender to control it.',
};

function deny(reason: string, remedy: string, citation: string): Decision {
  return { allowed: false, reason, remedy, citation };
}

function onIntent(t: Tx, request: SessionIntent, at: number): void {
  const intent = request.intent;
  const matrix = allowed(matrixSnapshot(t.s), intent, t.config.release);
  if (!matrix.allowed) {
    t.decide(intent, matrix);
    return;
  }
  switch (request.intent) {
    case 'connect': {
      const epoch = t.s.epoch + 1;
      t.s = { ...initialState(), epoch, unknownOnNextConnect: t.s.unknownOnNextConnect || request.unknown === true, timerSeq: t.s.timerSeq };
      t.set({ base: 'PORT_REQUEST', port: request.port, expectedDeviceId: request.expectedDeviceId });
      t.emit({ kind: 'acquireTransport', epoch, port: request.port });
      t.decide(intent, matrix);
      return;
    }
    case 'disconnect': {
      const epoch = t.s.epoch;
      t.cancelAll();
      t.emit({ kind: 'close', epoch });
      resetToNotConnected(t, t.s.unknownOnNextConnect);
      t.decide(intent, matrix);
      return;
    }
    case 'feedhold':
    case 'stopJob':
    case 'spindleOffNow': {
      // Phase 1 (and every READ_ONLY session): the only stop is `!`, with "Use your E-stop" for Stop
      // job and Spindle off (SAFETY §4.4). Never ^D, `%` or an M-code.
      writeFeedhold(t);
      t.set({ notices: { ...t.s.notices, pauseRequestedAt: at, adviseEstop: t.s.notices.adviseEstop || request.intent !== 'feedhold' } });
      t.decide(intent, matrix);
      return;
    }
    case 'ackFault':
      onAckFault(t, matrix);
      return;
    case 'acknowledgeLost':
      resetToNotConnected(t, true);
      t.decide(intent, matrix);
      return;
    case 'enq':
      onEnq(t, matrix);
      return;
    case 'read':
      onRead(t, request.tokens, matrix);
      return;
    case 'settingsWrite':
      onSettingsWrite(t, request.key, request.value, matrix);
      return;
    default:
      t.decide(intent, deny(PHASE_1_NOT_HANDLED.reason, PHASE_1_NOT_HANDLED.remedy, `ROADMAP P1-02 (${t.config.release.name})`));
  }
}

function onEnq(t: Tx, matrix: Decision): void {
  if (t.s.enqOutstanding) {
    t.decide('enq', deny('A liveness probe is already outstanding.', 'Wait for its answer.', 'SAFETY §4.2 (at most one ENQ outstanding)'));
    return;
  }
  const byte = enqByte(t.s);
  if (byte === undefined) {
    t.decide('enq', deny('ENQ is sent only to classified edge-next after a revision 2 or 3 footer.', 'Nothing to do.', 'SAFETY §4.1 Liveness probe row; T-S24b; PN §2.3'));
    return;
  }
  writeEnq(t, byte);
  t.decide('enq', matrix);
}

function writeEnq(t: Tx, byte: number): void {
  t.set({ enqOutstanding: true, sent: { ...t.s.sent, realtime: t.s.sent.realtime + 1 } });
  t.emit({ kind: 'writeRealtime', epoch: t.s.epoch, name: 'enq', byte });
}

function onRead(t: Tx, tokens: readonly string[], matrix: Decision): void {
  const dialect = dialectOf(t.s);
  if (t.s.base === 'BLOCKED') {
    t.decide('read', deny('This board is not the machine you selected, so nothing is sent to it.', 'Choose the right machine, or disconnect.', 'T-S21; SAFETY §3 BLOCKED'));
    return;
  }
  if (dialect === null || t.s.base === 'IDENTIFYING') {
    t.decide('read', deny('Reads are sent only once the board is classified and its read allowlist is known.', 'Wait for the board to be identified.', 'SAFETY H37; PN §12.3'));
    return;
  }
  if (!Array.isArray(tokens) || tokens.length === 0) {
    t.decide('read', deny('Nothing to read.', 'Name at least one setting.', 'SAFETY H37'));
    return;
  }
  const refused = tokens.filter((tok) => typeof tok !== 'string' || !isReadAllowed(dialect.id, tok));
  if (refused.length > 0) {
    const shown = refused.slice(0, 5).map((r) => JSON.stringify(typeof r === 'string' ? r.slice(0, 16) : String(r)));
    t.decide('read', deny(`Not on the ${dialect.id} read allowlist: ${shown.join(', ')}.`, 'Only allowlisted settings can be read.', 'SAFETY H37; PN §12.3; T-S38'));
    return;
  }
  const fresh = [...new Set(tokens)].filter((tok) => !t.s.queue.some((q) => q.token === tok && q.purpose === 'request'));
  if (t.s.queue.length + fresh.length > MAX_QUEUED_READS) {
    t.decide('read', deny('Too many reads are waiting.', 'Wait for the current reads to finish.', 'ROADMAP P1-02'));
    return;
  }
  t.set({ queue: [...t.s.queue, ...fresh.map((token) => ({ token, purpose: 'request' as const }))] });
  t.decide('read', matrix);
}

// --- Settings writes (SAFETY §4.6, H57-H63, amendment 2026-11-02) -----------

/** True while a settings write has not finished. */
export function settingWriteActive(s: SessionState): boolean {
  return s.settingWrite !== null && s.settingWrite.phase !== 'done';
}

function onSettingsWrite(t: Tx, key: unknown, value: unknown, matrix: Decision): void {
  const dialect = dialectOf(t.s);
  /* c8 ignore next 4 -- defence in depth: an unclassified or read-only board carries READ_ONLY, which the matrix denies first */
  if (dialect === null || t.s.classification?.mode !== 'full') {
    t.decide('settingsWrite', deny('Settings are written only to an approved, identified board.', 'Connect a board running approved firmware.', 'SAFETY §4.6; P1-03'));
    return;
  }
  if (settingWriteActive(t.s)) {
    t.decide('settingsWrite', deny('One setting at a time: the last write has not finished.', 'Wait for its answer and read-back.', 'SAFETY §4.6 step 6; firmware maintainer 2026-11-02 (one token at a time)'));
    return;
  }
  if (typeof key !== 'string') {
    t.decide('settingsWrite', deny('Name one setting.', 'Name one setting.', 'SAFETY §4.6'));
    return;
  }
  const refusal = settingRefusal(dialect.id, key, value, t.s.values);
  if (refusal !== null) {
    t.decide('settingsWrite', deny(`Not written: ${refusal}`, 'Correct the value and try again.', 'SAFETY §4.6; PN §12.4 (forbidden writes); schema overlay'));
    return;
  }
  const holdTrusted = restingUsesHold(dialect);
  const tokens = gateTokens(dialect, holdTrusted);
  const id = (t.s.settingWrite?.id ?? 0) + 1;
  t.set({
    settingWrite: { id, key, value: value as number, phase: 'gate', gate: {} },
    queue: [...tokens.map((token) => ({ token, purpose: 'gate' as const })), ...t.s.queue],
  });
  t.emit({ kind: 'log', text: `settings write #${id}: ${key} = ${String(value)} (gate: ${tokens.join(' ')})` });
  t.decide('settingsWrite', matrix);
}

function finishSettingWrite(t: Tx, outcome: SettingWriteOutcome, detail: string, patch: Partial<SettingWriteState> = {}): void {
  const w = t.s.settingWrite;
  /* c8 ignore next -- callers finish only a write in progress; kept so a second finish can never overwrite the first */
  if (w === null || w.phase === 'done') return;
  t.set({
    settingWrite: { ...w, ...patch, phase: 'done', outcome, detail },
    queue: t.s.queue.filter((q) => q.purpose !== 'gate' && q.purpose !== 'setting' && q.purpose !== 'readback'),
  });
  t.emit({ kind: 'log', text: `settings write #${w.id}: ${w.key} → ${outcome}${detail === '' ? '' : ` (${detail})`}` });
}

function onGateAnswer(t: Tx, token: string, r: Response): void {
  const w = t.s.settingWrite;
  /* c8 ignore next -- gate reads are queued only by a write in its gate phase, and dropped when it ends */
  if (w === null || w.phase !== 'gate') return;
  const value = r.r[token];
  if (r.footer.status !== 0 || typeof value !== 'number' || !Number.isFinite(value)) {
    finishSettingWrite(t, 'refused', `Not written: the board did not answer the ${token} read (status ${r.footer.status}).`);
    return;
  }
  const gate = { ...w.gate, [token]: value };
  t.set({ settingWrite: { ...w, gate }, live: withNumber(t, t.s.live, token, value) });
  if (t.s.queue.some((q) => q.purpose === 'gate')) return;
  const dialect = dialectOf(t.s) as Dialect;
  const verdict = judgeGate(dialect, gate, restingUsesHold(dialect));
  if (!verdict.ok) {
    finishSettingWrite(t, 'refused', verdict.detail);
    return;
  }
  // The state may have changed while the gate was read (an overlay, a status report): ask the matrix again.
  const again = allowed(matrixSnapshot(t.s), 'settingsWrite', t.config.release);
  /* c8 ignore next 4 -- an overlay that denies writes (FAULT, LOST) also ends the write before the gate completes; the re-check stays */
  if (!again.allowed) {
    finishSettingWrite(t, 'refused', `Not written: ${again.reason}`);
    return;
  }
  t.set({ settingWrite: { ...(t.s.settingWrite as SettingWriteState), phase: 'writing' }, queue: [{ token: w.key, purpose: 'setting', value: w.value }, ...t.s.queue] });
}

function onSettingAnswer(t: Tx, r: Response): void {
  const w = t.s.settingWrite;
  /* c8 ignore next -- a setting line is written only in the writing phase */
  if (w === null || w.phase !== 'writing') return;
  const echoed = readBackValue(r.r, w.key);
  if (w.exception !== undefined && r.footer.status === 0) {
    // TG answers 0 after an `er` 9 although nothing was saved (TG-SETTINGS-GATE): the `er` decides.
    finishSettingWrite(t, 'rejected', `The board refused to save the setting (status ${w.exception}: a cycle was active); it may hold the value until a reset.`, { answer: { status: 0, value: echoed } });
    return;
  }
  if (r.footer.status !== 0) {
    finishSettingWrite(t, 'rejected', `The board refused the write (status ${r.footer.status}); the setting was not stored.`, { answer: { status: r.footer.status, value: echoed } });
    return;
  }
  t.set({ settingWrite: { ...w, phase: 'readback', answer: { status: 0, value: echoed } }, queue: [{ token: w.key, purpose: 'readback' }, ...t.s.queue] });
}

function onReadBackAnswer(t: Tx, r: Response, at: number): void {
  const w = t.s.settingWrite;
  /* c8 ignore next -- a read-back is queued only in the readback phase */
  if (w === null || w.phase !== 'readback') return;
  const value = readBackValue(r.r, w.key);
  t.set({ values: { ...t.s.values, [w.key]: { value, status: r.footer.status, at } } });
  const dialect = dialectOf(t.s) as Dialect;
  if (r.footer.status === 0 && readBackMatches(dialect.id, w.key, w.value, value)) {
    finishSettingWrite(t, 'verified', '', { readBack: value });
    return;
  }
  const shown = r.footer.status !== 0 ? `the read-back failed (status ${r.footer.status})` : `the board reads back ${JSON.stringify(value)}, not ${w.value}`;
  finishSettingWrite(t, 'mismatch', `Written, but ${shown}.`, { readBack: value });
}

/** A settings write in progress is cut off (FAULT, LOST, reset, link change). */
function interruptSettingWrite(t: Tx, why: string): void {
  if (!settingWriteActive(t.s)) return;
  const w = t.s.settingWrite as SettingWriteState;
  // A write already sent may have been stored: say so.
  const outcome: SettingWriteOutcome = w.phase === 'gate' ? 'refused' : 'interrupted';
  finishSettingWrite(t, outcome, outcome === 'refused' ? `Not written: ${why}.` : `Interrupted: ${why}. The board may or may not hold the new value; read it back before trusting it.`);
}

function onAckFault(t: Tx, matrix: Decision): void {
  const dialect = dialectOf(t.s);
  if (t.s.ackVerify !== null) {
    t.decide('ackFault', deny('The fault is already being verified.', 'Wait for the verification to finish.', 'SAFETY §3 FAULT exits'));
    return;
  }
  if (dialect === null || !VERIFY_TOKENS.every((tok) => isReadAllowed(dialect.id, tok))) {
    t.decide(
      'ackFault',
      deny(
        'This board is not classified, so the session cannot verify that it has stopped and emptied its planner.',
        'Check the machine is stopped, then disconnect and connect again.',
        'SAFETY §3 FAULT exits (ackFault cannot complete while hold ≠ 0 or the planner is not empty)',
      ),
    );
    return;
  }
  const { ackFaultRefused: _dropped, ...notices } = t.s.notices;
  t.set({ ackVerify: { round: 0 }, notices, queue: [...VERIFY_TOKENS.map((token) => ({ token, purpose: 'verify' as const })), ...t.s.queue] });
  t.decide('ackFault', matrix);
}

function writeFeedhold(t: Tx): void {
  const byte = dialectOf(t.s)?.realtime.feedhold.byte ?? BYTE.FEEDHOLD;
  t.set({ sent: { ...t.s.sent, realtime: t.s.sent.realtime + 1 } });
  t.emit({ kind: 'writeRealtime', epoch: t.s.epoch, name: 'feedhold', byte });
}

/** Back to NOT_CONNECTED on a new epoch (late events of the old link are ignored). */
function resetToNotConnected(t: Tx, unknownOnNextConnect: boolean): void {
  t.cancelAll();
  t.s = { ...initialState(), epoch: t.s.epoch + 1, unknownOnNextConnect, timerSeq: t.s.timerSeq, notices: { adviseEstop: false } };
}

// --- Link events ----------------------------------------------------------

function onOpened(t: Tx): void {
  t.set({ base: 'IDENTIFYING' });
  if (t.s.unknownOnNextConnect) {
    t.addOverlay('UNKNOWN');
    t.set({ unknownOnNextConnect: false });
  }
  startProbe(t, 0, undefined);
}

/** (Re)starts the probe from `{sr:null}`: the first line written on every connect path (T-S86, H49). */
function startProbe(t: Tx, restarts: number, banner: Banner | undefined): void {
  t.set({
    probe: { next: 0, answers: [], banner, spliceRetried: false, settling: 'none', restarts },
    classification: null,
    dialect: null,
    identity: null,
    ready: false,
    footerRev: undefined,
    queue: [{ token: 'sr', purpose: 'splice' }],
  });
}

function onLineWritten(t: Tx): void {
  const { seq: _seq, ...line } = t.s.writing as PendingRead & { readonly seq: number };
  t.set({ writing: null });
  // A line written while the board was resetting is lost with its RX ring: expect nothing for it.
  if (t.s.probe !== null && t.s.probe.settling !== 'none') return;
  t.set({ expected: [...t.s.expected, { ...line, late: false }] });
  t.arm('answer', answerTimeout(t, line.purpose));
}

function answerTimeout(t: Tx, purpose: ReadPurpose): number {
  const timings = t.config.timings;
  if (purpose === 'splice') return timings.firstAnswerMs;
  if (purpose === 'probe') return timings.probeAnswerMs;
  return timings.readAnswerMs;
}

function onLinkLost(t: Tx): void {
  interruptSettingWrite(t, 'the connection was lost');
  t.cancelAll();
  t.addOverlay('LOST');
  t.set({ queue: [], expected: [], writing: null, ackVerify: null, xoff: false, enqOutstanding: false, liveness: null, unknownOnNextConnect: true });
  t.emit({ kind: 'close', epoch: t.s.epoch });
}

function onTimer(t: Tx, id: TimerId, at: number): void {
  if (id === 'settle') {
    const probe = t.s.probe;
    if (probe === null || probe.settling === 'none') return;
    if (probe.restarts >= MAX_PROBE_RESTARTS) {
      t.set({ probe: { ...probe, settling: 'none' } });
      enterFault(t, 'resetLoop', 'integrity', `the board reset ${probe.restarts + 1} times while it was being identified`, at);
      return;
    }
    startProbe(t, probe.restarts + 1, probe.banner);
    return;
  }
  if (id === 'watchdog') {
    onWatchdog(t, at);
    return;
  }
  if (id === 'verify') {
    if (t.s.ackVerify?.round === 1) t.set({ queue: [...VERIFY_TOKENS.map((token) => ({ token, purpose: 'verify' as const })), ...t.s.queue] });
    return;
  }
  // 'answer': the line in flight went unanswered.
  const index = t.s.expected.findIndex((e) => !e.late);
  if (index < 0) return;
  const missed = t.s.expected[index] as Expected;
  t.set({ expected: t.s.expected.map((e, i) => (i === index ? { ...e, late: true } : e)) });
  if (missed.purpose === 'splice' || missed.purpose === 'probe') {
    // A busy or silent board (PN §2.3 step 0): only stop-class bytes from now on.
    t.addOverlay('ORPHANED_MOTION');
    t.set({ queue: [] });
    return;
  }
  if (missed.purpose === 'gate') finishSettingWrite(t, 'refused', `Not written: the board did not answer the ${missed.token} read in time.`);
  if (missed.purpose === 'setting') finishSettingWrite(t, 'unconfirmed', 'The board did not answer the write in time. It may or may not hold the new value; read it back before trusting it.');
  if (missed.purpose === 'readback') finishSettingWrite(t, 'mismatch', 'Written (status 0), but the read-back was not answered in time.');
  enterStale(t, at);
  const pendingReading = t.s.queue.some((q) => q.purpose === 'reading') || missed.purpose === 'reading';
  t.set({ queue: [] });
  if (missed.purpose === 'verify' || t.s.ackVerify !== null) {
    t.set({ ackVerify: null, notices: { ...t.s.notices, ackFaultRefused: `no answer to the ${missed.token} read` } });
  }
  if (t.s.base === 'READING' && pendingReading) finishReading(t);
}

// --- Inbound --------------------------------------------------------------

function onInbound(t: Tx, raw: Inbound, at: number): void {
  if (raw.kind === 'FlowSignal') {
    t.set({ xoff: raw.signal === 'xoff' });
    return;
  }
  // Receive-timestamp liveness (SAFETY §4.2): any line is proof of life.
  t.set({ live: { ...t.s.live, lastRxAt: at }, liveness: null, stale: null });
  t.removeOverlay('STALE');
  if (t.s.timers.watchdog !== undefined) t.arm('watchdog', t.config.timings.livenessIdleMs);
  const dialect = dialectOf(t.s);
  const event: ClassifiedLine = dialect === null ? raw : checkFooterForDialect(dialect, raw);
  switch (event.kind) {
    case 'Banner':
      onBanner(t, event, at);
      return;
    case 'Response':
      onResponse(t, event, at);
      return;
    case 'StatusReport':
      onStatusReport(t, event);
      return;
    case 'QueueReport':
      t.set({ live: { ...t.s.live, qr: event.qr } });
      return;
    case 'Exception':
      // An `er` answering the first line is the spliced fragment being rejected (PN §2.3 step 0): recorded only.
      if (t.s.probe !== null && t.s.probe.next === 0 && !t.s.ready) return;
      // A settings write refused because a cycle is active: EN prints an `er` with 106, TG answers 9
      // (SAFETY §4.6 step 6, HIL-4.2). It is a refusal of this write, answered by its own response, not a FAULT.
      if (t.s.settingWrite?.phase === 'writing' && (event.st === 106 || event.st === 9)) {
        t.set({ settingWrite: { ...t.s.settingWrite, exception: event.st } });
        t.emit({ kind: 'log', text: `settings write #${t.s.settingWrite.id}: the board reported ${event.st} (a cycle was active): refused` });
        return;
      }
      enterFault(t, 'exceptionReport', 'integrity', `the board reported an exception (status ${event.st}): ${event.msg.slice(0, 80)}`, at);
      return;
    case 'Ack':
      t.set({ enqOutstanding: false, lastAckAt: at });
      return;
    case 'Garbled':
      onGarbled(t, at);
      return;
    case 'RxReport':
    case 'Text':
      return;
  }
}

function onBanner(t: Tx, banner: Banner, at: number): void {
  interruptSettingWrite(t, 'the board reset');
  // The board restarted: it boots in XON and never says so (@cite EN xio/xio_usart.c:128-130).
  // An ENQ written before the reset was either answered before the banner (lines arrive in order) or
  // lost with the RX ring, so no `ack` is still owed.
  t.set({ xoff: false, enqOutstanding: false });
  if (t.s.ready) {
    // SAFETY H19, T-S10: any banner after Ready means the board reset. FAULT, then UNKNOWN.
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
  t.arm('settle', isReady ? t.config.timings.bannerSettleMs : t.config.timings.bannerWaitMs);
}

function onResponse(t: Tx, r: Response, at: number): void {
  if (t.s.probe !== null && t.s.probe.settling !== 'none') return; // answers a line from before the reset
  if (t.s.footerRev === undefined) {
    t.set({ footerRev: r.footer.rev });
  } else if (r.footer.rev !== t.s.footerRev) {
    enterFault(t, 'footerRevisionChanged', 'integrity', `the footer revision changed from ${t.s.footerRev} to ${r.footer.rev}: the board was reset or reconfigured`, at);
    return;
  }
  // The board answers lines in order. Late (timed-out) entries ahead of the match are lost. The line
  // being written comes last: its answer can arrive before the transport reports the write complete.
  const owed = owedAnswers(t.s);
  let index = -1;
  for (let i = 0; i < owed.length; i++) {
    const e = owed[i] as Expected;
    if (answers(e, r)) {
      index = i;
      break;
    }
    if (!e.late) break;
  }
  if (index < 0 || r.tid !== undefined) {
    // No tid is ever sent in Phase 1, so an echoed one answers a request this session never made (SAFETY §3).
    enterFault(t, 'unexpectedResponse', 'integrity', `a response nobody asked for: ${r.line.slice(0, 80)}`, at);
    return;
  }
  const entry = owed[index] as Expected;
  consumeOwed(t, index);
  if (entry.late) return;
  t.cancel('answer');
  onAnswer(t, entry, r, at);
}

/** Answers the board owes, oldest first: the written lines, then the line being written. */
function owedAnswers(s: SessionState): readonly Expected[] {
  return s.writing === null ? s.expected : [...s.expected, { token: s.writing.token, purpose: s.writing.purpose, late: false }];
}

/** Removes the first `index + 1` owed answers (the last of them may be the line being written). */
function consumeOwed(t: Tx, index: number): void {
  if (index >= t.s.expected.length) t.set({ expected: [], writing: null });
  else t.set({ expected: t.s.expected.slice(index + 1) });
}

/** Does `r` answer `e`? A GET's answer holds its own key or nothing; the first line accepts any answer (a splice). */
function answers(e: Expected, r: Response): boolean {
  if (e.purpose === 'splice') return true;
  const keys = Object.keys(r.r);
  return keys.length === 0 || (keys.length === 1 && keys[0] === e.token);
}

function onAnswer(t: Tx, e: PendingRead, r: Response, at: number): void {
  const value: JsonValue | undefined = r.r[e.token];
  switch (e.purpose) {
    case 'splice': {
      const probe = t.s.probe as ProbeProgress;
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
    case 'probe': {
      const probe = t.s.probe as ProbeProgress;
      advanceProbe(t, { ...probe, next: probe.next + 1, answers: [...probe.answers, [e.token as ProbeKey, r]] });
      return;
    }
    case 'reading':
      if (r.footer.status === 0 && typeof value === 'number' && Number.isFinite(value)) {
        t.set({ live: withNumber(t, t.s.live, e.token, value) });
      }
      if (!t.s.queue.some((q) => q.purpose === 'reading')) finishReading(t);
      return;
    case 'request':
      t.set({ values: { ...t.s.values, [e.token]: { value: value ?? null, status: r.footer.status, at } } });
      return;
    case 'verify':
      onVerifyAnswer(t, e.token, r.footer.status === 0 && typeof value === 'number' ? value : undefined);
      return;
    case 'liveness':
      // The answer itself is the proof of life (already recorded on receipt); keep the value it carries.
      if (r.footer.status === 0 && typeof value === 'number') t.set({ live: withNumber(t, t.s.live, e.token, value) });
      return;
    case 'gate':
      onGateAnswer(t, e.token, r);
      return;
    case 'setting':
      onSettingAnswer(t, r);
      return;
    case 'readback':
      onReadBackAnswer(t, r, at);
      return;
  }
}

function advanceProbe(t: Tx, probe: ProbeProgress): void {
  t.set({ probe });
  if (probe.next < PROBE_STEPS.length) {
    if (t.s.overlays.includes('ORPHANED_MOTION')) return;
    const step = PROBE_STEPS[probe.next] as (typeof PROBE_STEPS)[number];
    t.set({ queue: [...t.s.queue, { token: step.key, purpose: 'probe' }] });
    return;
  }
  finishProbe(t);
}

function finishProbe(t: Tx): void {
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
    },
  });
  if (c.mode === 'readOnly') t.addOverlay('READ_ONLY');
  if (c.dialect !== null) t.emit({ kind: 'tightenLineCap', epoch: t.s.epoch, maxLineBytes: writeLineCapFor(c.dialect) });
  if (t.s.expectedDeviceId !== null && result.id !== t.s.expectedDeviceId) {
    // T-S21: the board is not the selected machine. Nothing more is written.
    t.set({ base: 'BLOCKED', blocked: { expected: t.s.expectedDeviceId, reported: result.id ?? null }, queue: [] });
    return;
  }
  const dialect = c.dialect;
  const reads = dialect === null ? [] : READING_TOKENS.filter((tok) => isReadAllowed(dialect.id, tok));
  if (reads.length === 0 || t.s.overlays.includes('ORPHANED_MOTION')) {
    t.set({ base: 'CONNECTED_UNKNOWN' });
    if (dialect === null) checkUnclassifiedResting(t);
    return;
  }
  // Only READING's own answers count: values from the earlier `{sr:null}` answer are dropped, so a
  // read that fails leaves its value unknown and the board is not trusted as resting.
  const { stat: _stat, machineClass: _class, hold: _hold, vel: _vel, qr: _qr, ...kept } = t.s.live;
  t.set({ base: 'READING', live: kept, queue: [...t.s.queue, ...reads.map((token) => ({ token, purpose: 'reading' as const }))] });
}

/** The probe result and its classification as one session-log line (ROADMAP P1-03 "Record the probe result"). */
export function probeRecord(result: ProbeResult, c: Classification): string {
  const { footers, ...rest } = result;
  const verdict = `${c.dialect?.id ?? 'unclassified'} ${c.mode === 'full' ? 'full' : 'read-only'} (${c.reason})`;
  return `probe: ${JSON.stringify({ ...rest, footers: footers.map((f) => f.raw) })} → ${verdict}: ${c.detail}`;
}

/** Raw `stat` values that count as resting without a dialect: READY and PROGRAM_END (SAFETY H14 mitigation 2). */
const UNCLASSIFIED_RESTING_STAT: ReadonlySet<number> = new Set([1, 4]);

/**
 * The probe ended without a dialect (a failed or damaged probe), so READING never runs. The raw
 * values from the `{sr:null}` answer are all there is: a board that is not plainly resting is
 * treated as busy (SAFETY H14 mitigation 5, T-S60), never as merely read-only.
 */
function checkUnclassifiedResting(t: Tx): void {
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

/**
 * Whether the resting check consults `hold` on this dialect. SAFETY H14 mitigation 2: only where the
 * dialect does not list `hold` as unverified (on 440.21 only `stat` and `vel` are used).
 */
export function restingUsesHold(dialect: Dialect): boolean {
  return !dialect.unverified.some((u) => u.field === 'hold');
}

/** READING is complete: a board that is not resting is ORPHANED_MOTION (SAFETY H14, PN §2.3 step 0). */
function finishReading(t: Tx): void {
  const dialect = dialectOf(t.s);
  const live = t.s.live;
  const resting =
    dialect !== null &&
    live.stat !== undefined &&
    RESTING_CLASSES.has(mapStat(dialect, live.stat)) &&
    (!restingUsesHold(dialect) || live.hold === 0) &&
    live.vel === 0 &&
    live.qr === dialect.limits.plannerBlocks;
  if (!resting) t.addOverlay('ORPHANED_MOTION');
  const c = t.s.classification;
  if (c !== null && c.mode === 'full' && (live.ex === undefined || !FULL_SESSION_FLOW_CONTROL.has(live.ex))) {
    const shown = live.ex === undefined ? 'could not be read' : `is ${live.ex}${live.ex === 2 ? ' (RTS/CTS)' : ''}`;
    t.set({ classification: { ...c, mode: 'readOnly', reason: 'flowControl', detail: `${c.detail}; flow control (ex) ${shown}: read-only until RTS/CTS is verified on the bench (B-FC-1)` } });
    t.addOverlay('READ_ONLY');
    t.emit({ kind: 'log', text: `classification: read-only, flow control (ex) ${shown}` });
  }
  t.set({ base: 'CONNECTED_UNKNOWN', queue: t.s.queue.filter((q) => q.purpose !== 'reading') });
}

function onVerifyAnswer(t: Tx, token: string, value: number | undefined): void {
  const verify = t.s.ackVerify;
  if (verify === null) return;
  const next = { ...verify, [token]: value };
  if (value === undefined) {
    refuseAck(t, `the ${token} read gave no value`);
    return;
  }
  t.set({ ackVerify: next });
  if (next.hold === undefined || next.qr === undefined) return;
  const dialect = dialectOf(t.s) as Dialect;
  if (next.hold !== 0 || next.qr !== dialect.limits.plannerBlocks) {
    refuseAck(t, `hold is ${next.hold} and the planner has ${next.qr} of ${dialect.limits.plannerBlocks} buffers free: the board has not stopped`);
    return;
  }
  if (next.round === 0) {
    t.set({ ackVerify: { round: 1 } });
    t.arm('verify', t.config.timings.verifyIntervalMs);
    return;
  }
  // Verified twice: the fault is acknowledged. Identify the board again from `{sr:null}`; the position is not trusted.
  t.set({ fault: null, ackVerify: null, base: 'IDENTIFYING', queue: [] });
  t.removeOverlay('FAULT');
  t.removeOverlay('READ_ONLY');
  t.removeOverlay('ORPHANED_MOTION');
  t.addOverlay('UNKNOWN');
  startProbe(t, 0, undefined);
}

function refuseAck(t: Tx, why: string): void {
  t.cancel('verify');
  t.set({ ackVerify: null, queue: t.s.queue.filter((q) => q.purpose !== 'verify'), notices: { ...t.s.notices, ackFaultRefused: why } });
}

function onStatusReport(t: Tx, report: StatusReport): void {
  mergeLive(t, report.sr);
  if (t.s.base !== 'IDENTIFYING' && t.s.base !== 'READING') return;
  const live = t.s.live;
  const moving = (typeof report.sr['vel'] === 'number' && report.sr['vel'] !== 0) || (live.machineClass !== undefined && MOTION_CLASSES.has(live.machineClass) && 'stat' in report.sr);
  if (moving) {
    // PN §2.3 step 0: unsolicited reports showing motion while connecting.
    t.addOverlay('ORPHANED_MOTION');
    if (t.s.classification === null) t.set({ queue: [] });
  }
}

function onGarbled(t: Tx, at: number): void {
  if (t.s.probe !== null && t.s.probe.settling !== 'none') return;
  const owed = owedAnswers(t.s);
  const index = owed.findIndex((e) => !e.late);
  if (index < 0) return; // nothing was asked: nothing to trust or distrust
  // The answer in flight arrived damaged.
  const entry = owed[index] as Expected;
  consumeOwed(t, index);
  t.cancel('answer');
  switch (entry.purpose) {
    case 'splice': {
      // A damaged answer cannot prove that the first line was parsed as sr.
      // It may have completed a pre-existing motion fragment. Only a validated
      // sr-bearing error in onAnswer may retry; uncertainty stops the probe.
      t.emit({ kind: 'log', text: 'probe: the answer to the first line ({sr:null}) arrived damaged: it cannot show the line was read as a status request, and a leftover partial line in the board\'s buffer may have joined it and run → ORPHANED_MOTION' });
      t.addOverlay('ORPHANED_MOTION');
      t.set({ queue: [] });
      return;
    }
    case 'probe':
      t.set({
        ready: true,
        base: 'CONNECTED_UNKNOWN',
        queue: [],
        classification: { dialectId: null, mode: 'readOnly', reason: 'probeFailed', detail: `the answer to the ${entry.token} probe arrived damaged`, upgradeOffer: false },
      });
      t.addOverlay('READ_ONLY');
      t.emit({ kind: 'log', text: `probe: the answer to ${entry.token} arrived damaged → unclassified, read-only` });
      checkUnclassifiedResting(t);
      return;
    case 'reading':
      if (!t.s.queue.some((q) => q.purpose === 'reading')) finishReading(t);
      return;
    case 'request':
      t.set({ values: { ...t.s.values, [entry.token]: { value: null, status: -1, at } } });
      return;
    case 'verify':
      refuseAck(t, `the ${entry.token} read arrived damaged`);
      return;
    case 'liveness':
      return;
    case 'gate':
      finishSettingWrite(t, 'refused', `Not written: the answer to the ${entry.token} read arrived damaged.`);
      return;
    case 'setting':
      finishSettingWrite(t, 'unconfirmed', 'The answer to the write arrived damaged. The board may or may not hold the new value; read it back before trusting it.');
      return;
    case 'readback':
      finishSettingWrite(t, 'mismatch', 'Written (status 0), but the read-back arrived damaged.');
      return;
  }
}

// --- Live values ------------------------------------------------------------

function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function mergeLive(t: Tx, fields: JsonObject): void {
  let live = t.s.live;
  for (const [key, v] of Object.entries(fields)) {
    if (typeof v === 'number' && Number.isFinite(v)) live = withNumber(t, live, key, v);
  }
  t.set({ live });
}

function withNumber(t: Tx, live: LiveState, key: string, v: number): LiveState {
  switch (key) {
    case 'stat': {
      const dialect = dialectOf(t.s);
      return { ...live, stat: v, ...(dialect === null ? {} : { machineClass: mapStat(dialect, v) }) };
    }
    case 'hold':
    case 'vel':
    case 'qr':
    case 'ex':
    case 'line':
    case 'unit':
    case 'feed':
    case 'tool':
    // Display only (spindle and coolant outputs as last driven): stored for the UI, read by no decision here.
    case 'spe':
    case 'spc':
    case 'spd':
    case 'sps':
    case 'cof':
    case 'com':
      return { ...live, [key]: v };
  }
  for (const axis of AXES) {
    if (key === `pos${axis}`) return { ...live, pos: { ...live.pos, [axis]: v } };
    if (key === `mpo${axis}`) return { ...live, mpo: { ...live.mpo, [axis]: v } };
  }
  return live;
}

// --- Watchdog (SAFETY §4.2) -------------------------------------------------

/** The token of the proof-of-life GET where ENQ is not available. */
export const LIVENESS_TOKEN = 'stat';

/** The watchdog runs on a classified, connected link (it needs the dialect's ENQ or its read allowlist). */
function watchdogActive(s: SessionState): boolean {
  return linkUp(s) && s.base === 'CONNECTED_UNKNOWN' && dialectOf(s) !== null;
}

/** Arms the watchdog when it should run and is not armed; stops it when it should not run. */
function syncWatchdog(t: Tx): void {
  if (watchdogActive(t.s)) {
    if (t.s.timers.watchdog === undefined) t.arm('watchdog', t.config.timings.livenessIdleMs);
    return;
  }
  t.cancel('watchdog');
  t.set({ liveness: null });
}

function enterStale(t: Tx, at: number): void {
  if (t.s.overlays.includes('STALE')) return;
  t.addOverlay('STALE');
  // The watchdog and the read timeouts run only after the board has answered, so a receive time exists.
  t.set({ stale: { at, silentForMs: Math.max(0, at - (t.s.live.lastRxAt as number)) } });
}

function onWatchdog(t: Tx, at: number): void {
  // Armed only while the watchdog is active: syncWatchdog cancels it in the transition that ends that.
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
function askForLife(t: Tx): 'enq' | 'get' {
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

// --- FAULT ------------------------------------------------------------------

function enterFault(t: Tx, cause: FaultCause, kind: FaultKind, detail: string, at: number): void {
  interruptSettingWrite(t, 'a fault latched');
  if (t.s.fault === null) t.set({ fault: { cause, kind, detail, at } });
  t.addOverlay('FAULT');
  t.cancel('verify');
  // Stop feeding (SAFETY §3 FAULT entry effect 1). Lines already written may still be answered.
  t.set({ queue: [], ackVerify: null });
  const live = t.s.live;
  const moving = (live.vel !== undefined && live.vel !== 0) || (live.machineClass !== undefined && MOTION_CLASSES.has(live.machineClass));
  // Effect 2: the machine was moving, so hold it. Phase 1 never ran a job; nothing else is sent.
  if (moving && allowed(matrixSnapshot(t.s), 'feedhold', t.config.release).allowed) writeFeedhold(t);
}

// --- Writing ----------------------------------------------------------------

/** Writes the next queued read when nothing is in flight and the matrix allows a read now. */
function pump(t: Tx): void {
  const s = t.s;
  if (s.writing !== null || s.queue.length === 0 || !linkUp(s)) return;
  if (s.expected.some((e) => !e.late)) return;
  const next = s.queue[0] as PendingRead;
  const intent = next.purpose === 'setting' ? 'settingsWrite' : 'read';
  if (!allowed(matrixSnapshot(s), intent, t.config.release).allowed) {
    // A write the matrix no longer allows is dropped, never held for later (the state that allowed it is gone).
    /* c8 ignore next -- the setting line is queued in the same transition the matrix allowed it; dropped, never held, if that ever changes */
    if (intent === 'settingsWrite') finishSettingWrite(t, 'refused', 'Not written: the machine is no longer in a state that allows settings writes.');
    return;
  }
  const line = lineFor(s, next);
  if (line === undefined) {
    t.set({ queue: s.queue.slice(1) });
    enterFault(t, 'writeRefused', 'integrity', `no allowlisted GET for ${JSON.stringify(next.token)} in this state`, s.live.lastRxAt ?? 0);
    return;
  }
  const seq = s.sent.lines + 1;
  t.set({ queue: s.queue.slice(1), writing: { ...next, seq }, sent: { ...s.sent, lines: seq } });
  t.emit({ kind: 'writeLine', epoch: s.epoch, seq, token: next.token, line, ...(intent === 'settingsWrite' ? { intent } : {}) });
}

function lineFor(s: SessionState, read: PendingRead): string | undefined {
  /* c8 ignore start -- the queued setting line always matches the write in progress; any mismatch is a bug and becomes a writeRefused FAULT */
  if (read.purpose === 'setting') {
    const w = s.settingWrite;
    const dialect = dialectOf(s);
    if (w === null || w.phase !== 'writing' || w.key !== read.token || w.value !== read.value || dialect === null) return undefined;
    if (settingRefusal(dialect.id, w.key, w.value, s.values) !== null) return undefined;
    return settingLine(w.key, w.value) ?? undefined;
  }
  /* c8 ignore stop */
  if (!readableNow(s, read.token)) return undefined;
  const dialect = dialectOf(s);
  if (dialect === null) return PROBE_STEPS.find((step) => step.key === read.token)?.line;
  return getLineFor(dialect.id, read.token);
}

function deepFreezeState(s: SessionState): SessionState {
  return deepFreeze(s);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return Object.freeze(value);
}
