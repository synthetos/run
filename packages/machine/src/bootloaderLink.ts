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
 * The machine session never sees this link, and this link never carries a
 * machine-session line: the two roles of the port are never open at once.
 */
import { ByteBuffer, FrameGuard, LinkClosed, consumeBootloaderCapability, type BootloaderCapability, type ByteLink, type FlasherClock, type Part } from '@synthetos/flasher';
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
    if (this.#state !== 'open' || this.closed) return Promise.reject(new LinkClosed('the bootloader link is closed (or not open yet)'));
    if (this.#writeFailed) return Promise.reject(new LinkClosed('a previous write failed; nothing more is written'));
    const verdict = this.#guard.check(bytes);
    if (!verdict.ok) return Promise.reject(new BootloaderLinkError(`frame refused (${verdict.reason}): ${verdict.detail}`));
    const run = this.#tail.then(async () => {
      if (this.closed || this.#writeFailed) throw new LinkClosed('the bootloader link closed before the frame was sent');
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
    this.#buffer.end(new LinkClosed('the bootloader link was closed'));
    if (!wasOpen) return;
    await this.#tail;
    await this.#inner.close().catch(() => undefined);
  }

  #end(why: string): void {
    this.#buffer.end(new LinkClosed(why));
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
        this.#buffer.push(chunk);
      }
    } catch {
      // A disconnect errors the stream.
    }
    this.#end('the USB link dropped');
  }
}
