/**
 * `MockSerialPort`: a stand-in with the shape of Web Serial's `SerialPort`
 * (ROADMAP P0-11; WICG Web Serial, the `SerialPort` interface), backed by a
 * `SimEndpoint`. It is what the fake `navigator.serial` (P0-14) hands to the
 * real transport code in tests, so that code runs unchanged against the
 * firmware models.
 *
 * It follows the spec's state machine where host code can observe it:
 * - `open()` rejects InvalidStateError unless closed, and TypeError for
 *   baudRate 0, dataBits other than 7/8, stopBits other than 1/2, or
 *   bufferSize 0;
 * - `readable` / `writable` are null until opened; a disconnect errors the
 *   readable with NetworkError and makes writes reject with NetworkError;
 * - `close()` rejects InvalidStateError unless opened, and fails (TypeError
 *   from the streams) while a reader or writer holds a lock, as the spec's
 *   cancel/abort steps do;
 * - `forget()` makes the port unusable.
 * The SerialPort object never touches `navigator.serial`; a test fake that
 * owns `navigator.serial` creates these.
 *
 * Writes resolve once the bytes are handed to the link (the spec allows an
 * implementation to resolve when bytes are queued for transmission). Every
 * `open()` is logged with its options so tests can prove, for example, that
 * nothing opened the port at 1200 baud.
 */
import './marker.ts';
import type { SimEndpoint } from './endpoint.ts';

export interface SerialPortInfo {
  readonly usbVendorId?: number;
  readonly usbProductId?: number;
}

export interface SerialOptions {
  readonly baudRate: number;
  readonly dataBits?: number;
  readonly stopBits?: number;
  readonly parity?: 'none' | 'even' | 'odd';
  readonly bufferSize?: number;
  readonly flowControl?: 'none' | 'hardware';
}

export interface SerialOutputSignals {
  readonly dataTerminalReady?: boolean;
  readonly requestToSend?: boolean;
  readonly break?: boolean;
}

export interface SerialInputSignals {
  readonly dataCarrierDetect: boolean;
  readonly clearToSend: boolean;
  readonly ringIndicator: boolean;
  readonly dataSetReady: boolean;
}

export interface MockSerialPortOptions {
  /** USB identity reported by `getInfo()`. Default: the device's own. */
  readonly info?: SerialPortInfo;
}

type State = 'closed' | 'opening' | 'opened' | 'closing' | 'forgotten';

export class MockSerialPort extends EventTarget {
  readonly endpoint: SimEndpoint;
  /** Every successful and failed open, in order. */
  readonly openLog: { readonly options: SerialOptions; readonly ok: boolean }[] = [];
  /** Every setSignals call, in order. */
  readonly signalLog: SerialOutputSignals[] = [];
  onconnect: ((this: MockSerialPort, ev: Event) => unknown) | null = null;
  ondisconnect: ((this: MockSerialPort, ev: Event) => unknown) | null = null;
  readonly #info: SerialPortInfo;
  #state: State = 'closed';
  #physicallyConnected = true;
  #readable: ReadableStream<Uint8Array<ArrayBuffer>> | null = null;
  #readController: ReadableByteStreamController | null = null;
  #writable: WritableStream<Uint8Array> | null = null;
  #unsubscribe: (() => void) | null = null;
  #signals: Required<SerialOutputSignals> = { dataTerminalReady: false, requestToSend: false, break: false };

  /**
   * `[object MockSerialPort]`. Besides honest debugging output, this keeps
   * the class's name in a production bundle as a string a minifier cannot
   * rename, so the bundle scan's `MockSerialPort` rule (P0-13, T-S40) finds
   * it even if the marker were somehow lost.
   */
  get [Symbol.toStringTag](): string {
    return 'MockSerialPort';
  }

  constructor(endpoint: SimEndpoint, options: MockSerialPortOptions = {}) {
    super();
    this.endpoint = endpoint;
    this.#info = options.info ?? { usbVendorId: endpoint.device.usb.vendorId, usbProductId: endpoint.device.usb.productId };
    endpoint.onDisconnect(() => this.#onDisconnect());
  }

  get connected(): boolean {
    return this.#physicallyConnected && this.#state !== 'forgotten';
  }

  get readable(): ReadableStream<Uint8Array<ArrayBuffer>> | null {
    if (this.#readable !== null) return this.#readable;
    if (this.#state !== 'opened' || !this.endpoint.connected) return null;
    this.#readable = new ReadableStream({
      type: 'bytes',
      start: (controller: ReadableByteStreamController) => {
        this.#readController = controller;
      },
      cancel: () => {
        this.#closeReadable();
      },
    });
    return this.#readable;
  }

  get writable(): WritableStream<Uint8Array> | null {
    if (this.#writable !== null) return this.#writable;
    if (this.#state !== 'opened' || !this.endpoint.connected) return null;
    this.#writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        if (!(chunk instanceof Uint8Array)) throw new TypeError('chunk must be a Uint8Array');
        if (!this.endpoint.connected) {
          this.#writable = null;
          throw new DOMException('The device has been lost.', 'NetworkError');
        }
        this.endpoint.hostWrite(chunk.slice());
      },
      abort: () => {
        this.#writable = null;
        this.#maybeResolveClose();
      },
      close: () => {
        this.#writable = null;
        this.#maybeResolveClose();
      },
    });
    return this.#writable;
  }

