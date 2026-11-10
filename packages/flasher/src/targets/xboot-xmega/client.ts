/**
 * The xboot client: AVR109 block mode over a `ByteLink`, modelled on xboot's
 * own source (XB tg-xboot @ 29d08013, src/xboot.c) and on the firmware
 * maintainer's probe (XB scripts/avr109_probe.py).
 *
 * What xboot does, and what the client therefore does:
 * - **Entry.** After `{"boot":1}` the board resets into xboot, which blinks
 *   for 60 s waiting for ESC; after a reset or power cycle it waits about
 *   4.8 s (conf/x192a3.mk ENTER_BLINK_COUNT*, XB src/xboot.c:236-246). It
 *   enters only on ESC (ENTER_UART_NEED_SYNC, XB src/xboot.c:280-286); any
 *   other byte in the window is read and ignored. So the client sends ESC,
 *   then `S`, until `XBoot++` comes back (`enter`).
 * - **One command at a time.** xboot's receive buffer holds two bytes
 *   (XB src/uart.c:39-61) and page programming takes milliseconds, so a byte
 *   sent before the previous reply would be lost or overwrite the second
 *   buffered byte. Every command waits for its whole reply.
 * - **Addresses.** `H` sets xboot's single address register: a word address
 *   for flash (byte / 2), a byte address for EEPROM (XB src/xboot.c:362-371,
 *   :1157-1170, :1205-1210). The client sets it before every block, so no
 *   result depends on auto-increment.
 * - **Blocks.** At most one page (512 bytes, from `b`): xboot reads blocks
 *   into its page buffer (XB src/xboot.c:1136-1150, :1200-1240). A flash
 *   block load erases and writes the page at the address
 *   (ENABLE_FLASH_ERASE_WRITE) and answers `\r`; an unknown memory type
 *   answers `?`.
 * - **Watchdog.** xboot runs its watchdog (WDT_PER_1KCLK, about 1 s) while
 *   waiting for a byte and resets the board when it fires
 *   (XB src/xboot.c:329-345; OLD-S §4.8 step 11). The client therefore never
 *   leaves the link quiet for long: `keepAlive` sends `a` every 250 ms while
 *   the page saves the backups. After a lost reply the board is either stuck
 *   inside a command or about to reset; `resync` waits past the watchdog and
 *   enters again through the 4.8 s window. UNVERIFIED on hardware (B-FL-WDT):
 *   the timings are xboot's configured values, not measurements.
 * - **Never `e`.** The client has no erase (avr109.ts).
 */
import { CommandError, REPLY, encodeCommand, replyLength, type Command } from './avr109.ts';
import { LinkClosed, LinkTimeout, type ByteLink, type FlasherClock } from '../../core/link.ts';
import type { Part } from './part.ts';

export interface ClientTimings {
  /** Reply deadline for a short command. */
  readonly replyMs: number;
  /** Reply deadline for a page read (512 bytes is about 45 ms at 115200 baud). */
  readonly blockReadMs: number;
  /** Reply deadline for a page write (transfer, erase, write). */
  readonly blockWriteMs: number;
  /** Reply deadline for the application CRC (xboot reads all 192 KB). */
  readonly crcMs: number;
  /** How long `S` may take to answer during entry. */
  readonly entryReplyMs: number;
  /** Pause between ESCs during entry. */
  readonly entryIntervalMs: number;
  /** How long a resync waits for the watchdog to reset a stuck board. */
  readonly watchdogMs: number;
  /** Keep-alive period while waiting on the page. */
  readonly keepAliveMs: number;
}

export const DEFAULT_TIMINGS: ClientTimings = Object.freeze({
  replyMs: 500,
  blockReadMs: 1500,
  blockWriteMs: 1500,
  crcMs: 3000,
  entryReplyMs: 150,
  entryIntervalMs: 50,
  watchdogMs: 1300,
  keepAliveMs: 250,
});

export type XbootErrorCode = 'refused' | 'unexpected' | 'wrong-part' | 'wrong-bootloader' | 'block-size' | 'no-entry' | 'timeout' | 'closed';

