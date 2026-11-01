/**
 * Test helpers for the session tests: a Transport straight over a test-kit
 * `SimEndpoint` (no Web Streams, so thousands of sessions run quickly on a
 * virtual clock), a source that hands it out, and a cheap way to let the
 * session's promises run between clock steps.
 */
import type { PortSelector, Transport, TransportInfo, TransportOpenOptions, TransportSource } from '../src/index.ts';
import type { SimEndpoint } from '@synthetos/testkit';

export const PORT: PortSelector = Object.freeze({ usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 });

export class SimTransport implements Transport {
  readonly endpoint: SimEndpoint;
  /** Every write, in order, as handed to the link. */
  readonly writes: Uint8Array[] = [];
  /** Writes and reads interleaved in the order the host saw them. */
  readonly events: { readonly dir: 'w' | 'r'; readonly bytes: Uint8Array }[] = [];
  #open = false;
  #closed = false;
  #queue: Uint8Array[] = [];
  #wake: (() => void) | undefined;
  #error: Error | undefined;
  writeError: Error | undefined;

  constructor(endpoint: SimEndpoint) {
    this.endpoint = endpoint;
    endpoint.onHostData((chunk) => {
      if (!this.#open || this.#closed) return;
      const copy = chunk.slice();
      this.events.push({ dir: 'r', bytes: copy });
      this.#queue.push(copy);
      this.#wake?.();
    });
    endpoint.onDisconnect(() => {
      this.#error = new Error('NetworkError: the device has been lost');
      this.#wake?.();
    });
  }

  info(): TransportInfo {
    return { kind: 'sim', usbVendorId: this.endpoint.device.usb.vendorId, usbProductId: this.endpoint.device.usb.productId };
  }

  async open(options: TransportOpenOptions): Promise<void> {
    this.endpoint.setHostBaud(options.baudRate);
    this.#open = true;
  }

  async writeLine(line: Uint8Array): Promise<void> {
    if (this.writeError !== undefined) throw this.writeError;
    const copy = line.slice();
    this.writes.push(copy);
    this.events.push({ dir: 'w', bytes: copy });
    this.endpoint.hostWrite(line);
  }

  get readable(): AsyncIterable<Uint8Array> {
    const next = async (): Promise<IteratorResult<Uint8Array>> => {
      for (;;) {
        const chunk = this.#queue.shift();
        if (chunk !== undefined) return { done: false, value: chunk };
        if (this.#error !== undefined) throw this.#error;
        if (this.#closed) return { done: true, value: undefined };
        await new Promise<void>((resolve) => {
          this.#wake = resolve;
        });
        this.#wake = undefined;
      }
    };
    return { [Symbol.asyncIterator]: () => ({ next }) };
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#wake?.();
  }

  onDisconnect(callback: () => void): void {
    this.endpoint.onDisconnect(() => callback());
  }
}

/** A source with one granted port: `make()` builds the transport on each request. */
export function simSource(make: () => Transport | null): TransportSource & { requests: number } {
  const source = {
    kind: 'fake' as const,
    requests: 0,
    request: async (selector: PortSelector): Promise<Transport | null> => {
      source.requests += 1;
      if (selector.usbVendorId !== PORT.usbVendorId || selector.usbProductId !== PORT.usbProductId || selector.grantIndex !== PORT.grantIndex) return null;
      return make();
    },
  };
  return source;
}

/** Lets pending promise callbacks run (a real macrotask turn; virtual time does not move). */
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Lets pending promise callbacks run without leaving the microtask queue.
 * Everything the session and these transports await is a promise (no I/O,
 * no timers outside the virtual clock), so a bounded number of microtask
 * turns settles them, much faster than a macrotask per clock step.
 */
export async function microtasks(): Promise<void> {
  for (let i = 0; i < 40; i++) await null;
}

/** Text of a write, with control bytes escaped. */
export function shown(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b === 0x0a ? '\\n' : b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`;
  return out;
}
