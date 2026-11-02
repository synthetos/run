/**
 * What `machine.worker` does with each request (ROADMAP P0-14, P1-02;
 * RUN_PLAN §5.1 rule 1, §5.4). Kept apart from the worker entry so it is
 * unit-tested without a worker.
 *
 * The worker owns one read-only `MachineSession` (packages/machine), the
 * single writer. This file only translates requests into session calls and
 * session state into replies:
 * - `prepare` holds one unopened transport for at most 15 seconds. The window
 *   then confirms its original grant objects. A serial `open` needs that
 *   single-use preparation; it cannot enumerate and select a replacement.
 * - `open` connects the session to the port the window chose, through the
 *   build's transport source (transport.ts); the session opens it only
 *   through `GuardedTransport` and starts the probe with `{sr:null}`.
 *   On a mobile operating system (or ChromeOS, or an OS it cannot tell)
 *   `open` is refused before the transport source is asked, whatever
 *   `navigator.serial` offers (T-S77, RUN_PLAN §2.3). The window hides
 *   Connect there too; this is the check that does not depend on it.
 * - `close` is the session's Disconnect (decided by the allow-matrix).
 * - `intent` (Pause, Stop job, Spindle off, ackFault, acknowledge LOST) and
 *   `read` go straight to the session and are answered at once. No request
 *   ever waits behind another: a Pause is never queued behind an open or a
 *   close (SAFETY §4.4 step 1).
 * - `subscribe` keeps the reply port and posts the snapshot on it, at most
 *   once per `SNAPSHOT_INTERVAL_MS` (the last one is never dropped).
 *
 * Before every `open` the worker verifies the bundled, signed approved-builds
 * manifest for its own origin (approval.ts, P1-03) and the session classifies
 * against the result. Without a manifest, or when it does not verify, every
 * board is READ_ONLY.
 *
 * It holds no account or network state (DECISIONS D1).
 */
import { LAG_AMBER_MS, LAG_RED_MS, MachineSession, PositionPoller, ReadoutPoller, droView, liveControlPlatform, type PortSelector, type Transport, type PlatformInfo, type SessionClock, type SessionSnapshot, type TransportSource } from '@synthetos/machine';
import type { Decision } from '@synthetos/safety';
import { approvalRecord, approvedBuildsFor, type ApprovalOutcome } from './approval.ts';
import { RPC_VERSION, parseRequest, refusal, type Denial, type MachineReply, type SnapshotMessage, type WindowIntent, type WorkerState } from './rpc.ts';

/** Snapshots are posted at most 20 times per second (OLD-TP §4.2). */
export const SNAPSHOT_INTERVAL_MS = 50;

const LAG = Object.freeze({ amberMs: LAG_AMBER_MS, redMs: LAG_RED_MS });

/** Where a subscriber's snapshots go (a MessagePort in the worker). */
export interface SnapshotPort {
  postMessage(message: SnapshotMessage): void;
}

/** The worker's clock: performance.now and the worker's own timers. */
export function realClock(): SessionClock {
  return {
    now: () => performance.now(),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown as number,
    clearTimeout: (id) => clearTimeout(id),
  };
}

/**
 * What the platform rule reads in the worker: `navigator.userAgent` only,
 * the one reviewed navigator property it needs (run/no-capability-lookup).
 * `userAgentData` and `maxTouchPoints` would also catch Android's "desktop
 * site" mode and a touch iPad; reading them is a gate change for review.
 */
export function workerPlatform(): PlatformInfo | undefined {
  return typeof navigator === 'undefined' ? undefined : { userAgent: navigator.userAgent };
}

interface PreparedPort {
  readonly id: number;
  readonly port: PortSelector;
  readonly transport: Transport;
  readonly expires: number;
}
const PREPARATION_MS = 15_000;

/** The signed approved-builds file the worker verifies before each connect, and the worker's origin. */
export interface WorkerApproval {
  readonly file: unknown;
  readonly origin: string;
  /** Tests only: verify with these instead of the compiled-in release keys. */
  readonly verify?: (file: unknown, origin: string, now: Date) => Promise<ApprovalOutcome>;
}

