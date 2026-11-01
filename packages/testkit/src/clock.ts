/**
 * Virtual clock (ROADMAP P0-11, RUN_PLAN §8.1).
 *
 * Every timed thing in the test kit (the serial link, the firmware models,
 * fault plans, the mock port) runs on this clock, never on wall time. Time
 * only moves when a test calls `advance`, so a run is deterministic: the
 * same calls produce the same callbacks in the same order at the same
 * virtual times, whatever the host machine's speed.
 *
 * Ordering: timers fire by due time, then by the order they were scheduled.
 * A callback that schedules another timer due at or before the target of the
 * current `advance` sees it fire within the same `advance`.
 */

/** Anything that can tell the time and schedule work. Models depend on this, not on `VirtualClock`. */
export interface Clock {
  /** Current virtual time in milliseconds (may be fractional). */
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
}

interface Timer {
  readonly id: number;
  readonly at: number;
  readonly seq: number;
  readonly callback: () => void;
}

/** Callbacks run by one `advance` before it is treated as a runaway loop. */
const DEFAULT_MAX_CALLBACKS = 5_000_000;

export class VirtualClock implements Clock {
  #now = 0;
  #seq = 0;
  #nextId = 1;
  #heap: Timer[] = [];
  #live = new Set<number>();
  readonly #maxCallbacks: number;

  constructor(options: { readonly start?: number; readonly maxCallbacksPerAdvance?: number } = {}) {
    const start = options.start ?? 0;
    if (!Number.isFinite(start) || start < 0) throw new RangeError(`clock start must be a finite time >= 0, got ${start}`);
    this.#now = start;
    this.#maxCallbacks = options.maxCallbacksPerAdvance ?? DEFAULT_MAX_CALLBACKS;
  }

  now(): number {
    return this.#now;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError(`timer delay must be a finite number >= 0, got ${delayMs}`);
    const id = this.#nextId++;
    this.#push({ id, at: this.#now + delayMs, seq: this.#seq++, callback });
    this.#live.add(id);
    return id;
  }

  clearTimeout(id: number): void {
    this.#live.delete(id);
  }

  /** Number of timers still scheduled. */
  pending(): number {
    return this.#live.size;
  }

  /** Due time of the next live timer, or undefined when none is scheduled. */
  nextAt(): number | undefined {
    this.#dropCancelledHead();
    return this.#heap[0]?.at;
  }

  /**
   * Move time forward by `ms`, running every timer that falls due on the way,
   * each at its own due time. Throws on a runaway (a callback that keeps
   * rescheduling itself at the same instant).
   */
  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`advance needs a finite duration >= 0, got ${ms}`);
    this.advanceTo(this.#now + ms);
  }

  /** Move time forward to `target` (absolute), running due timers. */
  advanceTo(target: number): void {
    if (!Number.isFinite(target) || target < this.#now) throw new RangeError(`cannot move the clock back from ${this.#now} to ${target}`);
    let ran = 0;
    for (;;) {
      const timer = this.#popDue(target);
      if (timer === undefined) break;
      this.#now = timer.at;
      if (++ran > this.#maxCallbacks) throw new Error(`virtual clock: more than ${this.#maxCallbacks} callbacks in one advance (runaway timer?)`);
      timer.callback();
    }
    this.#now = target;
  }

  /**
   * Advance in steps of `stepMs` until `predicate` holds or `maxMs` has passed.
   * Returns true if the predicate held. The predicate is checked before the
   * first step, so an already-true condition costs no time.
   */
  runUntil(predicate: () => boolean, maxMs: number, stepMs = 1): boolean {
    if (!(stepMs > 0)) throw new RangeError(`step must be > 0, got ${stepMs}`);
    const end = this.#now + maxMs;
    while (!predicate()) {
      if (this.#now >= end) return false;
      this.advanceTo(Math.min(end, this.#now + stepMs));
    }
    return true;
  }

  /**
   * Like `advance`, but yields to the JavaScript task queue between timer
   * callbacks so promise-based consumers (Web Streams in `MockSerialPort`)
   * can react at the virtual time the data arrived. Virtual time still moves
   * only here; the yields use a real zero-delay macrotask and take no
   * virtual time.
   */
  async advanceAsync(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`advance needs a finite duration >= 0, got ${ms}`);
    const target = this.#now + ms;
    await settle();
    for (;;) {
      const next = this.nextAt();
      if (next === undefined || next > target) break;
      this.advanceTo(next);
      await settle();
    }
    this.advanceTo(target);
    await settle();
  }

  #dropCancelledHead(): void {
    while (this.#heap.length > 0 && !this.#live.has((this.#heap[0] as Timer).id)) this.#pop();
  }

  #popDue(target: number): Timer | undefined {
    this.#dropCancelledHead();
    const head = this.#heap[0];
    if (head === undefined || head.at > target) return undefined;
    this.#pop();
    this.#live.delete(head.id);
    return head;
  }

  // A binary min-heap on (at, seq): O(log n) per timer.
  #less(a: Timer, b: Timer): boolean {
    return a.at < b.at || (a.at === b.at && a.seq < b.seq);
  }

  #push(timer: Timer): void {
    const heap = this.#heap;
    heap.push(timer);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.#less(heap[i] as Timer, heap[parent] as Timer)) break;
      [heap[i], heap[parent]] = [heap[parent] as Timer, heap[i] as Timer];
      i = parent;
    }
  }

  #pop(): void {
    const heap = this.#heap;
    const last = heap.pop() as Timer;
    if (heap.length === 0) return;
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && this.#less(heap[l] as Timer, heap[m] as Timer)) m = l;
      if (r < heap.length && this.#less(heap[r] as Timer, heap[m] as Timer)) m = r;
      if (m === i) return;
      [heap[i], heap[m]] = [heap[m] as Timer, heap[i] as Timer];
      i = m;
    }
  }
}

type RealSetTimeout = (callback: () => void, ms: number) => unknown;

/**
 * Let pending promise reactions run: one real zero-delay macrotask, which
 * drains the microtask queue (stream reads, awaits) before it fires.
 */
export function settle(): Promise<void> {
  const realSetTimeout = (globalThis as unknown as { setTimeout: RealSetTimeout }).setTimeout;
  return new Promise((resolve) => {
    realSetTimeout(resolve, 0);
  });
}
