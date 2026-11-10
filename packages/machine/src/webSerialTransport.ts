/**
 * `WebSerialTransport`: the machine `Transport` over a Web Serial
 * `SerialPort` (ROADMAP P1-01; RUN_PLAN §5.1 rules 1 and 5, §5.4; SAFETY
 * H2b, §3 OPENING, T-S16; PN §7.4; OLD-TP §4.2).
 *
 * THIS IS THE ONE MODULE THAT MAY OPEN A WEB SERIAL PORT
 * (tools/gates/src/shared/webSerialNames.ts, WEB_SERIAL_TRANSPORT_MODULE).
 * The only other Web Serial module is the window's port chooser
 * (webSerialChooser.ts, OD-3), which shows the chooser and never opens.
 * Every gate holds it to that: lint admits a static `navigator.serial` read
 * here and nowhere else, dependency-cruiser lets only the machine worker's
 * transport seam (and this package's tests) import it, and the build files
 * it in a chunk of its own under `assets/serial/`, the only place the
 * bundle scan admits Web Serial (staging and bench targets; production
 * refuses it). It imports TYPES ONLY, so nothing else can join that chunk:
 * every constant below is a literal, and
 * packages/machine/test/web-serial-transport.test.ts proves each one equals
 * the open policy's (openPolicy.ts).
 *
 * After every open it turns RTS on (and never touches DTR), or closes the port
 * and refuses the open: a TinyG on `$ex=2` sends nothing while RTS is off
 * (OD-33). This covers the session's open, reconnects and the flasher's
 * bootloader reopen, which all come through here. The rule is rts.ts's
 * `openWithRts`, held here as literals because this module imports types
 * only (dependency-cruiser); test/rts.test.ts pins the two equal.
 *
 * The session always writes through `GuardedTransport`, which decides
 * whether a port may be opened (dialect data, the flasher's capability) and
 * validates every write. This transport does not rely on that: it refuses on
 * its own, before the port is opened,
 * - the Arduino Due programming port 2341:003D (any DTR edge resets the
 *   SAM3X; a 1200-baud open erases it) and a half-known or malformed USB
 *   identity, which cannot be checked;
 * - `flowControl` other than `'none'` (`'hardware'` waits on B-FC-1, PN §7.4);
 * - `bufferSize` other than 256 (OLD-TP §4.2: the bound on bytes Web Serial
 *   holds queued);
 * - 1200 baud, always. The guard consumes the flasher's
 *   `BootloaderCapability` and never passes it on, so this transport cannot
 *   tell a flasher's touch from a mistake; a session never needs 1200, and
 *   the flasher's touch (a later phase) will need its own reviewed path.
 *
 * Writing (SAFETY H2b):
 * - there is no `abort()`: aborting a stream writer discards queued bytes
 *   and can cut a line in half. Lint bans the name in this package;
 * - one write at a time: a write while another is in progress is refused,
 *   never queued behind it or merged with it;
 * - each write takes the writer, writes one copy of the bytes, and releases
 *   the writer only after the write settled;
 * - after a failed write nothing that ends a line (LF or CR; TinyG ends a
 *   line on either) is ever written: it would "finish" whatever fragment
 *   reached the controller. Realtime bytes such as `!` still go out.
 *
 * Reading: one reader at a time. A read error (a disconnect, or a framing,
 * parity, overrun or break error, after which bytes are already lost) ends
 * the iteration with that error; the worker then treats the link as gone.
 *
 * Closing waits for the write in progress, closes the writable (which lets
 * queued bytes drain; it is never aborted), cancels the reader and closes
 * the port. It never cuts a line.
 *
 * The port's `getInfo()` is read once, at construction, and recorded
 * (`info()`): the USB identity the open is checked against and the one the
 * session log shows are the same reading.
 *
 * Choosing a port (RUN_PLAN §5.4): `requestPort()` exists only on Window and
 * needs a user gesture, so the window shows the chooser and describes its
 * choice as a `PortSelector` (webSerialChooser.ts). Inside `machine.worker`, `findGrantedPort`
 * finds that same port among the ports this origin was granted, or refuses.
 */
import type { PortSelector, Transport, TransportInfo, TransportOpenOptions, TransportSource } from './transport.ts';

/** The only `bufferSize` this transport opens with (openPolicy.ts TRANSPORT_BUFFER_SIZE). */
export const WEB_SERIAL_BUFFER_SIZE = 256;

/** The SAM-BA touch rate, never opened here (openPolicy.ts BOOTLOADER_TOUCH_BAUD). */
export const WEB_SERIAL_REFUSED_BAUD = 1200;

