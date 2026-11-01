/**
 * `MockTransport`: the machine `Transport` over a `SerialPort`-shaped object
 * (ROADMAP P0-14). TEST BUILD ONLY: it reaches the app only through the
 * fake-serial build's swap of the transport seam (apps/web/build/fakeSerial.ts),
 * and is handed a test-kit `MockSerialPort`.
 *
 * It adapts the port the way a Web Serial transport does (open with the
 * guard's options, one writer per line, one reader for `readable`, cancel
 * the reader before closing the port) and adds no checks of its own: the
 * worker always wraps it in `GuardedTransport`, and the guard is what the
 * suite exercises. P1-01's `WebSerialTransport` is the production
 * counterpart; see docs/testing/fake-serial.md for why the seam should move
 * below it then.
 */
import type { Transport, TransportInfo, TransportOpenOptions } from '@synthetos/machine';

/** The parts of Web Serial's `SerialPort` this adapter uses (MockSerialPort has them all). */
export interface SerialPortLike {
  open(options: { baudRate: number; flowControl: 'none' | 'hardware'; bufferSize: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): { readonly usbVendorId?: number; readonly usbProductId?: number };
  addEventListener(type: 'disconnect', listener: () => void): void;
}

export class MockTransport implements Transport {
  readonly #port: SerialPortLike;
  #reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(port: SerialPortLike) {
    this.#port = port;
  }

  info(): TransportInfo {
    const { usbVendorId, usbProductId } = this.#port.getInfo();
    return usbVendorId === undefined || usbProductId === undefined ? { kind: 'sim' } : { kind: 'sim', usbVendorId, usbProductId };
  }

  open(options: TransportOpenOptions): Promise<void> {
    return this.#port.open({ baudRate: options.baudRate, flowControl: options.flowControl, bufferSize: options.bufferSize });
  }

  async writeLine(line: Uint8Array): Promise<void> {
    const writable = this.#port.writable;
    if (writable === null) throw new DOMException('The port is not writable.', 'InvalidStateError');
    const writer = writable.getWriter();
    try {
      await writer.write(line);
    } finally {
      writer.releaseLock();
    }
  }

  get readable(): AsyncIterable<Uint8Array> {
    return { [Symbol.asyncIterator]: () => this.#read() };
  }

  async *#read(): AsyncGenerator<Uint8Array> {
    const readable = this.#port.readable;
    if (readable === null) return;
    const reader = readable.getReader();
    this.#reader = reader;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
      if (this.#reader === reader) this.#reader = null;
    }
  }

  async close(): Promise<void> {
    const reader = this.#reader;
    if (reader !== null) {
      this.#reader = null;
      await reader.cancel();
      reader.releaseLock();
    }
    await this.#port.close();
  }

  onDisconnect(callback: () => void): void {
    this.#port.addEventListener('disconnect', () => callback());
  }
}
