/**
 * The byte link the xboot client talks over, abstract so the client runs
 * unchanged against the test kit's fake xboot and against the machine
 * package's bootloader link (packages/machine/src/bootloaderLink.ts), which
 * is the only implementation over a real port.
 *
 * A `ByteLink` writes whole frames and reads exact byte counts with a
 * deadline. It has no cancel: a frame that started is finished (the
 * machine-path rule against cutting a write in half).
 */

export interface FlasherClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
}

export interface ByteLink {
  /** One frame (FrameGuard decides what is one). Rejects when the link is down or the guard refuses it. */
  write(frame: Uint8Array): Promise<void>;
  /** Exactly `n` bytes, or a `LinkTimeout` after `timeoutMs`, or a `LinkClosed` when the link goes. */
  read(n: number, timeoutMs: number): Promise<Uint8Array>;
  /** Drop every byte received and not yet read (leftovers before a sync). */
  discardInput(): void;
  /** True once the link closed or dropped. */
  readonly closed: boolean;
}

export class LinkTimeout extends Error {
  override readonly name = 'LinkTimeout';
  /** The bytes that did arrive before the deadline. */
  readonly partial: Uint8Array;
  constructor(wanted: number, partial: Uint8Array) {
    super(`no answer: ${partial.length} of ${wanted} bytes arrived in time`);
    this.partial = partial;
  }
}

export class LinkClosed extends Error {
  override readonly name = 'LinkClosed';
  constructor(detail = 'the link closed') {
    super(detail);
  }
}

/**
 * Turns a stream of chunks into exact reads with deadlines. Bytes that arrive
 * with no read waiting are kept (up to `limit`, then the oldest are dropped
 * and counted: a bootloader never sends that much unasked).
 */
export class ByteBuffer {
  readonly #clock: FlasherClock;
  readonly #limit: number;
  #chunks: Uint8Array[] = [];
  #size = 0;
  #ended: Error | null = null;
  #waiter: (() => void) | null = null;
  /** Bytes dropped because nobody read them and the buffer was full. */
  dropped = 0;

  constructor(clock: FlasherClock, limit = 1 << 20) {
    this.#clock = clock;
    this.#limit = limit;
  }

  /** Feed received bytes. */
  push(chunk: Uint8Array): void {
    if (this.#ended !== null || chunk.length === 0) return;
    this.#chunks.push(chunk.slice());
    this.#size += chunk.length;
    while (this.#size > this.#limit) {
      const first = this.#chunks[0] as Uint8Array;
      const over = this.#size - this.#limit;
      if (first.length <= over) {
        this.#chunks.shift();
        this.#size -= first.length;
        this.dropped += first.length;
      } else {
        this.#chunks[0] = first.subarray(over);
        this.#size -= over;
        this.dropped += over;
      }
    }
    this.#wake();
  }

  /** The source ended (closed or dropped). Pending and later reads reject. */
  end(error: Error = new LinkClosed()): void {
    if (this.#ended !== null) return;
    this.#ended = error;
    this.#wake();
  }

  get ended(): boolean {
    return this.#ended !== null;
  }

  get available(): number {
    return this.#size;
  }

  discard(): void {
    this.#chunks = [];
    this.#size = 0;
  }

  #wake(): void {
    const w = this.#waiter;
    this.#waiter = null;
    w?.();
  }

  #take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let filled = 0;
    while (filled < n) {
      const first = this.#chunks[0] as Uint8Array;
      const need = n - filled;
      if (first.length <= need) {
        out.set(first, filled);
        filled += first.length;
        this.#chunks.shift();
      } else {
        out.set(first.subarray(0, need), filled);
        this.#chunks[0] = first.subarray(need);
        filled += need;
      }
    }
    this.#size -= n;
    return out;
  }

  read(n: number, timeoutMs: number): Promise<Uint8Array> {
    if (this.#waiter !== null) return Promise.reject(new Error('one read at a time'));
    if (n === 0) return Promise.resolve(new Uint8Array(0));
    return new Promise((resolve, reject) => {
      let timer: number | null = null;
      const settle = (): boolean => {
        if (this.#size >= n) {
          if (timer !== null) this.#clock.clearTimeout(timer);
          resolve(this.#take(n));
          return true;
        }
        if (this.#ended !== null) {
          if (timer !== null) this.#clock.clearTimeout(timer);
          reject(this.#ended);
          return true;
        }
        return false;
      };
      if (settle()) return;
      const wait = (): void => {
        this.#waiter = () => {
          if (!settle()) wait();
        };
      };
      timer = this.#clock.setTimeout(() => {
        this.#waiter = null;
        reject(new LinkTimeout(n, this.#take(this.#size)));
      }, timeoutMs);
      wait();
    });
  }
}
