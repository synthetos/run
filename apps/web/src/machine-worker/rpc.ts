/**
 * The messages between the main thread and `machine.worker` (ROADMAP P0-14,
 * P1-02; RUN_PLAN §5.4).
 *
 * Every request is a structured-clone message posted to the worker with a
 * `MessagePort` in `ports[0]`; the worker answers on that port. A reply port
 * per request keeps answers matched to questions without ids and lets a
 * caller await one answer. `subscribe` keeps its port: the worker posts the
 * session snapshot on it (at most 20 per second, OLD-TP §4.2) until another
 * `subscribe` replaces it.
 *
 * Requests are parsed strictly: a plain object with exactly the keys its
 * kind allows, `v === RPC_VERSION`, and a known `kind`. Anything else is
 * answered with an `invalid-request` refusal and does nothing.
 *
 * Version 3 (P1-02): `open` starts the read-only `MachineSession` (it
 * writes `{sr:null}` and the probe GETs, nothing else), `close` is the
 * session's Disconnect, `status` carries the session snapshot, and
 * `intent`, `read` and `subscribe` are new. Every intent is decided by the
 * session through the allow-matrix; a refusal comes back with the matrix's
 * `{reason, remedy, citation}`.
 *
 * `prepare` (additive): holds an unopened transport and returns a short-lived,
 * single-use ticket. Serial `open` requires that ticket, after the window
 * confirms its original grant objects. There is no re-enumeration on open.
 *
 * `transcript` (P1-08, additive) answers with the session's wire transcript
 * (`{t, dir, hex}` JSONL) of the last link that opened, for bench runs. It
 * only reads; it never touches the port.
 *
 * D1 (sign-in required to connect and start): the sign-in gate lives in the
 * main-thread UI. Nothing in this protocol carries, and nothing in the
 * worker consults, a session or an account (DECISIONS D1 safety condition).
 */
import { isPortSelector, type DroView, type PortSelector, type SessionSnapshot, type TransportInfo, type TransportSource } from '@synthetos/machine';
import type { Decision } from '@synthetos/safety';

export const RPC_VERSION = 3;

