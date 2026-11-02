/**
 * The window's side of Pause, Escape and cross-tab stop requests (ROADMAP
 * P1-06; SAFETY §4.3 "Web Lock", §4.4 "Pause button (feedhold), or Escape";
 * protocol in machine-worker/stopChannel.ts).
 *
 * - `TabStop.request` posts a stop-class request on the stop
 *   BroadcastChannel BEFORE anything else (no await precedes the post), so
 *   every LIVE machine worker of this browser, in this tab or any other,
 *   acts on it at once. Then it waits 250 ms for one acknowledgement per
 *   held machine lock and reports each machine: delivered, or "STOP NOT
 *   DELIVERED — use your E-stop".
 * - `LockWatcher` polls the machine locks. A tab that is not LIVE and sees a
 *   machine lock is an observer ("Machine is controlled in another tab");
 *   a watched lock that goes away is W29.
 * - `installEscapeStop` listens for Escape in the capture phase on the
 *   window, so no focused element can swallow it, and never reacts to Space.
 *
 * Pause, Stop job and the requests are never gated by sign-in, the
 * advisory or LIVE entry (DECISIONS D1): nothing here consults them.
 */
import { heldMachineLocks, parseStopAck, STOP_ACK_TIMEOUT_MS, STOP_PROTOCOL_VERSION, type BroadcastChannelLike, type LockManagerLike, type StopAction, type StopRequest } from '../machine-worker/stopChannel.ts';

export interface Timers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface MachineOutcome {
  readonly machine: string;
  readonly delivered: boolean;
  readonly accepted: boolean;
}

export type StopOutcome =
  /** Every held machine lock answered. */
  | { readonly kind: 'delivered'; readonly action: StopAction; readonly machines: readonly MachineOutcome[] }
  /** At least one machine (or, when the locks cannot be read, any machine at all) did not answer in time. */
  | { readonly kind: 'not-delivered'; readonly action: StopAction; readonly machines: readonly MachineOutcome[] }
  /** No machine lock is held in this browser and no worker answered: there was nothing to stop. */
  | { readonly kind: 'no-machine'; readonly action: StopAction; readonly machines: readonly [] };

export interface TabStopOptions {
  readonly channel: BroadcastChannelLike | null;
  readonly locks: LockManagerLike | null;
  readonly timers: Timers;
  readonly newId: () => string;
}

interface Pending {
  readonly acks: Map<string, boolean>;
}

export class TabStop {
  readonly #channel: BroadcastChannelLike | null;
  readonly #locks: LockManagerLike | null;
  readonly #timers: Timers;
  readonly #newId: () => string;
  readonly #pending = new Map<string, Pending>();

  constructor(options: TabStopOptions) {
    this.#channel = options.channel;
    this.#locks = options.locks;
    this.#timers = options.timers;
    this.#newId = options.newId;
    this.#channel?.addEventListener('message', (event) => {
      const ack = parseStopAck(event.data);
      if (ack === null) return;
      this.#pending.get(ack.id)?.acks.set(ack.machine, ack.accepted);
    });
  }

  /** Sends the request now, then resolves with each machine's outcome after the acknowledgement window. */
  request(action: StopAction): Promise<StopOutcome> {
    const id = this.#newId().slice(0, 64);
    const pending: Pending = { acks: new Map() };
    this.#pending.set(id, pending);
    const message: StopRequest = { v: STOP_PROTOCOL_VERSION, kind: 'stop-request', id, action };
    let posted = false;
    try {
      this.#channel?.postMessage(message);
      posted = this.#channel !== null;
    } catch {
      posted = false;
    }
    const ackWindow = new Promise<void>((resolve) => {
      this.#timers.setTimeout(resolve, STOP_ACK_TIMEOUT_MS);
    });
    return Promise.all([heldMachineLocks(this.#locks), ackWindow]).then(([held]) => {
      this.#pending.delete(id);
      return outcome(action, posted, held, pending.acks);
    });
  }
}

