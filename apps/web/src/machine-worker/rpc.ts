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
 * writes `{"sr":null}` and the probe GETs, nothing else), `close` is the
 * session's Disconnect, `status` carries the session snapshot, and
 * `intent`, `read` and `subscribe` are new. Every intent is decided by the
 * session through the allow-matrix; a refusal comes back with the matrix's
 * `{reason, remedy, citation}`.
 *
 * D1 (sign-in required to connect and start): the sign-in gate lives in the
 * main-thread UI. Nothing in this protocol carries, and nothing in the
 * worker consults, a session or an account (DECISIONS D1 safety condition).
 */
import { isPortSelector, type PortSelector, type SessionSnapshot, type TransportInfo, type TransportSource } from '@synthetos/machine';
import type { Decision } from '@synthetos/safety';

export const RPC_VERSION = 3;

export const REQUEST_KINDS = ['open', 'close', 'status', 'intent', 'read', 'subscribe'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** Intents the window may send. Everything else the session does on its own. */
export const WINDOW_INTENTS = ['feedhold', 'stopJob', 'spindleOffNow', 'ackFault', 'acknowledgeLost'] as const;
export type WindowIntent = (typeof WINDOW_INTENTS)[number];

/** Most tokens one `read` may name, and the longest token. */
export const MAX_READ_TOKENS = 32;
export const MAX_TOKEN_LENGTH = 16;
/** Longest board id the window may name as the selected machine's. */
export const MAX_BOARD_ID_LENGTH = 64;

export type MachineRequest =
  | { readonly v: typeof RPC_VERSION; readonly kind: 'open'; readonly port: PortSelector; readonly boardId: string | null }
  | { readonly v: typeof RPC_VERSION; readonly kind: 'close' | 'status' | 'subscribe' }
  | { readonly v: typeof RPC_VERSION; readonly kind: 'intent'; readonly intent: WindowIntent }
  | { readonly v: typeof RPC_VERSION; readonly kind: 'read'; readonly tokens: readonly string[] };

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
  | 'open-failed';

export type Denial = Extract<Decision, { allowed: false }>;

export type MachineReply =
  | { readonly v: typeof RPC_VERSION; readonly ok: true; readonly kind: 'open'; readonly info: TransportInfo }
  | { readonly v: typeof RPC_VERSION; readonly ok: true; readonly kind: 'close' | 'subscribe' | 'intent' | 'read' }
  | { readonly v: typeof RPC_VERSION; readonly ok: true; readonly kind: 'status'; readonly status: WorkerStatus }
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
}

function isRequestKind(value: unknown): value is RequestKind {
  return typeof value === 'string' && (REQUEST_KINDS as readonly string[]).includes(value);
}

function isWindowIntent(value: unknown): value is WindowIntent {
  return typeof value === 'string' && (WINDOW_INTENTS as readonly string[]).includes(value);
}

/** The request in `data`, or null when it is not exactly a valid request. */
export function parseRequest(data: unknown): MachineRequest | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  if (Object.getPrototypeOf(data) !== Object.prototype) return null;
  const keys = Object.keys(data).sort().join(',');
  const { v, kind, port, boardId, intent, tokens } = data as Record<string, unknown>;
  if (v !== RPC_VERSION || !isRequestKind(kind)) return null;
  switch (kind) {
    case 'open': {
      if ((keys !== 'kind,port,v' && keys !== 'boardId,kind,port,v') || !isPortSelector(port)) return null;
      const id = boardId ?? null;
      if (id !== null && (typeof id !== 'string' || id.length === 0 || id.length > MAX_BOARD_ID_LENGTH)) return null;
      const selector = Object.freeze({ usbVendorId: port.usbVendorId, usbProductId: port.usbProductId, grantIndex: port.grantIndex });
      return Object.freeze({ v: RPC_VERSION, kind, port: selector, boardId: id });
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
    default:
      if (keys !== 'kind,v') return null;
      return Object.freeze({ v: RPC_VERSION, kind });
  }
}

/** A refusal reply. */
export function refusal(kind: RequestKind | 'invalid', code: RefusalCode, message: string, decision?: Denial): MachineReply {
  return Object.freeze({ v: RPC_VERSION, ok: false, kind, code, message, ...(decision === undefined ? {} : { decision: Object.freeze({ ...decision }) }) });
}