/** RTS on, nothing else: DTR is never touched (rts.ts RTS_ON; this module imports types only, so it holds the literal). */
export const WEB_SERIAL_RTS_ON: Readonly<{ requestToSend: true }> = Object.freeze({ requestToSend: true });

/** The refusal when RTS cannot be set (rts.ts RTS_REFUSAL, the same words; pinned equal by test/rts.test.ts). */
export const WEB_SERIAL_RTS_REFUSAL = 'Run couldn’t turn on the port’s RTS line, and the board may send nothing without it. Unplug the board, plug it back in, then connect again.';

/** The Arduino Due programming port, never opened (openPolicy.ts DUE_PROGRAMMING_PORT). */
export const WEB_SERIAL_REFUSED_PORT = Object.freeze({ vendorId: 0x2341, productId: 0x003d });

const LF = 0x0a;
const CR = 0x0d;

/** What `SerialPort.getInfo()` returns, as read: nothing is trusted to be a number. */
export interface SerialPortInfoLike {
  readonly usbVendorId?: unknown;
  readonly usbProductId?: unknown;
}

/** The exact options this transport passes to `SerialPort.open`: 8N1, no flow control. */
export interface WebSerialOpenOptions {
  readonly baudRate: number;
  readonly dataBits: 8;
  readonly stopBits: 1;
  readonly parity: 'none';
  readonly flowControl: 'none';
  readonly bufferSize: number;
}

interface SerialReaderLike {
  read(): Promise<{ readonly done: boolean; readonly value?: unknown }>;
  cancel(): Promise<void>;
  releaseLock(): void;
}

interface SerialWriterLike {
  write(chunk: Uint8Array): Promise<void>;
  releaseLock(): void;
}

/**
 * The parts of Web Serial's `SerialPort` this transport uses. Declared here
 * rather than taken from the DOM types, which machine/src does not load.
 */
export interface SerialPortLike {
  open(options: WebSerialOpenOptions): Promise<void>;
  /** Web Serial's output signals; run sets only `requestToSend` (rts.ts), never DTR. */
  setSignals(signals: { readonly requestToSend?: boolean }): Promise<void>;
  close(): Promise<void>;
  readonly readable: { getReader(): SerialReaderLike } | null;
  readonly writable: { readonly locked: boolean; getWriter(): SerialWriterLike; close(): Promise<void> } | null;
  getInfo(): SerialPortInfoLike;
  addEventListener(type: 'disconnect', listener: () => void): void;
}

/** Lists the ports this origin was granted, in grant order (`navigator.serial.getPorts()`). */
export type GrantedPortLister = () => Promise<readonly SerialPortLike[]>;

export type WebSerialRefusalCode =
  | 'refused-port'
  | 'invalid-port-identity'
  | 'capability-required'
  | 'flow-control'
  | 'buffer-size'
  | 'already-opened'
  | 'not-open'
  | 'disconnected'
  | 'invalid-write'
  | 'write-in-progress'
  | 'line-after-write-failure'
  | 'reader-in-use';

/** The transport refused a call. Nothing reached the port. */
export class WebSerialRefusedError extends Error {
  readonly code: WebSerialRefusalCode;

  constructor(code: WebSerialRefusalCode, detail: string) {
    super(`web serial transport refused (${code}): ${detail}`);
    this.name = 'WebSerialRefusedError';
    this.code = code;
  }
}

function isUsbId(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 0xffff;
}

function hex4(n: number): string {
  return n.toString(16).padStart(4, '0');
}

/**
 * One reading of the port's USB identity. A field that is present but not a
 * 16-bit integer is recorded as NaN, never dropped: dropping it would make a
 * malformed identity look like "no USB identity", which the open policy
 * admits. NaN is refused by every check.
 */
function recordInfo(raw: SerialPortInfoLike): { readonly usbVendorId?: number; readonly usbProductId?: number } {
  const field = (v: unknown): number | undefined => (v === undefined ? undefined : isUsbId(v) ? v : Number.NaN);
  const usbVendorId = field(raw.usbVendorId);
  const usbProductId = field(raw.usbProductId);
  return Object.freeze({
    ...(usbVendorId === undefined ? {} : { usbVendorId }),
    ...(usbProductId === undefined ? {} : { usbProductId }),
  });
}

type State = 'new' | 'opening' | 'open' | 'closed';

