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
import { MachineLock, type LockState } from './machineLock.ts';
import { parseStopRequest, STOP_PROTOCOL_VERSION, type BroadcastChannelLike, type LockManagerLike, type StopAck, type StopAction } from './stopChannel.ts';

/** The parts of `MachineSession` the stop service uses. */
export interface StopSession {
  readonly snapshot: SessionSnapshot;
  subscribe(listener: () => void): unknown;
  feedhold(): Decision;
  stopJob(): Decision;
  spindleOffNow(): Decision;
}

export type { LockState } from './machineLock.ts';
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
  readonly #lock: MachineLock;
  constructor(options: StopServiceOptions) {
    this.#session = options.session;
    this.#channel = options.channel;
    this.#lock = new MachineLock(options);
    this.#channel?.addEventListener('message', event => this.#onMessage(event.data));
  }
  get lock(): LockState { return this.#lock.lock; }
  get machine(): string | null { return this.#lock.machine; }
  sync(): void { this.#lock.sync(); }
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

}
