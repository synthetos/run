import {
  type Dialect,
  type JsonObject,
  type JsonValue
} from '@synthetos/protocol';
import { type Decision, type MatrixSnapshot } from '@synthetos/safety';
import { isReadAllowed } from '@synthetos/schema';
import { BOARD_MODES_UNKNOWN } from '../boardModes.ts';
import { PROBE_CLOSED } from '../inactiveFeatures.ts';
import {
  READY_BASES,
  type SessionState
} from '../types.ts';
import type { ReducerDeps } from './deps.ts';

/** Pure transition handlers: only the local transaction changes; all I/O remains ordered effects. */
export function initialState(deps: ReducerDeps): SessionState {
  const { EMPTY_LIVE, REPORTS_IDLE, DEFAULT_SILENCE_MS, RXM_IDLE } = deps;
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
    motion: null,
    polled: null,
    settingWrite: null,
    bootEntry: null,
    reports: REPORTS_IDLE,
    link: Object.freeze({ heartbeatMs: null, silenceMs: DEFAULT_SILENCE_MS }),
    job: null,
    rxm: RXM_IDLE,
    rtLeaves: Object.freeze([]),
    probeZ: PROBE_CLOSED,
    boardModes: BOARD_MODES_UNKNOWN,
    alarmRestore: null,
  });
}

/** The classified dialect, or null (unclassified, or not yet probed). */
export function dialectOf(state: SessionState, _deps: ReducerDeps): Dialect | null {
  return state.dialect;
}

/** What the allow-matrix needs to know about this state. */
export function matrixSnapshot(state: SessionState, deps: ReducerDeps): MatrixSnapshot {
  const { dialectOf } = deps;
  const dialect = dialectOf(state);
  return { base: state.base, overlays: state.overlays, classified: dialect !== null, enqCapable: dialect?.caps.enq === true };
}

/** True when a GET of `token` may be written in this state (probe tokens before classification, the allowlist after). */
export function readableNow(state: SessionState, token: string, deps: ReducerDeps): boolean {
  const { dialectOf, PROBE_TOKENS } = deps;
  const dialect = dialectOf(state);
  if (dialect !== null) return isReadAllowed(dialect.id, token, state.identity?.fb);
  return state.classification === null && PROBE_TOKENS.has(token);
}

/**
 * True when the dialect side of ENQ holds: classified, the dialect has ENQ,
 * and a rev-2/3 footer was seen on this link (T-S24b, T-S87). The
 * allow-matrix (`enq`, with the session's release) is checked separately,
 * at the intent and again right before the write.
 */
export function enqAllowedNow(state: SessionState, deps: ReducerDeps): boolean {
  const { enqByte } = deps;
  return enqByte(state) !== undefined;
}

export function enqByte(state: SessionState, deps: ReducerDeps): number | undefined {
  const { dialectOf } = deps;
  if (state.footerRev !== 2 && state.footerRev !== 3) return undefined;
  return dialectOf(state)?.realtime.enq?.byte;
}

/** The port is open and the link has not been lost. */
export function linkUp(s: SessionState, _deps: ReducerDeps): boolean {
  return (s.base === 'IDENTIFYING' || s.base === 'READING' || s.base === 'BLOCKED' || READY_BASES.has(s.base)) && !s.overlays.includes('LOST');
}

export function deny(reason: string, message: { remedy: string; citation: string; }, _deps: ReducerDeps): Decision {
  const { remedy, citation } = message;
  return { allowed: false, reason, remedy, citation };
}

// --- Settings writes (SAFETY §4.6, H57-H63, amendment 2026-11-02) -----------

/** True while a settings write has not finished. */
export function settingWriteActive(s: SessionState, _deps: ReducerDeps): boolean {
  return s.settingWrite !== null && s.settingWrite.phase !== 'done';
}

// --- Live values ------------------------------------------------------------
export function isObject(v: JsonValue | undefined, _deps: ReducerDeps): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function bindShared(deps: ReducerDeps): Pick<ReducerDeps, 'initialState' | 'dialectOf' | 'matrixSnapshot' | 'readableNow' | 'enqAllowedNow' | 'enqByte' | 'linkUp' | 'deny' | 'settingWriteActive' | 'isObject'> {
  return {
    initialState: () => initialState(deps),
    dialectOf: (state) => dialectOf(state, deps),
    matrixSnapshot: (state) => matrixSnapshot(state, deps),
    readableNow: (state, token) => readableNow(state, token, deps),
    enqAllowedNow: (state) => enqAllowedNow(state, deps),
    enqByte: (state) => enqByte(state, deps),
    linkUp: (s) => linkUp(s, deps),
    deny: (reason, remedy, citation) => deny(reason, { remedy: remedy, citation: citation }, deps),
    settingWriteActive: (s) => settingWriteActive(s, deps),
    isObject: (v) => isObject(v, deps),
  };
}
