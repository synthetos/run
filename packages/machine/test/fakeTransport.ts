/**
 * A scriptable inner Transport for the guard tests. It records every call in
 * order, can hold a write open until the test releases it, can fail writes,
 * and can drop the link. It never touches a port.
 */
import type { Transport, TransportInfo, TransportOpenOptions } from '../src/transport.ts';
import { SESSION_OPEN_OPTIONS } from '../src/openPolicy.ts';

export interface Deferred {
  resolve(): void;
  reject(error: unknown): void;
}

export type FakeCall =
  | { readonly op: 'open'; readonly options: TransportOpenOptions; readonly args: number }
  | { readonly op: 'write'; readonly bytes: string }
  | { readonly op: 'write-done'; readonly bytes: string }
  | { readonly op: 'close' };

export class FakeTransport implements Transport {
  readonly calls: FakeCall[] = [];
  /** When true, each write waits for `releaseWrite()` / `failWrite()`. */
  holdWrites = false;
  /** When set, the next open rejects with it. */
  openError: unknown = undefined;
  /** When set, every write rejects with it. */
  writeError: unknown = undefined;
  inFlight = 0;
  maxInFlight = 0;
  readonly #pending: Deferred[] = [];
  readonly #listeners: (() => void)[] = [];
  #info: TransportInfo;

  constructor(info: TransportInfo = { kind: 'sim', usbVendorId: 0x0403, usbProductId: 0x6015 }) {
    this.#info = info;
  }

  setInfo(info: TransportInfo): void {
    this.#info = info;
  }

  async open(options: TransportOpenOptions, ...rest: unknown[]): Promise<void> {
    this.calls.push({ op: 'open', options, args: 1 + rest.length });
    if (this.openError !== undefined) throw this.openError;
  }

  async writeLine(line: Uint8Array): Promise<void> {
    const bytes = new TextDecoder().decode(line);
    this.calls.push({ op: 'write', bytes });
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.holdWrites) {
        await new Promise<void>((resolve, reject) => this.#pending.push({ resolve, reject }));
      }
      if (this.writeError !== undefined) throw this.writeError;
      this.calls.push({ op: 'write-done', bytes });
    } finally {
      this.inFlight--;
    }
  }

  /** Let the oldest held write complete. */
  releaseWrite(): void {
    const d = this.#pending.shift();
    if (d === undefined) throw new Error('no held write');
    d.resolve();
  }

  /** Make the oldest held write fail. */
  failWrite(error: unknown = new Error('NetworkError: the device has been lost')): void {
    const d = this.#pending.shift();
    if (d === undefined) throw new Error('no held write');
    d.reject(error);
  }

  get held(): number {
    return this.#pending.length;
  }

  readonly readable: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
  };

  async close(): Promise<void> {
    this.calls.push({ op: 'close' });
  }

  onDisconnect(callback: () => void): void {
    this.#listeners.push(callback);
  }

  drop(): void {
    for (const l of this.#listeners) l();
  }

  info(): TransportInfo {
    return this.#info;
  }

  /** Every byte string that reached the port, in order. */
  written(): string[] {
    return this.calls.flatMap((c) => (c.op === 'write' ? [c.bytes] : []));
  }

  opens(): number {
    return this.calls.filter((c) => c.op === 'open').length;
  }
}

/** Resolve after all currently queued microtasks and promise callbacks. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

export const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Options a session uses for every TinyG and g2core control port. */
/** The session options, from dialect data (never typed in, so a dialect edit cannot drift from the fakes). */
export const SESSION_OPTIONS = SESSION_OPEN_OPTIONS;
