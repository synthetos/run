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
 * - `LockWatcher` polls the machine locks. A tab that is not LIVE and sees
 *   another tab's machine lock is an observer ("Machine is controlled in
 *   another tab"); a watched lock that goes away is W29. Locks of this tab's
 *   own worker are reported as `own`, never observed.
 * - `installEscapeStop` listens for Escape in the capture phase on the
 *   window, so no focused element can swallow it, and never reacts to Space.
 *
 * Pause, Stop job and the requests are never gated by sign-in, the
 * advisory or LIVE entry (DECISIONS D1): nothing here consults them.
 */
import { splitMachineLocks } from '../machine-worker/ownerLock.ts';
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
  /**
   * Machine locks held in this browser by another tab. A lock wrapped by this tab's owner lock
   * (`synthetos-tab:<tab token>:<machine lock>`, ownerLock.ts) is in `own` instead.
   */
  readonly held: readonly string[];
  /** Machine locks this tab's own worker holds: this tab controls those machines, LIVE or not. */
  readonly own: readonly string[];
  /** Locks this tab watched as an observer that have since been released (W29), until dismissed or held again. */
  readonly released: readonly string[];
  /** True while this tab is not LIVE and another tab holds a machine lock. */
  readonly observing: boolean;
}

export const LOCK_POLL_MS = 250;
export const NO_ROLE: TabRole = Object.freeze({ held: [], own: [], released: [], observing: false });

export interface LockWatcherOptions {
  readonly locks: LockManagerLike | null;
  /** This tab's token (ownerLock.ts): its own worker's machine locks are never observed. Null: none known. */
  readonly owner: string | null;
  readonly isLive: () => boolean;
  readonly timers: Timers;
  readonly onChange: (role: TabRole) => void;
}

export class LockWatcher {
  readonly #locks: LockManagerLike | null;
  readonly #owner: string | null;
  readonly #isLive: () => boolean;
  readonly #timers: Timers;
  readonly #onChange: (role: TabRole) => void;
  #role: TabRole = NO_ROLE;
  #watched = new Set<string>();
  #handle: unknown = null;

  constructor(options: LockWatcherOptions) {
    this.#locks = options.locks;
    this.#owner = options.owner;
    this.#isLive = options.isLive;
    this.#timers = options.timers;
    this.#onChange = options.onChange;
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
    const split = await splitMachineLocks(this.#locks, this.#owner);
    if (split === null) return; // Cannot tell: keep what is shown.
    const { others: held, own } = split;
    // A lock this tab's worker now holds is controlled here: it is no longer watched, and its going is not W29.
    for (const name of own) this.#watched.delete(name);
    if (this.#isLive()) {
      // This tab controls its machine; it watches nothing as an observer.
      this.#watched.clear();
      this.#set({ held, own, released: [], observing: false });
      return;
    }
    for (const name of held) this.#watched.add(name);
    const released = [...this.#watched].filter((n) => !held.includes(n)).sort();
    this.#set({ held, own, released, observing: held.length > 0 });
  }

  #set(role: TabRole): void {
    const key = (r: TabRole): string => `${String(r.observing)}|${r.held.join()}|${r.own.join()}|${r.released.join()}`;
    const same = key(role) === key(this.#role);
    this.#role = Object.freeze({ held: Object.freeze([...role.held]), own: Object.freeze([...role.own]), released: Object.freeze([...role.released]), observing: role.observing });
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
