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
 * - **Replies in step.** AVR109 has no framing; a reply belongs to its
 *   command only by byte count. After the entry the line is drained until
 *   quiet (replies to earlier ESC/`S` tries); before every command it must
 *   hold nothing (quiet.ts); every reply is read at its exact length and
 *   checked. A byte nobody asked for, or a wrong acknowledgement, is a
 *   `desync`: a hard stop, and after any failed reply nothing is sent but a
 *   new entry (`resync`).
 */
import { REPLY, encodeCommand, replyLength, type Command } from './avr109.ts';
import type { ByteLink, FlasherClock } from '../../core/link.ts';
import { XbootError, hex, toXbootError } from './errors.ts';
import type { Part } from './part.ts';
import { assertQuiet, drainUntilQuiet } from './quiet.ts';

export { XbootError, toXbootError } from './errors.ts';
export type { XbootErrorCode } from './errors.ts';

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
  /** After the entry: silence that ends the drain of late replies (quiet.ts). */
  readonly quietMs: number;
  /** After the entry: the drain gives up (desync) when the line is still busy after this long. */
  readonly quietMaxMs: number;
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
  quietMs: 150,
  quietMaxMs: 450,
});

export interface Identity {
  readonly programId: string;
  readonly version: string;
  readonly signature: string;
  readonly blockSize: number;
}

const ascii = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

export function sleep(clock: FlasherClock, ms: number): Promise<void> {
  return new Promise((resolve) => clock.setTimeout(resolve, ms));
}

export class XbootClient {
  readonly #link: ByteLink;
  readonly #clock: FlasherClock;
  readonly #part: Part;
  readonly #t: ClientTimings;
  #busy = false;
  /** A reply failed or came out of step: nothing is sent until a new entry succeeds. */
  #unsynced = false;
  #entering = false;
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

  /**
   * Send one command and read its whole reply, at its exact length. Exactly one command is in flight at any
   * time; the line must hold nothing before it is sent (quiet.ts). After any failure, only a new entry may talk.
   */
  async command(command: Command, timeoutMs: number): Promise<Uint8Array> {
    if (this.#busy) throw new XbootError('unexpected', 'one command at a time');
    if (this.#unsynced && !this.#entering) throw new XbootError('desync', 'a reply failed or came out of step: nothing is sent before a new bootloader entry');
    this.#busy = true;
    try {
      const frame = encodeCommand(command);
      assertQuiet(this.#link, `\`${String.fromCharCode(frame[0] as number)}\``);
      await this.#link.write(frame);
      this.sent++;
      return await this.#link.read(replyLength(command), timeoutMs);
    } catch (error) {
      const e = toXbootError(error);
      if (e.code !== 'unexpected') this.#unsynced = true;
      throw e;
    } finally {
      this.#busy = false;
    }
  }

  async #expectAck(command: Command, timeoutMs: number, what: string): Promise<void> {
    const reply = await this.command(command, timeoutMs);
    if (reply[0] === REPLY.ack) return;
    this.#unsynced = true;
    if (reply[0] === REPLY.error) throw new XbootError('refused', `xboot refused ${what}`);
    throw new XbootError('desync', `xboot answered ${what} with 0x${hex(reply)}, not an acknowledgement: the replies are out of step, so nothing more is sent`);
  }

  /**
   * Enter the bootloader from its entry window: ESC, then `S`, until it
   * answers `XBoot++` or `deadlineMs` passes. Stale bytes (the end of the
   * firmware's last reply, a banner) are discarded before each try; after
   * the entry, late replies to earlier tries are drained until the line is
   * quiet (quiet.ts).
   */
  async enter(deadlineMs: number): Promise<number> {
    const start = this.#clock.now();
    let tries = 0;
    let entered = false;
    this.#unsynced = true;
    this.#entering = true;
    try {
      while (!entered && this.#clock.now() - start < deadlineMs) {
        if (this.#link.closed) throw new XbootError('closed', 'the link closed during bootloader entry');
        tries++;
        this.#link.discardInput();
        try {
          await this.#link.write(encodeCommand({ op: 'sync' }));
          entered = ascii(await this.command({ op: 'programId' }, this.#t.entryReplyMs)) === this.#part.programId;
        } catch (error) {
          if (toXbootError(error).code === 'closed') throw toXbootError(error);
        }
        if (!entered) await sleep(this.#clock, this.#t.entryIntervalMs);
      }
    } finally {
      this.#entering = false;
    }
    if (!entered) throw new XbootError('no-entry', `the bootloader did not answer within ${Math.round(deadlineMs / 1000)} s`);
    await drainUntilQuiet(this.#link, this.#clock, this.#t.quietMs, this.#t.quietMaxMs);
    this.#unsynced = false;
    return tries;
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
    if (r[0] === REPLY.yes) return;
    this.#unsynced = true;
    throw new XbootError('desync', `the keep-alive was answered with 0x${hex(r)}, not Y: the replies are out of step, so nothing more is sent`);
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
