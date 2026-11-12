/**
 * `BootloaderLink`: the port in bootloader role, for the flasher (SAFETY §4.8
 * as amended 2026-11-03, H83, H84; ROADMAP P0-12, T-S16).
 *
 * After `{"boot":1}` the machine session closes its link (the board is
 * resetting into xboot). The flasher then opens THE SAME port again: the
 * FTDI bridge stays on the bus across the board's reset, so the machine
 * worker asks its transport source for the port the user confirmed at
 * Connect (the same selector, never a new choice). It opens it here, and only
 * here, in bootloader role:
 *
 * - `open` needs the flasher's `BootloaderCapability`, minted only by a
 *   `FlashAuthorization` (packages/flasher authorize.ts). The token is
 *   consumed when presented, valid or not. Everything else the open policy
 *   refuses is refused here too (the Due programming port, other rates,
 *   flow control, buffer size), before the inner port is touched.
 * - Every write is one frame the flasher's `FrameGuard` admits: never `e`
 *   (chip erase), never lock bits or EEPROM writes, never a page at or above
 *   the boot section. A refused frame is never sent.
 * - Writes go one at a time, in order; there is no way to cancel one (no
 *   abort, as everywhere on the machine path). After a failed write nothing
 *   more is written.
 * - Reads are exact byte counts with deadlines (`ByteBuffer`).
 * - Every frame written and every chunk received can be recorded, whole and
 *   timestamped, in an `EventLog` (the bench transcript's `{t, dir, hex}`
 *   format): the flash transcript, the only record of what crossed the link
 *   in bootloader role (the machine transcript ends at `{"boot":1}`).
 *
 * A quarantined port can open in probe-only mode (ESC/S, no capability to flash).
 * A live firmware-ready banner permits a one-way handoff to the normal session.
 * The same reader and open port carry the handoff: the roles never overlap.
 */
import { ByteBuffer, FrameGuard, LinkClosed, consumeBootloaderCapability, type BootloaderCapability, type ByteLink, type FlasherClock, type Part } from '@synthetos/flasher';
import { classifyLine, type Banner } from '@synthetos/protocol';
import type { EventLog } from './eventLog.ts';
import { TRANSPORT_BUFFER_SIZE, decideOpen } from './openPolicy.ts';
import type { Transport, TransportOpenOptions } from './transport.ts';

/** The options the bootloader-role open uses: xboot's 115200 8N1, no flow control, the one buffer size. */
export function bootloaderOpenOptions(part: Part): TransportOpenOptions {
  return Object.freeze({ baudRate: part.baudRate, flowControl: 'none', bufferSize: TRANSPORT_BUFFER_SIZE });
}

export class BootloaderLinkError extends Error {
  override readonly name = 'BootloaderLinkError';
}

/** One entry of the flash transcript (frames out, bytes in), for the user's report. */
export interface FlashWireEvent {
  readonly t: number;
  readonly dir: 'tx' | 'rx';
  readonly bytes: number;
  /** The command byte of a frame sent, or the first bytes received (at most 8), as hex. */
  readonly head: string;
}

export class BootloaderLink implements ByteLink {
  readonly #inner: Transport;
  readonly #clock: FlasherClock;
  readonly #guard: FrameGuard;
  readonly #part: Part;
  readonly #buffer: ByteBuffer;
  readonly #log: EventLog | null;
  #state: 'new' | 'open' | 'closed' = 'new';
  #writeFailed = false;
  #probeOnly = false;
  #bannerArmed = false;
  #banner: Banner | null = null;
  #bannerLine = '';
  readonly #bannerSignal: ByteBuffer;
  #handed = false;
  #appChunks: Uint8Array[] = [];
  #appBytes = 0;
  #wakeApp: (() => void) | null = null;
  #disconnect: (() => void) | null = null;
  #tail: Promise<void> = Promise.resolve();
  /** A short transcript (bounded). */
  readonly wire: FlashWireEvent[] = [];