export class WebSerialTransport implements Transport {
  readonly #port: SerialPortLike;
  readonly #info: TransportInfo;
  #state: State = 'new';
  #opening: Promise<void> | undefined;
  #disconnected = false;
  #writeFailed = false;
  /** True from the moment a write is accepted until it settles. */
  #busy = false;
  /** Settles when the last accepted write settled; never rejects. */
  #writing: Promise<void> = Promise.resolve();
  #reader: SerialReaderLike | undefined;

  constructor(port: SerialPortLike) {
    this.#port = port;
    this.#info = Object.freeze({ kind: 'serial', ...recordInfo(port.getInfo()) });
    port.addEventListener('disconnect', () => {
      this.#disconnected = true;
    });
  }

  /** The port's USB identity as recorded at construction (one `getInfo()` reading), and `kind: 'serial'`. */
  info(): TransportInfo {
    return this.#info;
  }

  async open(options: TransportOpenOptions): Promise<void> {
    if (this.#state !== 'new') throw new WebSerialRefusedError('already-opened', `open() called in state ${this.#state}`);
    // Read each option once, so a getter cannot answer differently to the check and to the port.
    const baudRate = options.baudRate;
    const flowControl = options.flowControl;
    const bufferSize = options.bufferSize;
    this.#checkIdentity();
    if (flowControl !== 'none') {
      throw new WebSerialRefusedError('flow-control', `flowControl ${String(flowControl)} is refused; only 'none'`);
    }
    if (bufferSize !== WEB_SERIAL_BUFFER_SIZE) {
      throw new WebSerialRefusedError('buffer-size', `bufferSize ${String(bufferSize)} is refused; only ${WEB_SERIAL_BUFFER_SIZE}`);
    }
    if (baudRate === WEB_SERIAL_REFUSED_BAUD) {
      throw new WebSerialRefusedError('capability-required', `${WEB_SERIAL_REFUSED_BAUD} baud is never opened by this transport`);
    }
    this.#state = 'opening';
    const serialOptions: WebSerialOpenOptions = Object.freeze({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize });
    // RTS on after the open, or the port is closed and the open refused (OD-33).
    this.#opening = this.#openWithRts(serialOptions);
    try {
      await this.#opening;
    } catch (error) {
      this.#state = 'closed';
      throw error;
    }
    // close() may have run while the port was opening; it wins.
    if (this.#state === 'opening') this.#state = 'open';
  }

  /** rts.ts `openWithRts`, held here as a literal: open, then RTS on; if RTS cannot be set, close and refuse. */
  async #openWithRts(options: WebSerialOpenOptions): Promise<void> {
    await this.#port.open(options);
    try {
      await this.#port.setSignals(WEB_SERIAL_RTS_ON);
    } catch (error) {
      await this.#port.close().catch(() => undefined);
      const refused = new Error(WEB_SERIAL_RTS_REFUSAL, { cause: error });
      refused.name = 'RtsRefusedError';
      throw refused;
    }
  }

  writeLine(line: Uint8Array): Promise<void> {
    if (!(line instanceof Uint8Array) || line.byteLength === 0) {
      return Promise.reject(new WebSerialRefusedError('invalid-write', 'writeLine takes a non-empty Uint8Array'));
    }
    const bytes = new Uint8Array(line);
    if (this.#state !== 'open') return Promise.reject(new WebSerialRefusedError('not-open', `write in state ${this.#state}`));
    if (this.#disconnected) return Promise.reject(new WebSerialRefusedError('disconnected', 'the port was disconnected'));
    if (this.#busy) {
      return Promise.reject(new WebSerialRefusedError('write-in-progress', 'a write is in progress; writes are never queued or merged here'));
    }
    if (this.#writeFailed && (bytes.includes(LF) || bytes.includes(CR))) {
      return Promise.reject(new WebSerialRefusedError('line-after-write-failure', 'a previous write failed; nothing that ends a line may follow it (SAFETY H2b)'));
    }
    // #write clears #busy in its own finally, before its promise settles, so a caller that awaited this
    // write can start the next one at once.
    this.#busy = true;
    const run = this.#write(bytes);
    this.#writing = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  get readable(): AsyncIterable<Uint8Array> {
    return { [Symbol.asyncIterator]: () => this.#read() };
  }

  async close(): Promise<void> {
    const previous = this.#state;
    if (previous === 'closed') return;
    this.#state = 'closed';
    if (previous === 'new') return;
    try {
      await this.#opening;
    } catch {
      // open() reports its own failure; the port never opened, so there is nothing to close.
      return;
    }
    // A write in progress finishes first: a close never cuts a line.
    await this.#writing;
    const writable = this.#port.writable;
    if (writable !== null && !writable.locked) {
      // Closing (never aborting) lets bytes already queued drain to the port.
      await writable.close().catch(() => undefined);
    }
    const reader = this.#reader;
    if (reader !== undefined) {
      this.#reader = undefined;
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    await this.#port.close();
  }

  onDisconnect(callback: () => void): void {
    this.#port.addEventListener('disconnect', () => callback());
  }

  #checkIdentity(): void {
    const { usbVendorId: vid, usbProductId: pid } = this.#info;
    if (vid === undefined && pid === undefined) return;
    if (!isUsbId(vid) || !isUsbId(pid)) {
      throw new WebSerialRefusedError('invalid-port-identity', `USB identity ${String(vid)}:${String(pid)} is not a valid pair`);
    }
    if (vid === WEB_SERIAL_REFUSED_PORT.vendorId && pid === WEB_SERIAL_REFUSED_PORT.productId) {
      throw new WebSerialRefusedError('refused-port', `${hex4(vid)}:${hex4(pid)} (Arduino Due programming port) is never opened`);
    }
  }

  async #write(bytes: Uint8Array): Promise<void> {
    try {
      const writable = this.#port.writable;
      if (writable === null) throw new Error('the port has no writable stream');
      const writer = writable.getWriter();
      try {
        await writer.write(bytes);
      } finally {
        writer.releaseLock();
      }
    } catch (error) {
      this.#writeFailed = true;
      throw error;
    } finally {
      this.#busy = false;
    }
  }

  async *#read(): AsyncGenerator<Uint8Array> {
    if (this.#state !== 'open') return;
    if (this.#reader !== undefined) throw new WebSerialRefusedError('reader-in-use', 'the port is already being read');
    const readable = this.#port.readable;
    if (readable === null) return;
    const reader = readable.getReader();
    this.#reader = reader;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        if (!(value instanceof Uint8Array)) throw new TypeError('the port delivered something other than bytes');
        yield value;
        // close() released this reader while the consumer held the chunk: the link is closed.
        if (this.#reader !== reader) return;
      }
    } finally {
      if (this.#reader === reader) {
        this.#reader = undefined;
        reader.releaseLock();
      }
    }
  }
}

/**
 * Match the complete ordered snapshot and require a unique selected USB
 * identity. This only PREPARES an unopened port: the window must confirm
 * its original grant objects before the host opens this exact port.
 */
export async function findGrantedPort(selector: PortSelector, listPorts: GrantedPortLister = grantedPorts): Promise<SerialPortLike | null> {
  const ports = await listPorts();
  const snapshot = selector.grantSnapshot;
  if (snapshot === undefined || snapshot.length !== ports.length) return null;
  const ids = ports.map((port) => {
    const info = port.getInfo();
    return `${String(info.usbVendorId)}:${String(info.usbProductId)}`;
  });
  const selected = `${selector.usbVendorId}:${selector.usbProductId}`;
  if (ids.some((id, i) => id !== snapshot[i]) || ids.filter((id) => id === selected).length !== 1) return null;
  return ids[selector.grantIndex] === selected ? (ports[selector.grantIndex] as SerialPortLike) : null;
}

interface WebSerial {
  getPorts(): Promise<readonly SerialPortLike[]>;
}

/**
 * `navigator.serial.getPorts()` in this context (machine.worker), or no
 * ports where the API does not exist. Where the Permissions-Policy denies
 * serial (production, `serial=()`), the browser rejects with SecurityError.
 */
function grantedPorts(): Promise<readonly SerialPortLike[]> {
  const serial = (navigator as unknown as { readonly serial?: WebSerial }).serial;
  /* c8 ignore start -- the live API exists only in a browser: the production, staging and bench Playwright suites run this line in machine.worker (tools/e2e/specs/machine-worker.e2e.ts, headers.staging.ts, bench.bench.ts) */
  if (serial !== undefined) return serial.getPorts();
  /* c8 ignore stop */
  return Promise.resolve([]);
}

/**
 * The machine worker's Web Serial transport source (ROADMAP P1-01): each
 * `request` finds the selected granted port and hands back a new, unopened
 * `WebSerialTransport` over it, or null. The worker opens it only through
 * `GuardedTransport`.
 */
export function webSerialTransportSource(listPorts: GrantedPortLister = grantedPorts): TransportSource {
  return Object.freeze({
    kind: 'serial',
    request: async (selector: PortSelector): Promise<Transport | null> => {
      const port = await findGrantedPort(selector, listPorts);
      return port === null ? null : new WebSerialTransport(port);
    },
  });
}