  getInfo(): SerialPortInfo {
    return { ...this.#info };
  }

  async open(options: SerialOptions): Promise<void> {
    if (this.#state !== 'closed') {
      this.openLog.push({ options: { ...options }, ok: false });
      throw new DOMException('The port is already open.', 'InvalidStateError');
    }
    const dataBits = options.dataBits ?? 8;
    const stopBits = options.stopBits ?? 1;
    const bufferSize = options.bufferSize ?? 255;
    const invalid =
      !Number.isInteger(options.baudRate) ||
      options.baudRate <= 0 ||
      (dataBits !== 7 && dataBits !== 8) ||
      (stopBits !== 1 && stopBits !== 2) ||
      !Number.isInteger(bufferSize) ||
      bufferSize <= 0;
    if (invalid) {
      this.openLog.push({ options: { ...options }, ok: false });
      throw new TypeError('invalid serial options');
    }
    if (!this.#physicallyConnected) {
      this.openLog.push({ options: { ...options }, ok: false });
      throw new DOMException('Failed to open serial port.', 'NetworkError');
    }
    this.#state = 'opened';
    this.endpoint.setHostBaud(options.baudRate);
    this.#unsubscribe = this.endpoint.onHostData((chunk) => this.#deliver(chunk));
    this.openLog.push({ options: { ...options }, ok: true });
  }

  async setSignals(signals: SerialOutputSignals): Promise<void> {
    if (this.#state !== 'opened') throw new DOMException('The port is closed.', 'InvalidStateError');
    this.#signals = { ...this.#signals, ...signals };
    this.signalLog.push({ ...signals });
  }

  async getSignals(): Promise<SerialInputSignals> {
    if (this.#state !== 'opened') throw new DOMException('The port is closed.', 'InvalidStateError');
    return { dataCarrierDetect: false, clearToSend: true, ringIndicator: false, dataSetReady: true };
  }

  /** The output signals the host last set. */
  outputSignals(): Required<SerialOutputSignals> {
    return { ...this.#signals };
  }

  #pendingClose: (() => void) | null = null;

  async close(): Promise<void> {
    if (this.#state !== 'opened') throw new DOMException('The port is not open.', 'InvalidStateError');
    // cancel()/abort() on a locked stream reject with TypeError: the spec's close fails the same way.
    const cancel = this.#readable === null ? Promise.resolve() : this.#readable.cancel();
    const abort = this.#writable === null ? Promise.resolve() : this.#writable.abort();
    const pending = new Promise<void>((resolve) => {
      this.#pendingClose = resolve;
      this.#maybeResolveClose();
    });
    this.#state = 'closing';
    try {
      await Promise.all([cancel, abort, pending]);
    } catch (e) {
      this.#pendingClose = null;
      this.#state = 'opened';
      throw e;
    }
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#state = 'closed';
  }

  async forget(): Promise<void> {
    this.#state = 'forgotten';
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  #maybeResolveClose(): void {
    if (this.#pendingClose !== null && this.#readable === null && this.#writable === null) {
      const resolve = this.#pendingClose;
      this.#pendingClose = null;
      resolve();
    }
  }

  #closeReadable(): void {
    this.#readable = null;
    this.#readController = null;
    this.#maybeResolveClose();
  }

  #deliver(chunk: Uint8Array): void {
    if (this.#state !== 'opened' && this.#state !== 'closing') return;
    // Data that arrives with nobody reading is buffered in the stream (bufferSize is the high-water mark).
    void this.readable;
    this.#readController?.enqueue(new Uint8Array(chunk));
  }

  #onDisconnect(): void {
    this.#physicallyConnected = false;
    const controller = this.#readController;
    if (controller !== null) {
      controller.error(new DOMException('The device has been lost.', 'NetworkError'));
      this.#closeReadable();
    }
    const event = new Event('disconnect');
    this.ondisconnect?.call(this, event);
    this.dispatchEvent(event);
  }
}