  /** `log`, when given, records every frame written and every chunk received, whole (the flash transcript). */
  constructor(inner: Transport, clock: FlasherClock, part: Part, log: EventLog | null = null) {
    this.#inner = inner;
    this.#log = log;
    this.#clock = clock;
    this.#part = part;
    this.#guard = new FrameGuard(part);
    this.#buffer = new ByteBuffer(clock);
    this.#bannerSignal = new ByteBuffer(clock);
    inner.onDisconnect(() => this.#end('the USB link dropped'));
  }

  get closed(): boolean {
    return this.#state === 'closed' || this.#buffer.ended;
  }

  /** Open in bootloader role. The capability is consumed whatever happens. */
  async open(capability: BootloaderCapability | undefined): Promise<void> {
    const valid = capability !== undefined && consumeBootloaderCapability(capability);
    if (this.#state !== 'new') throw new BootloaderLinkError('this link was already opened');
    if (!valid) throw new BootloaderLinkError('the bootloader capability is missing, forged or already used: only the flasher, after its checks, opens a port in bootloader role');
    await this.#open();
  }

  /** Read-only recovery check: only ESC and S, never exit, erase, addresses or data. */
  async openProbe(): Promise<void> {
    if (this.#state !== 'new') throw new BootloaderLinkError('this link was already opened');
    this.#probeOnly = true;
    this.armFirmwareBanner();
    await this.#open();
  }

  async #open(): Promise<void> {
    const options = bootloaderOpenOptions(this.#part);
    const decision = decideOpen(this.#inner.info(), options, true, 'bootloader');
    if (!decision.ok) throw new BootloaderLinkError(`open refused (${decision.reason}): ${decision.detail}`);
    this.#state = 'open';
    try {
      await this.#inner.open(options);
    } catch (error) {
      this.#state = 'closed';
      throw error;
    }
    void this.#read();
  }

  write(frame: Uint8Array): Promise<void> {
    if (!(frame instanceof Uint8Array)) return Promise.reject(new BootloaderLinkError('a frame is a Uint8Array'));
    const bytes = new Uint8Array(frame);
    if (this.#handed || this.#banner !== null) return Promise.reject(new BootloaderLinkError('firmware has started; bootloader writes are forbidden'));
    if (this.#probeOnly && !(bytes.length === 1 && (bytes[0] === 0x1b || bytes[0] === 0x53))) return Promise.reject(new BootloaderLinkError('probe permits only ESC and S'));
    if (this.#state !== 'open' || this.closed) return Promise.reject(new LinkClosed('the bootloader link is closed (or not open yet)'));
    if (this.#writeFailed) return Promise.reject(new LinkClosed('a previous write failed; nothing more is written'));
    const verdict = this.#guard.check(bytes);
    if (!verdict.ok) return Promise.reject(new BootloaderLinkError(`frame refused (${verdict.reason}): ${verdict.detail}`));
    const run = this.#tail.then(async () => {
      if (this.closed || this.#writeFailed || this.#banner !== null || this.#handed) throw new LinkClosed('the bootloader link closed before the frame was sent');
      this.#record('tx', bytes);
      try {
        await this.#inner.writeLine(bytes);
      } catch (error) {
        this.#writeFailed = true;
        throw new LinkClosed(`the write failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Arm immediately before verified exit; an earlier banner is not evidence for this boot. */
  armFirmwareBanner(): void {
    this.#bannerArmed = true;
    this.#banner = null;
    this.#bannerLine = '';
    this.#bannerSignal.discard();
    this.#appChunks = [];
    this.#appBytes = 0;
  }

  get firmwareBanner(): Banner | null { return this.#banner; }

  async waitForFirmwareBanner(timeoutMs: number): Promise<boolean> {
    if (this.#banner !== null) return !this.closed;
    try { await this.#bannerSignal.read(1, timeoutMs); } catch { return false; }
    return this.#banner !== null && !this.closed;
  }

  /** Hand the already-open port to the normal session, only after its live ready banner (including the 440 verbosity-filtered form). No close/reopen gap. */
  applicationTransport(): Transport {
    if (this.#banner === null || this.closed || this.#handed) throw new BootloaderLinkError('no fresh firmware banner for handoff');
    this.#handed = true;
    let opened = false;
    return {
      info: () => this.#inner.info(),
      open: async options => {
        if (opened || this.closed || options.baudRate !== this.#part.baudRate || options.flowControl !== 'none' || options.bufferSize !== TRANSPORT_BUFFER_SIZE) throw new BootloaderLinkError('invalid application handoff');
        opened = true;
      },
      writeLine: async bytes => {
        if (!opened || this.closed || this.#writeFailed) throw new LinkClosed('application link is closed');
        try { await this.#inner.writeLine(bytes); } catch (error) { this.#writeFailed = true; throw error; }
      },
      readable: { [Symbol.asyncIterator]: () => ({ next: async (): Promise<IteratorResult<Uint8Array>> => {
        while (!this.closed) {
          const chunk = this.#appChunks.shift();
          if (chunk !== undefined) { this.#appBytes -= chunk.length; return { done: false, value: chunk }; }
          await new Promise<void>(resolve => { this.#wakeApp = resolve; });
        }
        return { done: true, value: undefined };
      } }) },
      close: () => this.close(),
      onDisconnect: callback => { this.#disconnect = callback; },
    };
  }

  #applicationBytes(bytes: Uint8Array): void {
    this.#appBytes += bytes.length;
    if (this.#appBytes > 65536) { this.#end('application handoff buffer overflow'); return; }
    if (bytes.length > 0) this.#appChunks.push(bytes.slice());
    this.#wakeApp?.();
    this.#wakeApp = null;
  }

  #observeBanner(chunk: Uint8Array): void {
    if (!this.#bannerArmed) return;
    if (this.#banner !== null) { this.#applicationBytes(chunk); return; }
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i];
      if (byte === 10 || byte === 13) {
        const line = this.#bannerLine.slice(this.#bannerLine.indexOf('{'));
        this.#bannerLine = '';
        const frame = classifyLine(line);
        if (frame.kind === 'Banner' && frame.ready !== false && frame.fb !== undefined && frame.fv !== undefined) {
          this.#banner = frame;
          this.#applicationBytes(new TextEncoder().encode(line + '\n'));
          this.#applicationBytes(chunk.slice(i + 1));
          this.#bannerSignal.push(Uint8Array.of(1));
          return;
        }
      } else {
        this.#bannerLine += String.fromCharCode(byte as number);
        if (this.#bannerLine.length > 2048) this.#bannerLine = '';
      }
    }
  }

  read(n: number, timeoutMs: number): Promise<Uint8Array> {
    return this.#buffer.read(n, timeoutMs);
  }

  discardInput(): void {
    this.#buffer.discard();
  }

  /** Close the port. A write in progress finishes first. */
  async close(): Promise<void> {
    if (this.#state === 'closed') return;
    const wasOpen = this.#state === 'open';
    this.#state = 'closed';
    this.#end('the bootloader link was closed');
    if (!wasOpen) return;
    await this.#tail;
    await this.#inner.close().catch(() => undefined);
  }

  #end(why: string): void {
    this.#buffer.end(new LinkClosed(why));
    this.#bannerSignal.end(new LinkClosed(why));
    this.#wakeApp?.();
    this.#wakeApp = null;
    this.#disconnect?.();
  }

  #record(dir: 'tx' | 'rx', bytes: Uint8Array): void {
    if (dir === 'tx') this.#log?.tx(this.#clock.now(), bytes);
    else this.#log?.rx(this.#clock.now(), bytes);
    if (this.wire.length >= 20_000) this.wire.splice(0, 1000);
    const head = [...bytes.subarray(0, dir === 'tx' ? 1 : 8)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    this.wire.push({ t: this.#clock.now(), dir, bytes: bytes.length, head });
  }

  async #read(): Promise<void> {
    try {
      for await (const chunk of this.#inner.readable) {
        if (this.#state === 'closed') break;
        this.#record('rx', chunk);
        this.#observeBanner(chunk);
        if (!this.#handed) this.#buffer.push(chunk);
      }
    } catch {
      // A disconnect errors the stream.
    }
    this.#end('the USB link dropped');
  }
}
