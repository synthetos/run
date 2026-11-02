/**
 * Cross-tab stop requests and the machine Web Lock (ROADMAP P1-06; SAFETY
 * §4.3 "Web Lock", §4.1 destructive storage row; RUN_PLAN §5.4).
 *
 * - Each LIVE machine worker holds the Web Lock `synthetos-machine:<board
 *   id>` while its session has a port open. Other tabs watch the lock: a
 *   held lock they do not own means "Machine is controlled in another tab";
 *   a watched lock that goes away means W29.
 * - Every machine worker listens on the BroadcastChannel `STOP_CHANNEL`.
 *   It accepts ONLY stop-class requests (pause, stop job, spindle off),
 *   acts on them at once, and acknowledges each one; anything else on the
 *   channel is ignored without an answer.
 * - A tab that sends a request waits `STOP_ACK_TIMEOUT_MS` for one
 *   acknowledgement per held machine lock. A machine that did not answer is
 *   "STOP NOT DELIVERED — use your E-stop".
 *
 * Messages are parsed as strictly as the worker RPC (rpc.ts): a plain
 * object with exactly the keys its kind allows. This module is shared by
 * the worker and the window and holds no state.
 */

export const STOP_CHANNEL = 'synthetos-machine-stop';
export const STOP_PROTOCOL_VERSION = 1;
/** SAFETY §4.3: the worker acknowledges every stop request within 250 ms. */
export const STOP_ACK_TIMEOUT_MS = 250;
/** Prefix of every machine Web Lock name. */
export const MACHINE_LOCK_PREFIX = 'synthetos-machine:';
/** Longest request id accepted on the channel. */
export const MAX_REQUEST_ID_LENGTH = 64;
/** Longest machine lock name accepted on the channel. */
export const MAX_LOCK_NAME_LENGTH = MACHINE_LOCK_PREFIX.length + 64;

/** The stop-class actions, and the only things the channel can ask for. */
export const STOP_ACTIONS = ['pause', 'stopJob', 'spindleOff'] as const;
export type StopAction = (typeof STOP_ACTIONS)[number];

export interface StopRequest {
  readonly v: typeof STOP_PROTOCOL_VERSION;
  readonly kind: 'stop-request';
  readonly id: string;
  readonly action: StopAction;
}

export interface StopAck {
  readonly v: typeof STOP_PROTOCOL_VERSION;
  readonly kind: 'stop-ack';
  /** The request this answers. */
  readonly id: string;
  /** The machine lock name of the answering worker. */
  readonly machine: string;
  /** Whether the session accepted the intent (the allow-matrix always allows stop-class intents while connected). */
  readonly accepted: boolean;
}

function plain(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data) && Object.getPrototypeOf(data) === Object.prototype;
}

function validId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_REQUEST_ID_LENGTH;
}

/** The stop request in `data`, or null for anything else (which the worker ignores). */
export function parseStopRequest(data: unknown): StopRequest | null {
  if (!plain(data)) return null;
  if (Object.keys(data).sort().join(',') !== 'action,id,kind,v') return null;
  const { v, kind, id, action } = data;
  if (v !== STOP_PROTOCOL_VERSION || kind !== 'stop-request' || !validId(id)) return null;
  if (typeof action !== 'string' || !(STOP_ACTIONS as readonly string[]).includes(action)) return null;
  return Object.freeze({ v: STOP_PROTOCOL_VERSION, kind: 'stop-request', id, action: action as StopAction });
}

/** The acknowledgement in `data`, or null. */
export function parseStopAck(data: unknown): StopAck | null {
  if (!plain(data)) return null;
  if (Object.keys(data).sort().join(',') !== 'accepted,id,kind,machine,v') return null;
  const { v, kind, id, machine, accepted } = data;
  if (v !== STOP_PROTOCOL_VERSION || kind !== 'stop-ack' || !validId(id) || typeof accepted !== 'boolean') return null;
  if (typeof machine !== 'string' || !isMachineLockName(machine) || machine.length > MAX_LOCK_NAME_LENGTH) return null;
  return Object.freeze({ v: STOP_PROTOCOL_VERSION, kind: 'stop-ack', id, machine, accepted });
}

export function isMachineLockName(name: string): boolean {
  return name.startsWith(MACHINE_LOCK_PREFIX) && name.length > MACHINE_LOCK_PREFIX.length;
}

/**
 * The lock name for a board. The board id comes from the serial port, so
 * it is reduced to `[A-Za-z0-9._-]` and capped; a board without an id (or
 * whose id reduces to nothing) gets `unidentified-<instance>`, unique to
 * the worker, so two such boards never share a lock.
 */
export function machineLockName(boardId: string | undefined, instance: string): string {
  const clean = (boardId ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 48);
  return `${MACHINE_LOCK_PREFIX}${clean.length > 0 ? clean : `unidentified-${instance.slice(0, 16)}`}`;
}

// ---------------------------------------------------------------- Web Locks

/** The parts of `LockManager` this app uses (injected, so tests use a fake). */
export interface LockManagerLike {
  request(name: string, options: { readonly ifAvailable: true }, callback: (lock: unknown) => Promise<void>): Promise<void>;
  query(): Promise<{ readonly held?: readonly { readonly name?: string }[] }>;
}

/** The parts of `BroadcastChannel` this app uses. */
export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
}

/**
 * The machine locks held by any tab of this browser, sorted, or null when
 * the lock manager is missing or the query fails (the caller then cannot
 * tell, and must treat that as "maybe held").
 */
export async function heldMachineLocks(locks: LockManagerLike | null): Promise<string[] | null> {
  if (locks === null) return null;
  try {
    const state = await locks.query();
    const names = (state.held ?? []).map((l) => l.name).filter((n): n is string => typeof n === 'string' && isMachineLockName(n));
    return [...new Set(names)].sort();
  } catch {
    return null;
  }
}

/** `navigator.locks` in this realm (window or worker), or null. */
export function browserLocks(): LockManagerLike | null {
  if (typeof navigator === 'undefined') return null;
  const locks: unknown = navigator.locks;
  return typeof locks === 'object' && locks !== null ? (locks as LockManagerLike) : null;
}

/** A new BroadcastChannel on `STOP_CHANNEL`, or null where there is none. */
export function openStopChannel(): BroadcastChannelLike | null {
  return typeof BroadcastChannel === 'function' ? new BroadcastChannel(STOP_CHANNEL) : null;
}