export const REQUEST_KINDS = ['prepare', 'open', 'close', 'status', 'intent', 'read', 'subscribe', 'transcript', 'drift', 'motion', 'settingWrite'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** Intents the window may send. Everything else the session does on its own. */
export const WINDOW_INTENTS = ['feedhold', 'stopJob', 'spindleOffNow', 'ackFault', 'acknowledgeLost'] as const;
export type WindowIntent = (typeof WINDOW_INTENTS)[number];

/** Axes a motion command may name (SAFETY §4.5b). */
export const MOTION_AXES = ['x', 'y', 'z', 'a'] as const;
export type MotionAxis = (typeof MOTION_AXES)[number];

/**
 * Phase 2 motion commands (additive; owner 2026-11-02, SAFETY §4.5b). The worker hands each to the session,
 * which decides it through the allow-matrix and the motion preconditions; under a release without motion
 * every one is denied. `jogRelease`, `spindleOff` and `coolantOff` are stop-class and never gated.
 */
export type MotionCommand =
  | { readonly op: 'jog'; readonly axes: Readonly<Partial<Record<MotionAxis, 1 | -1>>>; readonly distanceMm: number | null; readonly feed: number }
  | { readonly op: 'jogRenew' | 'jogRelease' | 'spindleOff' | 'coolantOff' | 'resume' | 'clearAlarm' | 'positionVerify' }
  | { readonly op: 'goToZero'; readonly axes: readonly MotionAxis[]; readonly safeZ: number }
  | { readonly op: 'setZero'; readonly axes: readonly MotionAxis[] }
  | { readonly op: 'spindleOn'; readonly direction: 'cw' | 'ccw'; readonly rpm: number }
  | { readonly op: 'coolantOn'; readonly which: 'mist' | 'flood' };

/** Most tokens one `read` may name, and the longest token. */
export const MAX_READ_TOKENS = 32;
export const MAX_TOKEN_LENGTH = 16;
/** Longest board id the window may name as the selected machine's. */
export const MAX_BOARD_ID_LENGTH = 64;

export type MachineRequest =
  | { readonly v: typeof RPC_VERSION; readonly kind: 'prepare'; readonly port: PortSelector }
  /** `previousSessionEnded`: a reload or discard ended a LIVE session (W6), so the connect starts UNKNOWN (SAFETY §3). */
  | { readonly v: typeof RPC_VERSION; readonly kind: 'open'; readonly port: PortSelector; readonly preparation?: number; readonly boardId: string | null; readonly previousSessionEnded: boolean }
  | { readonly v: typeof RPC_VERSION; readonly kind: 'close' | 'status' | 'subscribe' | 'transcript' }
  | { readonly v: typeof RPC_VERSION; readonly kind: 'intent'; readonly intent: WindowIntent }
  | { readonly v: typeof RPC_VERSION; readonly kind: 'read'; readonly tokens: readonly string[] }
  /** P1-07: the window's settings drift check found a difference on link `epoch` (NEEDS_REVIEW; it can only add the overlay). */
  | { readonly v: typeof RPC_VERSION; readonly kind: 'drift'; readonly epoch: number }
  /**
   * One settings write (SAFETY §4.6, amendment 2026-11-02; additive). The session decides it (the settings
   * release, the allow-matrix, the schema, the idle gate) and reports the result in `snapshot.settingWrite`
   * under the id the reply carries.
   */
  | { readonly v: typeof RPC_VERSION; readonly kind: 'settingWrite'; readonly key: string; readonly value: number }
  | { readonly v: typeof RPC_VERSION; readonly kind: 'motion'; readonly command: MotionCommand };

/** The link, in the words of the Phase 0 protocol: derived from the session's base state and LOST. */
export type WorkerState = 'idle' | 'opening' | 'open' | 'lost';

export interface WorkerStatus {
  /** Which transport source this build has (`none` in a production build). */
  readonly source: TransportSource['kind'];
  readonly state: WorkerState;
  readonly session: SessionSnapshot;
}

export type RefusalCode =
  /** The message was not a valid request. */
  | 'invalid-request'
  /** This build has no transport, or no port was chosen. */
  | 'unavailable'
  /** The session (through the allow-matrix) refused the request. */
  | 'denied'
  /** The guard or the port refused the open. */
  | 'open-failed'
  /** Live control is not offered on this operating system (mobile, ChromeOS, unknown; T-S77). */
  | 'platform';

export type Denial = Extract<Decision, { allowed: false }>;

export type MachineReply =
  | { readonly v: typeof RPC_VERSION; readonly ok: true; readonly kind: 'prepare'; readonly preparation: number }
  | { readonly v: typeof RPC_VERSION; readonly ok: true; readonly kind: 'open'; readonly info: TransportInfo }
  | { readonly v: typeof RPC_VERSION; readonly ok: true; readonly kind: 'close' | 'subscribe' | 'intent' | 'read' | 'drift' | 'motion' }
  | { readonly v: typeof RPC_VERSION; readonly ok: true; readonly kind: 'status'; readonly status: WorkerStatus }
  /** The settings write was accepted; its result appears in `snapshot.settingWrite` with this id. */
  | { readonly v: typeof RPC_VERSION; readonly ok: true; readonly kind: 'settingWrite'; readonly id: number }
  /** The wire transcript of the last link that opened, as `{t, dir, hex}` JSONL (P1-08). */
  | { readonly v: typeof RPC_VERSION; readonly ok: true; readonly kind: 'transcript'; readonly jsonl: string; readonly events: number }
  | {
      readonly v: typeof RPC_VERSION;
      readonly ok: false;
      readonly kind: RequestKind | 'invalid';
      readonly code: RefusalCode;
      readonly message: string;
      /** For `denied`: the allow-matrix decision, shown verbatim by the UI. */
      readonly decision?: Denial;
    };

/** What the worker posts on a subscribed port. */
export interface SnapshotMessage {
  readonly v: typeof RPC_VERSION;
  readonly kind: 'snapshot';
  readonly snapshot: SessionSnapshot;
  /**
   * P1-07: the DRO view of this snapshot, computed in the worker at post
   * time (ages are on the worker's clock; the window adds the time since it
   * received the message), with the lag thresholds it was computed with.
   */
  readonly dro: DroView;
  readonly lag: { readonly amberMs: number; readonly redMs: number };
  /** The settings-write phase switch is on in this worker (bench and staging; never production). */
  readonly settingsWrites?: boolean;
  /** The motion capability flag of this worker (Phase 2: bench and staging origins only, SAFETY §4.5b). */
  readonly motion: boolean;
}

function isRequestKind(value: unknown): value is RequestKind {
  return typeof value === 'string' && (REQUEST_KINDS as readonly string[]).includes(value);
}

function isWindowIntent(value: unknown): value is WindowIntent {
  return typeof value === 'string' && (WINDOW_INTENTS as readonly string[]).includes(value);
}

const OPEN_KEYS: ReadonlySet<string> = new Set(['kind,port,v', 'boardId,kind,port,v', 'kind,port,previousSessionEnded,v', 'boardId,kind,port,previousSessionEnded,v']);

/** The request in `data`, or null when it is not exactly a valid request. */
export function parseRequest(data: unknown): MachineRequest | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  if (Object.getPrototypeOf(data) !== Object.prototype) return null;
  const keys = Object.keys(data).sort().join(',');
  const { v, kind, port, boardId, previousSessionEnded, intent, tokens, epoch, preparation, command, key, value } = data as Record<string, unknown>;
  if (v !== RPC_VERSION || !isRequestKind(kind)) return null;
  switch (kind) {
    case 'prepare':
      if (keys !== 'kind,port,v' || !isPortSelector(port)) return null;
      return Object.freeze({ v: RPC_VERSION, kind, port: copySelector(port) });
    case 'open': {
      if (!OPEN_KEYS.has(Object.keys(data).filter((key) => key !== 'preparation').sort().join(',')) || !isPortSelector(port)) return null;
      const id = boardId ?? null;
      if (id !== null && (typeof id !== 'string' || id.length === 0 || id.length > MAX_BOARD_ID_LENGTH)) return null;
      if (previousSessionEnded !== undefined && typeof previousSessionEnded !== 'boolean') return null;
      if ('preparation' in data && (typeof preparation !== 'number' || !Number.isSafeInteger(preparation) || preparation < 1)) return null;
      const selector = copySelector(port);
      return Object.freeze({ v: RPC_VERSION, kind, port: selector, ...(preparation === undefined ? {} : { preparation: preparation as number }), boardId: id, previousSessionEnded: previousSessionEnded === true });
    }
    case 'intent':
      if (keys !== 'intent,kind,v' || !isWindowIntent(intent)) return null;
      return Object.freeze({ v: RPC_VERSION, kind, intent });
    case 'read': {
      if (keys !== 'kind,tokens,v' || !Array.isArray(tokens) || Object.getPrototypeOf(tokens) !== Array.prototype) return null;
      const list: unknown[] = tokens;
      if (list.length === 0 || list.length > MAX_READ_TOKENS) return null;
      if (!list.every((t) => typeof t === 'string' && t.length > 0 && t.length <= MAX_TOKEN_LENGTH)) return null;
      return Object.freeze({ v: RPC_VERSION, kind, tokens: Object.freeze([...(list as string[])]) });
    }
    case 'settingWrite':
      if (keys !== 'key,kind,v,value' || typeof key !== 'string' || key.length === 0 || key.length > MAX_TOKEN_LENGTH) return null;
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      return Object.freeze({ v: RPC_VERSION, kind, key, value });
    case 'motion': {
      if (keys !== 'command,kind,v') return null;
      const parsed = parseMotionCommand(command);
      return parsed === null ? null : Object.freeze({ v: RPC_VERSION, kind, command: parsed });
    }
    case 'drift':
      if (keys !== 'epoch,kind,v' || typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) return null;
      return Object.freeze({ v: RPC_VERSION, kind, epoch });
    default:
      if (keys !== 'kind,v') return null;
      return Object.freeze({ v: RPC_VERSION, kind });
  }
}