export class XbootError extends Error {
  override readonly name = 'XbootError';
  readonly code: XbootErrorCode;
  constructor(code: XbootErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface Identity {
  readonly programId: string;
  readonly version: string;
  readonly signature: string;
  readonly blockSize: number;
}

const ascii = (bytes: Uint8Array): string => String.fromCharCode(...bytes);
const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');

export function sleep(clock: FlasherClock, ms: number): Promise<void> {
  return new Promise((resolve) => clock.setTimeout(resolve, ms));
}

export class XbootClient {
  readonly #link: ByteLink;
  readonly #clock: FlasherClock;
  readonly #part: Part;
  readonly #t: ClientTimings;
  #busy = false;
  /** Commands sent (tests and the transcript). */
  sent = 0;

  constructor(link: ByteLink, clock: FlasherClock, part: Part, timings: Partial<ClientTimings> = {}) {
    this.#link = link;
    this.#clock = clock;
    this.#part = part;
    this.#t = Object.freeze({ ...DEFAULT_TIMINGS, ...timings });
  }

  get timings(): ClientTimings {
    return this.#t;
  }

  get part(): Part {
    return this.#part;
  }

  /** Send one command and read its whole reply. Exactly one command is in flight at any time. */
  async command(command: Command, timeoutMs: number): Promise<Uint8Array> {
    if (this.#busy) throw new XbootError('unexpected', 'one command at a time');
    this.#busy = true;
    try {
      const frame = encodeCommand(command);
      await this.#link.write(frame);
      this.sent++;
      return await this.#link.read(replyLength(command), timeoutMs);
    } catch (error) {
      throw toXbootError(error);
    } finally {
      this.#busy = false;
    }
  }

  async #expectAck(command: Command, timeoutMs: number, what: string): Promise<void> {
    const reply = await this.command(command, timeoutMs);
    if (reply[0] === REPLY.ack) return;
    if (reply[0] === REPLY.error) throw new XbootError('refused', `xboot refused ${what}`);
    throw new XbootError('unexpected', `xboot answered ${what} with 0x${hex(reply)}`);
  }

  /**
   * Enter the bootloader from its entry window: ESC, then `S`, until it
   * answers `XBoot++` or `deadlineMs` passes. Stale bytes (the end of the
   * firmware's last reply, a banner) are discarded before each try.
   */
  async enter(deadlineMs: number): Promise<number> {
    const start = this.#clock.now();
    let tries = 0;
    while (this.#clock.now() - start < deadlineMs) {
      if (this.#link.closed) throw new XbootError('closed', 'the link closed during bootloader entry');
      tries++;
      this.#link.discardInput();
      try {
        await this.#link.write(encodeCommand({ op: 'sync' }));
        const id = await this.command({ op: 'programId' }, this.#t.entryReplyMs);
        if (ascii(id) === this.#part.programId) return tries;
      } catch (error) {
        const e = toXbootError(error);
        if (e.code === 'closed') throw e;
      }
      await sleep(this.#clock, this.#t.entryIntervalMs);
    }
    throw new XbootError('no-entry', `the bootloader did not answer within ${Math.round(deadlineMs / 1000)} s`);
  }

  /** `S`, `V`, `s`, `b`, `a`: who answers, and is it the part and bootloader this image is for? */
  async identify(): Promise<Identity> {
    const programId = ascii(await this.command({ op: 'programId' }, this.#t.replyMs));
    if (programId !== this.#part.programId) throw new XbootError('wrong-bootloader', `the bootloader says "${programId}", not ${this.#part.programId}`);
    const version = ascii(await this.command({ op: 'version' }, this.#t.replyMs));
    const sig = await this.command({ op: 'signature' }, this.#t.replyMs);
    const want = this.#part.signatureReply;
    if (sig[0] !== want[0] || sig[1] !== want[1] || sig[2] !== want[2]) {
      throw new XbootError('wrong-part', `the chip signature is ${hex(Uint8Array.of(sig[2] as number, sig[1] as number, sig[0] as number))}, not ${this.#part.signature} (${this.#part.name})`);
    }
    const block = await this.command({ op: 'blockSupport' }, this.#t.replyMs);
    const blockSize = ((block[1] as number) << 8) | (block[2] as number);
    if (block[0] !== REPLY.yes || blockSize !== this.#part.pageBytes) throw new XbootError('block-size', `the bootloader's block size is ${blockSize}, not ${this.#part.pageBytes}`);
    const auto = await this.command({ op: 'autoIncrement' }, this.#t.replyMs);
    if (auto[0] !== REPLY.yes) throw new XbootError('unexpected', 'the bootloader does not auto-increment');
    return Object.freeze({ programId, version, signature: this.#part.signature, blockSize });
  }

  /** `H` with a flash byte address (sent as a word address). */
  async setFlashAddress(byteAddress: number): Promise<void> {
    if (byteAddress % 2 !== 0) throw new XbootError('unexpected', 'flash addresses are word aligned');
    await this.#expectAck({ op: 'setAddress', value: byteAddress / 2 }, this.#t.replyMs, 'the address');
  }

  /** `H` with an EEPROM byte address. */
  async setEepromAddress(byteAddress: number): Promise<void> {
    await this.#expectAck({ op: 'setAddress', value: byteAddress }, this.#t.replyMs, 'the address');
  }

  /** Read `length` bytes of flash from `byteAddress`, a page at a time. */
  async readFlash(byteAddress: number, length: number, onPage?: (done: number) => void): Promise<Uint8Array> {
    const out = new Uint8Array(length);
    const page = this.#part.pageBytes;
    for (let at = 0; at < length; at += page) {
      const size = Math.min(page, length - at);
      await this.setFlashAddress(byteAddress + at);
      out.set(await this.command({ op: 'readBlock', memory: 'flash', size }, this.#t.blockReadMs), at);
      onPage?.(at + size);
    }
    return out;
  }

  /** Read `length` bytes of EEPROM from `byteAddress`, a page-sized block at a time. */
  async readEeprom(byteAddress: number, length: number): Promise<Uint8Array> {
    const out = new Uint8Array(length);
    const page = this.#part.pageBytes;
    for (let at = 0; at < length; at += page) {
      const size = Math.min(page, length - at);
      await this.setEepromAddress(byteAddress + at);
      out.set(await this.command({ op: 'readBlock', memory: 'eeprom', size }, this.#t.blockReadMs), at);
    }
    return out;
  }

  /** Erase-write one page: `H`, then `B` with the page's bytes; xboot answers `\r`. */
  async writePage(byteAddress: number, data: Uint8Array): Promise<void> {
    const page = this.#part.pageBytes;
    if (data.length !== page || byteAddress % page !== 0) throw new XbootError('unexpected', 'pages are written whole and aligned');
    if (byteAddress + page > this.#part.bootStart) throw new XbootError('unexpected', 'never at or above the bootloader section');
    await this.setFlashAddress(byteAddress);
    await this.#expectAck({ op: 'writeFlashBlock', data }, this.#t.blockWriteMs, `the page at 0x${byteAddress.toString(16)}`);
  }

  /** `h` `A`: xboot's CRC-16 of the whole application section. */
  async crcApplication(): Promise<number> {
    const r = await this.command({ op: 'crcApplication' }, this.#t.crcMs);
    return ((r[0] as number) << 8) | (r[1] as number);
  }

  /** `E`: leave the bootloader; the board starts the application. */
  async exit(): Promise<void> {
    await this.#expectAck({ op: 'exit' }, this.#t.replyMs, 'the exit');
  }

  /** One keep-alive (`a`, answered `Y`). */
  async ping(): Promise<void> {
    const r = await this.command({ op: 'autoIncrement' }, this.#t.replyMs);
    if (r[0] !== REPLY.yes) throw new XbootError('unexpected', `the keep-alive was answered with 0x${hex(r)}`);
  }

  /**
   * Keep the bootloader awake until `until` settles: one `a` every
   * `keepAliveMs`. Resolves or rejects with `until`; a failed ping rejects.
   */
  async keepAlive<T>(until: Promise<T>): Promise<T> {
    let settled = false;
    let result: { ok: true; value: T } | { ok: false; error: unknown } | null = null;
    void until.then(
      (value) => {
        settled = true;
        result = { ok: true, value };
      },
      (error: unknown) => {
        settled = true;
        result = { ok: false, error };
      },
    );
    while (!settled) {
      await this.ping();
      if (settled) break;
      await sleep(this.#clock, this.#t.keepAliveMs);
    }
    const r = result as unknown as { ok: true; value: T } | { ok: false; error: unknown };
    if (r.ok) return r.value;
    throw r.error;
  }

  /**
   * After a lost or damaged reply: wait past the watchdog (a board stuck in
   * a command resets; an idle one resets too), then enter again through the
   * entry window. Throws `no-entry` when the bootloader does not come back.
   */
  async resync(windowMs = 4000): Promise<void> {
    await sleep(this.#clock, this.#t.watchdogMs);
    await this.enter(windowMs);
  }
}

/** Link and command failures as `XbootError`. */
export function toXbootError(error: unknown): XbootError {
  if (error instanceof XbootError) return error;
  if (error instanceof LinkTimeout) return new XbootError('timeout', error.message);
  if (error instanceof LinkClosed) return new XbootError('closed', error.message);
  if (error instanceof CommandError) return new XbootError('unexpected', error.message);
  return new XbootError('closed', error instanceof Error ? error.message : String(error));
}
