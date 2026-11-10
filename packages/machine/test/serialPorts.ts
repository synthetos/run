/**
 * `SerialPort`-shaped doubles for the WebSerialTransport tests (P1-01).
 *
 * - `ScriptedSerialPort` records every call in order and lets a test hold an
 *   open or a write, fail one, push read results (including non-bytes and
 *   errors) and drop the link. It follows the Web Serial rules the
 *   transport depends on: one writer and one reader at a time (a second
 *   `getWriter`/`getReader` throws, as a locked stream does), and `close()`
 *   fails while either stream is locked.
 * - `ReplaySerialPort` puts a test-kit `ReplayTransport` behind the same
 *   shape, so one bench recording can be replayed both to the replay itself
 *   and to the real `WebSerialTransport` (the conformance suite).
 *
 * The test kit's `MockSerialPort` (a firmware model behind a simulated link)
 * is the third double; the tests use it wherever a real board is wanted.
 */
import type { ReplayTransport } from '@synthetos/testkit';
import type { SerialPortInfoLike, SerialPortLike, WebSerialOpenOptions } from '../src/webSerialTransport.ts';

interface Deferred {
  resolve(): void;
  reject(error: unknown): void;
}

type ReadResult = { readonly done: boolean; readonly value?: unknown };

export class ScriptedSerialPort implements SerialPortLike {
  readonly log: string[] = [];
  readonly opened: WebSerialOpenOptions[] = [];
  /** Every chunk handed to the writer, as the very object the transport passed. */
  readonly chunks: Uint8Array[] = [];
  infoReads = 0;
  holdOpen = false;
  openError: unknown = undefined;
  holdWrites = false;
  writeError: unknown = undefined;
  noWritable = false;
  noReadable = false;
  writableCloseError: unknown = undefined;
  readerCancelError: unknown = undefined;
  writerLocked = false;
  readerLocked = false;
  /** Every setSignals call, apart from `log` so the call-order assertions stay as they were (OD-33, rts.ts). */
  readonly signals: { readonly requestToSend?: boolean }[] = [];
  signalsError: unknown = undefined;
  readonly #info: SerialPortInfoLike;
  readonly #listeners: (() => void)[] = [];
  readonly #heldWrites: Deferred[] = [];
  #heldOpen: Deferred | undefined;
  readonly #results: (ReadResult | { readonly error: unknown })[] = [];
  #waiter: { resolve(r: ReadResult): void; reject(e: unknown): void } | undefined;
  #readableClosed = false;

  constructor(info: SerialPortInfoLike = { usbVendorId: 0x0403, usbProductId: 0x6015 }) {
    this.#info = info;
  }

  getInfo(): SerialPortInfoLike {
    this.infoReads++;
    return this.#info;
  }

