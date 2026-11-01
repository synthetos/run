/**
 * The messages between the main thread and `machine.worker` (ROADMAP P0-14;
 * RUN_PLAN §5.4).
 *
 * Every request is a structured-clone message posted to the worker with a
 * `MessagePort` in `ports[0]`; the worker answers on that port, exactly once.
 * A reply port per request keeps answers matched to questions without ids
 * and lets a caller await one answer.
 *
 * Requests are parsed strictly: a plain object with exactly the keys `v` and
 * `kind`, `v === 1`, and a known `kind`. Anything else is answered with an
 * `invalid-request` refusal and does nothing.
 *
 * Phase 0 has three requests. `open` asks the worker to obtain a Transport
 * from this build's transport source (transport.ts) and open it through
 * `GuardedTransport`; the production Phase 0 source has none, so production
 * always answers `unavailable`. Nothing here writes to a controller.
 *
 * D1 (sign-in required to connect and start): the sign-in gate lives in the
 * main-thread UI. Nothing in this protocol carries, and nothing in the
 * worker consults, a session or an account (DECISIONS D1 safety condition).
 */
import type { TransportInfo, TransportSource } from '@synthetos/machine';

export const RPC_VERSION = 1;

export const REQUEST_KINDS = ['open', 'close', 'status'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export interface MachineRequest {
  readonly v: typeof RPC_VERSION;
  readonly kind: RequestKind;
}

export type WorkerState = 'idle' | 'opening' | 'open' | 'closing';

export interface WorkerStatus {
  /** Which transport source this build has (`none` in a production Phase 0 build). */
  readonly source: TransportSource['kind'];
  readonly state: WorkerState;
  /** Bytes read from the open link since it opened (0 when idle). */
  readonly bytesReceived: number;
}

export type RefusalCode =
  /** The message was not a valid request. */
  | 'invalid-request'
  /** This build has no transport, or no port was chosen. */
  | 'unavailable'
  /** A link is already open or opening. */
  | 'busy'
  /** `close` with no open link. */
  | 'not-open'
  /** The guard or the port refused the open. */
  | 'open-failed'
  /** The port reported an error while closing (the link is closed regardless). */
  | 'close-failed';

export type MachineReply =
  | { readonly v: typeof RPC_VERSION; readonly ok: true; readonly kind: 'open'; readonly info: TransportInfo }
  | { readonly v: typeof RPC_VERSION; readonly ok: true; readonly kind: 'close' }
  | { readonly v: typeof RPC_VERSION; readonly ok: true; readonly kind: 'status'; readonly status: WorkerStatus }
  | {
      readonly v: typeof RPC_VERSION;
      readonly ok: false;
      readonly kind: RequestKind | 'invalid';
      readonly code: RefusalCode;
      readonly message: string;
    };

function isRequestKind(value: unknown): value is RequestKind {
  return typeof value === 'string' && (REQUEST_KINDS as readonly string[]).includes(value);
}

/** The request in `data`, or null when it is not exactly a valid request. */
export function parseRequest(data: unknown): MachineRequest | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  if (Object.getPrototypeOf(data) !== Object.prototype) return null;
  const keys = Object.keys(data).sort();
  if (keys.length !== 2 || keys[0] !== 'kind' || keys[1] !== 'v') return null;
  const { v, kind } = data as { v: unknown; kind: unknown };
  if (v !== RPC_VERSION || !isRequestKind(kind)) return null;
  return Object.freeze({ v: RPC_VERSION, kind });
}

/** A refusal reply. */
export function refusal(kind: RequestKind | 'invalid', code: RefusalCode, message: string): MachineReply {
  return Object.freeze({ v: RPC_VERSION, ok: false, kind, code, message });
}