/** A refusal reply. */
export function refusal(kind: RequestKind | 'invalid', code: RefusalCode, message: string, decision?: Denial): MachineReply {
  return Object.freeze({ v: RPC_VERSION, ok: false, kind, code, message, ...(decision === undefined ? {} : { decision: Object.freeze({ ...decision }) }) });
}

/** Copy untrusted message arrays: callers cannot mutate a prepared selection. */
function copySelector(port: PortSelector): PortSelector {
  return Object.freeze({
    usbVendorId: port.usbVendorId,
    usbProductId: port.usbProductId,
    grantIndex: port.grantIndex,
    ...(port.grantSnapshot === undefined ? {} : { grantSnapshot: Object.freeze([...port.grantSnapshot]) }),
  });
}

function plainKeys(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  return Object.keys(value).sort().join(',');
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function axisList(value: unknown): readonly MotionAxis[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length === 0 || value.length > MOTION_AXES.length) return null;
  const list: unknown[] = value;
  if (!list.every((a) => typeof a === 'string' && (MOTION_AXES as readonly string[]).includes(a)) || new Set(list).size !== list.length) return null;
  return Object.freeze([...(list as MotionAxis[])]);
}

/** A motion command, strictly: exactly its keys, known values, finite numbers. Ranges are the session's. */
export function parseMotionCommand(value: unknown): MotionCommand | null {
  const keys = plainKeys(value);
  if (keys === null) return null;
  const c = value as Record<string, unknown>;
  switch (c['op']) {
    case 'jog': {
      if (keys !== 'axes,distanceMm,feed,op' || !finite(c['feed']) || (c['distanceMm'] !== null && !finite(c['distanceMm']))) return null;
      const axesKeys = plainKeys(c['axes']);
      if (axesKeys === null || axesKeys === '') return null;
      const axes = c['axes'] as Record<string, unknown>;
      const out: Partial<Record<MotionAxis, 1 | -1>> = {};
      for (const [k, d] of Object.entries(axes)) {
        if (!(MOTION_AXES as readonly string[]).includes(k) || (d !== 1 && d !== -1)) return null;
        out[k as MotionAxis] = d;
      }
      return Object.freeze({ op: 'jog', axes: Object.freeze(out), distanceMm: c['distanceMm'] as number | null, feed: c['feed'] });
    }
    case 'jogRenew':
    case 'jogRelease':
    case 'spindleOff':
    case 'coolantOff':
    case 'resume':
    case 'clearAlarm':
    case 'positionVerify':
      return keys === 'op' ? Object.freeze({ op: c['op'] }) : null;
    case 'goToZero': {
      const axes = axisList(c['axes']);
      if (keys !== 'axes,op,safeZ' || axes === null || !finite(c['safeZ'])) return null;
      return Object.freeze({ op: 'goToZero', axes, safeZ: c['safeZ'] });
    }
    case 'setZero': {
      const axes = axisList(c['axes']);
      return keys === 'axes,op' && axes !== null ? Object.freeze({ op: 'setZero', axes }) : null;
    }
    case 'spindleOn':
      if (keys !== 'direction,op,rpm' || (c['direction'] !== 'cw' && c['direction'] !== 'ccw') || !finite(c['rpm'])) return null;
      return Object.freeze({ op: 'spindleOn', direction: c['direction'], rpm: c['rpm'] });
    case 'coolantOn':
      if (keys !== 'op,which' || (c['which'] !== 'mist' && c['which'] !== 'flood')) return null;
      return Object.freeze({ op: 'coolantOn', which: c['which'] });
    default:
      return null;
  }
}