  async open(options: WebSerialOpenOptions): Promise<void> {
    this.log.push('open');
    this.opened.push(options);
    if (this.holdOpen) await new Promise<void>((resolve, reject) => (this.#heldOpen = { resolve, reject }));
    if (this.openError !== undefined) throw this.openError;
  }

  async setSignals(signals: { readonly requestToSend?: boolean }): Promise<void> {
    this.signals.push({ ...signals });
    if (this.signalsError !== undefined) throw this.signalsError;
  }

  releaseOpen(): void {
    this.#heldOpen?.resolve();
  }

  get writable(): SerialPortLike['writable'] {
    if (this.noWritable) return null;
    const isLocked = (): boolean => this.writerLocked;
    return {
      get locked() {
        return isLocked();
      },
      getWriter: () => {
        if (this.writerLocked) throw new TypeError('the writable stream is locked');
        this.writerLocked = true;
        let released = false;
        return {
          write: async (chunk: Uint8Array) => {
            this.log.push('write');
            this.chunks.push(chunk);
            if (this.holdWrites) await new Promise<void>((resolve, reject) => this.#heldWrites.push({ resolve, reject }));
            if (this.writeError !== undefined) throw this.writeError;
            this.log.push('write-done');
          },
          releaseLock: () => {
            if (released) return;
            released = true;
            this.writerLocked = false;
            this.log.push('writer-released');
          },
        };
      },
      close: async () => {
        this.log.push('writable-close');
        if (this.writableCloseError !== undefined) throw this.writableCloseError;
      },
    };
  }

  get heldWrites(): number {
    return this.#heldWrites.length;
  }

  releaseWrite(): void {
    this.#heldWrites.shift()?.resolve();
  }

  failWrite(error: unknown): void {
    this.#heldWrites.shift()?.reject(error);
  }

  get readable(): SerialPortLike['readable'] {
    if (this.noReadable) return null;
    return {
      getReader: () => {
        if (this.readerLocked) throw new TypeError('the readable stream is locked');
        this.readerLocked = true;
        this.log.push('reader');
        let released = false;
        return {
          read: () => this.#read(),
          cancel: async () => {
            this.log.push('reader-cancel');
            this.#readableClosed = true;
            this.#waiter?.resolve({ done: true });
            this.#waiter = undefined;
            if (this.readerCancelError !== undefined) throw this.readerCancelError;
          },
          releaseLock: () => {
            if (released) return;
            released = true;
            this.readerLocked = false;
            this.log.push('reader-released');
          },
        };
      },
    };
  }

  /** The next read resolves with this value (any value, to test what the transport accepts). */
  push(value: unknown): void {
    this.#deliver({ done: false, value });
  }

  /** The next read rejects with this error. */
  failRead(error: unknown): void {
    this.#deliver({ error });
  }

  #deliver(r: ReadResult | { readonly error: unknown }): void {
    const w = this.#waiter;
    if (w === undefined) {
      this.#results.push(r);
      return;
    }
    this.#waiter = undefined;
    if ('error' in r) w.reject(r.error);
    else w.resolve(r);
  }

  #read(): Promise<ReadResult> {
    const next = this.#results.shift();
    if (next !== undefined) return 'error' in next ? Promise.reject(next.error) : Promise.resolve(next);
    if (this.#readableClosed) return Promise.resolve({ done: true });
    return new Promise((resolve, reject) => (this.#waiter = { resolve, reject }));
  }

  async close(): Promise<void> {
    this.log.push('port-close');
    if (this.writerLocked || this.readerLocked) throw new TypeError('cannot close a port while a stream is locked');
  }

  addEventListener(_type: 'disconnect', listener: () => void): void {
    this.#listeners.push(listener);
  }

  disconnect(): void {
    for (const l of this.#listeners) l();
  }
}

/**
 * A `SerialPort` whose wire is a `ReplayTransport`: writes go to the replay
 * (which checks them against the recording), and the recording's replies are
 * read back through a reader.
 */
export class ReplaySerialPort implements SerialPortLike {
  readonly replay: ReplayTransport;
  readonly #info: SerialPortInfoLike;

  constructor(replay: ReplayTransport, info: SerialPortInfoLike = { usbVendorId: 0x0403, usbProductId: 0x6015 }) {
    this.replay = replay;
    this.#info = info;
  }

  getInfo(): SerialPortInfoLike {
    return this.#info;
  }

  /** The options the transport opened with. */
  readonly opened: WebSerialOpenOptions[] = [];

  open(options: WebSerialOpenOptions): Promise<void> {
    this.opened.push(options);
    return this.replay.open();
  }

  /** RTS is not part of a recording (rts.ts): accepted and ignored. */
  setSignals(_signals: { readonly requestToSend?: boolean }): Promise<void> {
    return Promise.resolve();
  }

  get writable(): SerialPortLike['writable'] {
    return {
      locked: false,
      getWriter: () => ({ write: (chunk: Uint8Array) => this.replay.writeLine(chunk), releaseLock: () => undefined }),
      close: () => Promise.resolve(),
    };
  }

  get readable(): SerialPortLike['readable'] {
    return {
      getReader: () => {
        const iterator = this.replay.readable[Symbol.asyncIterator]();
        return {
          read: async () => {
            const r = await iterator.next();
            return r.done === true ? { done: true } : { done: false, value: r.value };
          },
          cancel: async () => {
            await iterator.return?.();
          },
          releaseLock: () => undefined,
        };
      },
    };
  }

  close(): Promise<void> {
    return this.replay.close();
  }

  addEventListener(_type: 'disconnect', listener: () => void): void {
    this.replay.onDisconnect(listener);
  }
}