function outcome(action: StopAction, posted: boolean, held: readonly string[] | null, acks: ReadonlyMap<string, boolean>): StopOutcome {
  const names = [...new Set([...(held ?? []), ...acks.keys()])].sort();
  const machines = names.map((machine) => ({ machine, delivered: acks.has(machine), accepted: acks.get(machine) === true }));
  if (held !== null && names.length === 0) return { kind: 'no-machine', action, machines: [] };
  // Locks unreadable and nobody answered, or the channel is missing: assume a machine may be there.
  if (!posted || machines.length === 0 || machines.some((m) => !m.delivered)) return { kind: 'not-delivered', action, machines };
  return { kind: 'delivered', action, machines };
}

// ---------------------------------------------------------------- observer

export interface TabRole {
  /** Machine locks held in this browser (by this tab's worker too, when LIVE). */
  readonly held: readonly string[];
  /** Locks this tab watched as an observer that have since been released (W29), until dismissed or held again. */
  readonly released: readonly string[];
  /** True while this tab is not LIVE and another tab holds a machine lock. */
  readonly observing: boolean;
}

export const LOCK_POLL_MS = 250;
export const NO_ROLE: TabRole = Object.freeze({ held: [], released: [], observing: false });

export class LockWatcher {
  readonly #locks: LockManagerLike | null;
  readonly #isLive: () => boolean;
  readonly #timers: Timers;
  readonly #onChange: (role: TabRole) => void;
  #role: TabRole = NO_ROLE;
  #watched = new Set<string>();
  #handle: unknown = null;

  constructor(locks: LockManagerLike | null, isLive: () => boolean, timers: Timers, onChange: (role: TabRole) => void) {
    this.#locks = locks;
    this.#isLive = isLive;
    this.#timers = timers;
    this.#onChange = onChange;
  }

  get role(): TabRole {
    return this.#role;
  }

  start(): void {
    if (this.#handle !== null || this.#locks === null) return;
    const tick = (): void => {
      void this.poll().finally(() => {
        if (this.#handle !== null) this.#handle = this.#timers.setTimeout(tick, LOCK_POLL_MS);
      });
    };
    this.#handle = this.#timers.setTimeout(tick, 0);
  }

  stop(): void {
    if (this.#handle !== null) this.#timers.clearTimeout(this.#handle);
    this.#handle = null;
  }

  /** Clears W29 for the released locks (the user read it). */
  dismissReleased(): void {
    for (const name of this.#role.released) this.#watched.delete(name);
    this.#set({ ...this.#role, released: [] });
  }

  async poll(): Promise<void> {
    const held = await heldMachineLocks(this.#locks);
    if (held === null) return; // Cannot tell: keep what is shown.
    const live = this.#isLive();
    if (live) {
      // This tab controls its machine; it watches nothing as an observer.
      this.#watched.clear();
      this.#set({ held, released: [], observing: false });
      return;
    }
    for (const name of held) this.#watched.add(name);
    const released = [...this.#watched].filter((n) => !held.includes(n)).sort();
    this.#set({ held, released, observing: held.length > 0 });
  }

  #set(role: TabRole): void {
    const same = role.observing === this.#role.observing && role.held.join() === this.#role.held.join() && role.released.join() === this.#role.released.join();
    this.#role = Object.freeze({ held: Object.freeze([...role.held]), released: Object.freeze([...role.released]), observing: role.observing });
    if (!same) this.#onChange(this.#role);
  }
}

// ---------------------------------------------------------------- Escape

export interface KeyTarget {
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void, options: { readonly capture: true }): void;
}

/**
 * Escape anywhere, in the capture phase, calls `onPause` synchronously
 * (T-S18). Space never does. The event is not cancelled, so Escape still
 * closes a dialog or leaves fullscreen as well.
 */
export function installEscapeStop(target: KeyTarget, onPause: () => void): void {
  target.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' || event.key === 'Esc') onPause();
    },
    { capture: true },
  );
}
