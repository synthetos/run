/**
 * The machine worker's side of cross-tab stop requests and the machine Web
 * Lock (ROADMAP P1-06; SAFETY §4.3; protocol in stopChannel.ts).
 *
 * - While the session has a port open, the worker holds the lock
 *   `synthetos-machine:<board id>` (`unidentified-<instance>` until the
 *   board has given its id). The lock goes with the worker: if the tab
 *   closes or crashes, the browser releases it and observer tabs show W29.
 *   If another tab already holds the same board's lock, this worker holds
 *   none and says so in `lock` (`contended`); its stop path is unchanged.
 * - Every stop-class request on the channel is acted on at once (the
 *   session writes `!` in Phase 1) and acknowledged synchronously after
 *   the session call, well inside the 250 ms the requester waits. The worker
 *   runs on its own thread, so a busy loop in its tab's window does not
 *   delay this (T-S29, HIL-1.7).
 * - Anything that is not exactly a stop request is ignored and not
 *   answered. A worker with no port open answers nothing: it has no machine.
 */
import type { SessionSnapshot } from '@synthetos/machine';
import type { Decision } from '@synthetos/safety';
import { machineLockName, parseStopRequest, STOP_PROTOCOL_VERSION, type BroadcastChannelLike, type LockManagerLike, type StopAck, type StopAction } from './stopChannel.ts';

/** The parts of `MachineSession` the stop service uses. */
export interface StopSession {
  readonly snapshot: SessionSnapshot;
  subscribe(listener: () => void): unknown;
  feedhold(): Decision;
  stopJob(): Decision;
  spindleOffNow(): Decision;
}

export type LockState =
  | { readonly kind: 'none' }
  | { readonly kind: 'requesting'; readonly name: string }
  | { readonly kind: 'held'; readonly name: string }
  | { readonly kind: 'contended'; readonly name: string }
  | { readonly kind: 'unavailable'; readonly name: string };

export interface StopServiceOptions {
  readonly session: StopSession;
  readonly channel: BroadcastChannelLike | null;
  readonly locks: LockManagerLike | null;
  /** Unique to this worker (names an unidentified board's lock). */
  readonly instance: string;
  /**
   * The board a firmware update holds while the session has no link (SAFETY H88): the lock stays with this tab
   * while the board is in its bootloader, so no other tab takes it or shows W29 then. Null when none.
   */
  readonly flashing?: () => { readonly boardId: string | null } | null;
}

export class MachineStopService {
  readonly #session: StopSession;
  readonly #channel: BroadcastChannelLike | null;
  readonly #locks: LockManagerLike | null;
  readonly #instance: string;
  readonly #flashing: () => { readonly boardId: string | null } | null;
  #lock: LockState = { kind: 'none' };
  /** Ends the current lock request's hold (resolves the promise the lock callback returned). */
  #release: (() => void) | null = null;
  /** Bumped on every lock change, so a late grant for an old name is let go at once. */
  #generation = 0;

  constructor(options: StopServiceOptions) {
    this.#session = options.session;
    this.#channel = options.channel;
    this.#locks = options.locks;
    this.#instance = options.instance;
    this.#flashing = options.flashing ?? (() => null);
    this.#channel?.addEventListener('message', (event) => this.#onMessage(event.data));
    this.#session.subscribe(() => this.#syncLock());
    this.#syncLock();
  }

  get lock(): LockState {
    return this.#lock;
  }

  /** The lock name this worker answers for, or null without an open port. */
  get machine(): string | null {
    return this.#lock.kind === 'none' ? null : this.#lock.name;
  }

  #onMessage(data: unknown): void {
    const request = parseStopRequest(data);
    if (request === null) return;
    const machine = this.machine;
    if (machine === null) return;
    const decision = this.#act(request.action);
    const ack: StopAck = { v: STOP_PROTOCOL_VERSION, kind: 'stop-ack', id: request.id, machine, accepted: decision.allowed };
    this.#channel?.postMessage(ack);
  }

  #act(action: StopAction): Decision {
    switch (action) {
      case 'pause':
        return this.#session.feedhold();
      case 'stopJob':
        return this.#session.stopJob();
      case 'spindleOff':
        return this.#session.spindleOffNow();
    }
  }

  /** Re-decide the lock (the flash service calls it when an update starts or ends). */
  sync(): void {
    this.#syncLock();
  }

  #syncLock(): void {
    const snapshot = this.#session.snapshot;
    const flashing = this.#flashing();
    const wanted = snapshot.port !== null ? machineLockName(snapshot.identity?.id, this.#instance) : flashing !== null ? machineLockName(flashing.boardId ?? undefined, this.#instance) : null;
    const current = this.machine;
    if (wanted === current) return;
    this.#let();
    if (wanted === null) {
      this.#lock = { kind: 'none' };
      return;
    }
    this.#take(wanted);
  }

  #let(): void {
    this.#generation += 1;
    const release = this.#release;
    this.#release = null;
    release?.();
  }

  #take(name: string): void {
    const locks = this.#locks;
    if (locks === null) {
      this.#lock = { kind: 'unavailable', name };
      return;
    }
    const generation = this.#generation;
    this.#lock = { kind: 'requesting', name };
    const granted = (lock: unknown): Promise<void> => {
      if (generation !== this.#generation) return Promise.resolve();
      if (lock === null) {
        this.#lock = { kind: 'contended', name };
        return Promise.resolve();
      }
      this.#lock = { kind: 'held', name };
      return new Promise<void>((resolve) => {
        this.#release = resolve;
      });
    };
    locks.request(name, { ifAvailable: true }, granted).catch(() => {
      if (generation === this.#generation) this.#lock = { kind: 'unavailable', name };
    });
  }
}