export class MachineWorkerHost {
  readonly #source: TransportSource;
  readonly #clock: SessionClock;
  readonly #session: MachineSession;
  readonly #platform: PlatformInfo | undefined;
  readonly #poller: PositionPoller;
  readonly #readouts: ReadoutPoller;
  readonly #approval: WorkerApproval | null;
  #preparationId = 0;
  #prepared: PreparedPort | null = null;
  #approved: PreparedPort | null = null;
  #subscriber: SnapshotPort | null = null;
  #lastPost = Number.NEGATIVE_INFINITY;
  #pending: number | null = null;

  /** `platform` is the worker's user agent (`workerPlatform`) unless a test passes one. */
  constructor(source: TransportSource, clock: SessionClock = realClock(), platform: PlatformInfo | undefined = workerPlatform(), approval: WorkerApproval | null = null) {
    this.#source = source;
    this.#approval = approval;
    this.#clock = clock;
    this.#platform = platform;
    this.#session = new MachineSession({
      source: {
        kind: source.kind,
        request: async (selector) => {
          const approved = this.#approved;
          this.#approved = null;
          if (approved !== null) return clock.now() < approved.expires && JSON.stringify(approved.port) === JSON.stringify(selector) ? approved.transport : null;
          return source.kind === 'serial' ? null : source.request(selector);
        },
      },
      clock,
    });
    this.#session.subscribe(() => this.#schedule());
    // P1-07: machine position for the DRO and the live marker comes only from polled `mpo` (SAFETY §4.2).
    // The poller only asks `session.read`; it is idle until a classified board is connected.
    this.#poller = new PositionPoller(this.#session, clock);
    this.#poller.start();
    // Spindle and coolant readouts the board's status list lacks, as GETs about once a second. DISPLAY ONLY:
    // their answers are shown by the page and read by no decision (SAFETY §4.4).
    this.#readouts = new ReadoutPoller(this.#session, clock);
    this.#readouts.start();
  }

  /** The spindle and coolant readout poller (tests). */
  get readoutPoller(): ReadoutPoller {
    return this.#readouts;
  }

  /** The `mpo` poller (tests). */
  get poller(): PositionPoller {
    return this.#poller;
  }

  /** The session (tests and the snapshot posting). */
  get session(): MachineSession {
    return this.#session;
  }

  /**
   * Answers one message. Never rejects: every failure is a refusal reply.
   * `port` is the reply port, kept for `subscribe`.
   */
  async handle(data: unknown, port?: SnapshotPort): Promise<MachineReply> {
    const request = parseRequest(data);
    if (request === null) return refusal('invalid', 'invalid-request', 'not a machine worker request');
    switch (request.kind) {
      case 'prepare': {
        const platform = liveControlPlatform(this.#platform);
        if (!platform.allowed) return refusal('prepare', 'platform', platform.reason);
        if (this.#session.snapshot.base !== 'NOT_CONNECTED') return refusal('prepare', 'unavailable', 'disconnect before choosing another port');
        const id = ++this.#preparationId;
        this.#prepared = null;
        const expires = this.#clock.now() + PREPARATION_MS;
        try {
          const transport = await this.#source.request(request.port);
          if (transport === null || id !== this.#preparationId || this.#clock.now() >= expires || this.#session.snapshot.base !== 'NOT_CONNECTED') return refusal('prepare', 'unavailable', 'the granted ports changed or the selection expired');
          this.#prepared = { id, port: request.port, transport, expires };
          return Object.freeze({ v: RPC_VERSION, ok: true, kind: 'prepare', preparation: id });
        } catch {
          return refusal('prepare', 'unavailable', 'the granted ports could not be verified');
        }
      }
      case 'open': {
        const platform = liveControlPlatform(this.#platform);
        if (!platform.allowed) return refusal('open', 'platform', platform.reason);
        const prepared = this.#prepared;
        if (this.#source.kind === 'serial' || request.preparation !== undefined) {
          if (prepared === null || request.preparation !== prepared.id || this.#clock.now() >= prepared.expires || JSON.stringify(prepared.port) !== JSON.stringify(request.port)) return refusal('open', 'unavailable', 'no confirmed port selection');
          this.#prepared = null;
          this.#approved = prepared;
        }
        await this.#loadApprovals();
        const outcome = await this.#session.connect(request.port, { expectedDeviceId: request.boardId, unknown: request.previousSessionEnded });
        if (this.#approved === prepared) this.#approved = null;
        if (outcome.ok) return Object.freeze({ v: RPC_VERSION, ok: true, kind: 'open', info: outcome.info });
        if (outcome.code === 'denied') return denied('open', outcome.decision);
        return refusal('open', outcome.code, outcome.reason);
      }
      case 'close': {
        ++this.#preparationId;
        this.#prepared = null;
        this.#approved = null;
        const decision = await this.#session.disconnect();
        return decision.allowed ? Object.freeze({ v: RPC_VERSION, ok: true, kind: 'close' }) : denied('close', decision);
      }
      case 'intent': {
        const decision = this.#intent(request.intent);
        return decision.allowed ? Object.freeze({ v: RPC_VERSION, ok: true, kind: 'intent' }) : denied('intent', decision);
      }
      case 'read': {
        const decision = this.#session.read(request.tokens);
        return decision.allowed ? Object.freeze({ v: RPC_VERSION, ok: true, kind: 'read' }) : denied('read', decision);
      }
      case 'drift':
        this.#session.reportDrift(request.epoch);
        return Object.freeze({ v: RPC_VERSION, ok: true, kind: 'drift' });
      case 'subscribe':
        if (port === undefined) return refusal('subscribe', 'invalid-request', 'subscribe needs a reply port');
        this.#subscriber = port;
        this.#post();
        return Object.freeze({ v: RPC_VERSION, ok: true, kind: 'subscribe' });
      case 'transcript': {
        const out = this.#session.exportTranscript();
        if (!out.ok) return refusal('transcript', 'unavailable', out.reason);
        return Object.freeze({ v: RPC_VERSION, ok: true, kind: 'transcript', jsonl: out.jsonl, events: out.events });
      }
      case 'status':
        return Object.freeze({
          v: RPC_VERSION,
          ok: true,
          kind: 'status',
          status: Object.freeze({ source: this.#source.kind, state: workerState(this.#session.snapshot), session: this.#session.snapshot }),
        });
    }
  }

  /** Verifies the signed manifest now (its validity window uses this clock) and hands it to the session. */
  async #loadApprovals(): Promise<void> {
    const approval = this.#approval;
    if (approval === null) return;
    const now = new Date();
    const outcome = await (approval.verify ?? ((file, origin, at) => approvedBuildsFor(file, { origin, now: at })))(approval.file, approval.origin, now).catch(() => null);
    if (outcome === null) return;
    this.#session.useApprovedBuilds(outcome.approved, approvalRecord(outcome));
  }

  #intent(intent: WindowIntent): Decision {
    switch (intent) {
      case 'feedhold':
        return this.#session.feedhold();
      case 'stopJob':
        return this.#session.stopJob();
      case 'spindleOffNow':
        return this.#session.spindleOffNow();
      case 'ackFault':
        return this.#session.ackFault();
      case 'acknowledgeLost':
        return this.#session.acknowledgeLost();
    }
  }

  /** Posts now if the interval has passed, otherwise once at its end (with the snapshot current then). */
  #schedule(): void {
    if (this.#subscriber === null || this.#pending !== null) return;
    const wait = this.#lastPost + SNAPSHOT_INTERVAL_MS - this.#clock.now();
    if (wait <= 0) {
      this.#post();
      return;
    }
    this.#pending = this.#clock.setTimeout(() => {
      this.#pending = null;
      this.#post();
    }, wait);
  }

  #post(): void {
    if (this.#pending !== null) {
      this.#clock.clearTimeout(this.#pending);
      this.#pending = null;
    }
    this.#lastPost = this.#clock.now();
    try {
      const snapshot = this.#session.snapshot;
      this.#subscriber?.postMessage(Object.freeze({ v: RPC_VERSION, kind: 'snapshot', snapshot, dro: droView(snapshot, this.#clock.now()), lag: LAG }));
    } catch {
      // A closed port: the window went away. Nothing in the machine path depends on it.
      this.#subscriber = null;
    }
  }
}

function denied(kind: 'open' | 'close' | 'intent' | 'read', decision: Denial): MachineReply {
  return refusal(kind, 'denied', decision.reason, decision);
}

/** The Phase 0 link words, from the session snapshot. */
export function workerState(snapshot: SessionSnapshot): WorkerState {
  if (snapshot.overlays.includes('LOST')) return 'lost';
  if (snapshot.base === 'NOT_CONNECTED') return 'idle';
  if (snapshot.base === 'PORT_REQUEST' || snapshot.base === 'OPENING') return 'opening';
  return 'open';
}
