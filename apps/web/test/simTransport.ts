/** A `Transport` over the test kit's `SimEndpoint` on a virtual clock (the firmware and banner-wait tests). */
import type { Transport, TransportInfo, TransportOpenOptions } from '@synthetos/machine';
import type { SimEndpoint, VirtualClock } from '@synthetos/testkit';

/** How many links hold the simulated port, and the most that ever did at once (a real port opens only once). */
export interface PortHolders {
  open: number;
  most: number;
}

export class SimTransport implements Transport {
  readonly #endpoint: SimEndpoint;
  readonly #clock: VirtualClock;
  readonly #holders: PortHolders;
  readonly #closeMs: number;
  #open = false;
  #closed = false;
  #synced = false;
  #queue: Uint8Array[] = [];
  #wake: (() => void) | undefined;
  #error: Error | undefined;
  constructor(endpoint: SimEndpoint, clock: VirtualClock, holders: PortHolders, closeMs: number) {
    this.#endpoint = endpoint;
    this.#clock = clock;
    this.#holders = holders;
    this.#closeMs = closeMs;
    endpoint.onHostData((c) => {
      if (!this.#open || this.#closed) return;
      // Test rig: a port opened while the board was half-way through a heartbeat line would hand the session the
      // line's tail, which it rightly treats as damaged (ORPHANED_MOTION). Start at a line boundary instead.
      let chunk = c;
      if (!this.#synced) {
        const lf = c.indexOf(0x0a);
        if (lf < 0) return;
        this.#synced = true;
        chunk = c.subarray(lf + 1);
        if (chunk.length === 0) return;
      }
      this.#queue.push(chunk.slice());
      this.#wake?.();
    });
    endpoint.onDisconnect(() => {
      this.#error = new Error('NetworkError: the device has been lost');
      this.#wake?.();
    });
  }
  info(): TransportInfo {
    return { kind: 'sim', usbVendorId: 0x0403, usbProductId: 0x6015 };
  }
  async open(options: TransportOpenOptions): Promise<void> {
    if (!this.#endpoint.connected) throw new Error('NetworkError: no device');
    this.#endpoint.setHostBaud(options.baudRate);
    this.#open = true;
    this.#holders.open++;
    this.#holders.most = Math.max(this.#holders.most, this.#holders.open);
  }
  async writeLine(line: Uint8Array): Promise<void> {
    if (!this.#endpoint.connected) throw new Error('NetworkError');
    // From the first write on, everything received is an answer to this link.
    this.#synced = true;
    this.#endpoint.hostWrite(line);
  }
  get readable(): AsyncIterable<Uint8Array> {
    const next = async (): Promise<IteratorResult<Uint8Array>> => {
      for (;;) {
        const c = this.#queue.shift();
        if (c !== undefined) return { done: false, value: c };
        if (this.#error !== undefined) throw this.#error;
        if (this.#closed) return { done: true, value: undefined };
        await new Promise<void>((r) => (this.#wake = r));
        this.#wake = undefined;
      }
    };
    return { [Symbol.asyncIterator]: () => ({ next }) };
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#wake?.();
    // A real port takes a while to close (drain, cancel the reader, close): it holds the port until then.
    if (this.#closeMs > 0) await new Promise<void>((resolve) => this.#clock.setTimeout(resolve, this.#closeMs));
    if (this.#open) this.#holders.open--;
  }
  onDisconnect(cb: () => void): void {
    this.#endpoint.onDisconnect(() => cb());
  }
}
