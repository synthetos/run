/** The shared machine lock survives the firmware handoff; it sends no controller commands. */
import type { SessionSnapshot } from '@synthetos/machine';
import { machineLockName, type LockManagerLike } from './stopChannel.ts';
export interface LockSession {
  readonly snapshot: SessionSnapshot;
  subscribe(listener: () => void): unknown;
}
export interface MachineLockOptions {
  readonly session: LockSession;
  readonly locks: LockManagerLike | null;
  readonly instance: string;
  readonly flashing?: () => { readonly boardId: string | null } | null;
}
export type LockState =
  | { readonly kind: 'none' }
  | { readonly kind: 'requesting'; readonly name: string }
  | { readonly kind: 'held'; readonly name: string }
  | { readonly kind: 'contended'; readonly name: string }
  | { readonly kind: 'unavailable'; readonly name: string };

export class MachineLock {
  readonly #session: LockSession;
  readonly #locks: LockManagerLike | null;
  readonly #instance: string;
  readonly #flashing: () => { readonly boardId: string | null } | null;
  #lock: LockState = { kind: 'none' };
  /** Ends the current lock request's hold (resolves the promise the lock callback returned). */
  #release: (() => void) | null = null;
  /** Bumped on every lock change, so a late grant for an old name is let go at once. */
  #generation = 0;

  constructor(options: MachineLockOptions) {
    this.#session = options.session;
    this.#locks = options.locks;
    this.#instance = options.instance;
    this.#flashing = options.flashing ?? (() => null);
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
