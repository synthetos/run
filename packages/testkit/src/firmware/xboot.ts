/**
 * DEV ONLY. A model of TinyG's xboot bootloader, from its source (XB
 * synthetos/tg-xboot @ 29d08013: src/xboot.c, src/uart.c, src/protocol.h,
 * conf/x192a3.mk). It owns the board's flash and EEPROM while the board is
 * in the bootloader; the flashable board (flashableBoard.ts) owns it the rest
 * of the time.
 *
 * Modelled from the source:
 * - XB-ENTRY: the entry window polls the UART and enters only on ESC; any
 *   other byte is read and ignored. 4.8 s after a power-on or a reset
 *   (12 blinks × 2 × 200 ms), 60 s after a software reset ({"boot":1}, the
 *   reset flag RST_SRF; 150 blinks) (src/xboot.c:236-286, conf/x192a3.mk).
 * - XB-EXIT: when the window ends without ESC, or on `E`, xboot runs
 *   install_firmware() and jumps to address 0 (src/xboot.c:540-545, :700-790).
 * - XB-RX: received bytes go to a two-byte buffer; a third byte before the
 *   main loop reads overwrites the second (src/uart.c:39-61). The model's
 *   main loop reads at once unless the board is busy (programming a page,
 *   sending a reply, computing a CRC).
 * - XB-WDT: the watchdog (WDT_PER_1KCLK, about 1 s) runs from the end of the
 *   window and is reset after each byte the main loop reads and at the start
 *   of a block load (src/xboot.c:329-345, :1140-1143); when it fires the chip
 *   resets (no software-reset flag: the 4.8 s window).
 * - Commands (src/xboot.c:346-772): `a` Y; `A`/`H` set the address (`\r`); `e`
 *   erases the application section AND all EEPROM (`\r`); `b` Y + 0x0200;
 *   `B` size mem data: reads min(size, 512) bytes, then EEPROM block write,
 *   or flash: erase-write of the page at address×2, address += size/2, `\r`;
 *   another memory `?`; `g` size mem: EEPROM (address += size) or flash
 *   (address += size/2) bytes, nothing at all for another memory; `R`, `c`,
 *   `C`, `m` (refused `?` at or above the boot section), `D`, `d`, `l`, `r`,
 *   `F`, `N`, `Q`, `P`, `L`, `E`, `p` `S`, `t` 123 0, `x`/`y`/`T` + 1 byte, `S`
 *   `XBoot++`, `V` `17`, `s` 44 97 1E, `h` + section: CRC-16 or `?`; ESC no
 *   reply; anything else `?`.
 * - XB-NOPROTECT: code, EEPROM and bootloader protection are off
 *   (conf/x192a3.mk), so flash and EEPROM read back as stored.
 *
 * Model limits: SPM timing is a configurable busy time, not measured; a flash
 * block load at an address in the boot section changes nothing (the NVM
 * controller's application-page command cannot write the boot section) and
 * still answers `\r`; reading more than a page overruns xboot's buffer, which
 * the model treats as a watchdog reset.
 *
 * Fault injection (tests): drop a received byte, drop a sent byte, swallow a
 * command (a timeout), report another signature, corrupt or refuse a page
 * write. `eraseCount` and `lockWrites` record anything run must never send.
 */
import '../marker.ts';
import { simCrc16 } from './simFirmware.ts';

export const XB_PAGE = 512;
export const XB_APP_BYTES = 0x30000;
export const XB_BOOT_BYTES = 0x2000;
export const XB_EEPROM_BYTES = 0x800;
export const XB_SIGNATURE = Object.freeze([0x44, 0x97, 0x1e]);

const ESC = 0x1b;
const ACK = 0x0d;
const YES = 0x59;
const ERR = 0x3f;

export interface XbootTimings {
  /** Entry window after a power-on or reset (ms). Default 4800. */
  readonly windowMs: number;
  /** Entry window after a software reset ({"boot":1}) (ms). Default 60000. */
  readonly windowSwResetMs: number;
  /** Watchdog period (ms). Default 1000 (WDT_PER_1KCLK). */
  readonly watchdogMs: number;
  /** Busy time of one page erase-write (ms; model value). Default 6. */
  readonly pageWriteMs: number;
  /** Busy time of the application CRC (ms; model value). Default 40. */
  readonly crcMs: number;
}

export const XBOOT_TIMINGS: XbootTimings = Object.freeze({ windowMs: 4800, windowSwResetMs: 60000, watchdogMs: 1000, pageWriteMs: 6, crcMs: 40 });

export interface XbootFaults {
  /** Drop the Nth byte the bootloader receives in command mode (1-based), once each. */
  dropRx?: number[];
  /** Drop the Nth byte the bootloader sends (1-based), once each. */
  dropTx?: number[];
  /** Swallow the next command with this opcode (no reply), this many times. */
  swallow?: { readonly opcode: number; count: number };
  /** Report this signature instead of the x192a3's. */
  signature?: readonly [number, number, number];
  /** Corrupt the next N flash page writes at this byte address (a byte is flipped in flash). */
  corruptPage?: { readonly byteAddress: number; count: number };
  /** Answer `?` to block loads, starting at the Nth one (1-based). */
  refuseBlockLoadFrom?: number;
}

export interface XbootHost {
  readonly now: () => number;
  readonly setTimeout: (fn: () => void, ms: number) => number;
  readonly clearTimeout: (id: number) => void;
  readonly transmit: (bytes: Uint8Array) => void;
  readonly event: (note: string) => void;
  /** Milliseconds one byte takes on the wire (the reply's own transmit time keeps xboot busy). */
  readonly byteMs: () => number;
  /** Leave the bootloader: jump to address 0 (the board decides what runs there). */
  readonly jumpToApplication: () => void;
}

type Pending = { readonly op: number; readonly need: number; readonly bytes: number[] };

export class XbootModel {
  readonly flash: Uint8Array;
  readonly eeprom: Uint8Array;
  faults: XbootFaults;
  readonly timings: XbootTimings;
  /** Times `e` was received (run must never send it). */
  eraseCount = 0;
  /** Lock-bit writes received (run must never send one). */
  lockWrites = 0;
  /** Every command byte the main loop parsed, in order (tests). */
  readonly commands: number[] = [];
  /** Pages programmed (byte addresses), in order. */
  readonly pageWrites: number[] = [];
  #host: XbootHost | null = null;
  #mode: 'off' | 'window' | 'command' = 'off';
  #address = 0;
  #pending: Pending | null = null;
  #rx: number[] = [];
  #busyUntil = 0;
  #windowTimer: number | null = null;
  #wdtTimer: number | null = null;
  #busyTimer: number | null = null;
  #rxCount = 0;
  #txCount = 0;
  #blockLoads = 0;
  #pageBuffer = new Uint8Array(XB_PAGE).fill(0xff);
  #byteWord = 0;

  constructor(flash: Uint8Array, eeprom: Uint8Array, timings: Partial<XbootTimings> = {}, faults: XbootFaults = {}) {
    this.flash = flash;
    this.eeprom = eeprom;
    this.timings = Object.freeze({ ...XBOOT_TIMINGS, ...timings });
    this.faults = faults;
  }

  get mode(): 'off' | 'window' | 'command' {
    return this.#mode;
  }

  get address(): number {
    return this.#address;
  }

  /** The chip resets into the bootloader. `softwareReset`: the application asked ({"boot":1}). */
  start(host: XbootHost, softwareReset: boolean): void {
    this.stop();
    this.#host = host;
    this.#mode = 'window';
    this.#pending = null;
    this.#rx = [];
    this.#address = 0;
    this.#busyUntil = 0;
    const ms = softwareReset ? this.timings.windowSwResetMs : this.timings.windowMs;
    host.event(`xboot: entry window ${ms} ms (${softwareReset ? 'software reset' : 'reset'})`);
    this.#windowTimer = host.setTimeout(() => {
      this.#windowTimer = null;
      if (this.#mode !== 'window') return;
      host.event('xboot: no ESC in the window: jump to the application');
      this.#exit();
    }, ms);
  }

  /** Power off or the board left the bootloader: every timer stops. */
  stop(): void {
    const h = this.#host;
    if (h !== null) {
      if (this.#windowTimer !== null) h.clearTimeout(this.#windowTimer);
      if (this.#wdtTimer !== null) h.clearTimeout(this.#wdtTimer);
      if (this.#busyTimer !== null) h.clearTimeout(this.#busyTimer);
    }
    this.#windowTimer = null;
    this.#wdtTimer = null;
    this.#busyTimer = null;
    this.#mode = 'off';
  }

  /** One byte reaches the UART. */
  receive(byte: number): void {
    const h = this.#host;
    if (h === null || this.#mode === 'off') return;
    if (this.#mode === 'window') {
      // XB-ENTRY: only ESC enters; anything else is read and ignored (src/xboot.c:280-286).
      if (byte !== ESC) return;
      if (this.#windowTimer !== null) h.clearTimeout(this.#windowTimer);
      this.#windowTimer = null;
      this.#mode = 'command';
      h.event('xboot: ESC received: in the bootloader');
      this.#kickWatchdog();
      return;
    }
    this.#rxCount++;
    if (this.faults.dropRx?.includes(this.#rxCount) === true) {
      this.faults.dropRx = this.faults.dropRx.filter((n) => n !== this.#rxCount);
      h.event(`xboot fault: received byte ${this.#rxCount} dropped`);
      return;
    }
    // XB-RX: a two-byte buffer; a third byte overwrites the second.
    if (this.#rx.length < 2) this.#rx.push(byte);
    else this.#rx[1] = byte;
    this.#pump();
  }

  #now(): number {
    return (this.#host as XbootHost).now();
  }

  #kickWatchdog(): void {
    const h = this.#host as XbootHost;
    if (this.#wdtTimer !== null) h.clearTimeout(this.#wdtTimer);
    this.#wdtTimer = h.setTimeout(() => {
      this.#wdtTimer = null;
      if (this.#mode !== 'command') return;
      // XB-WDT: the chip resets; the reset flag is not the software one, so the short window follows.
      h.event('xboot: watchdog reset');
      this.start(h, false);
    }, this.timings.watchdogMs);
  }

  #busy(ms: number): void {
    this.#busyUntil = Math.max(this.#busyUntil, this.#now()) + ms;
  }

  #pump(): void {
    const h = this.#host as XbootHost;
    if (this.#mode !== 'command') return;
    const wait = this.#busyUntil - this.#now();
    if (wait > 0) {
      if (this.#busyTimer === null) {
        this.#busyTimer = h.setTimeout(() => {
          this.#busyTimer = null;
          this.#pump();
        }, wait);
      }
      return;
    }
    while (this.#rx.length > 0 && this.#mode === 'command' && this.#busyUntil <= this.#now()) {
      const byte = this.#rx.shift() as number;
      this.#kickWatchdog();
      this.#consume(byte);
    }
    if (this.#rx.length > 0 && this.#mode === 'command') this.#pump();
  }

  #send(bytes: readonly number[]): void {
    const h = this.#host as XbootHost;
    const out: number[] = [];
    for (const b of bytes) {
      this.#txCount++;
      if (this.faults.dropTx?.includes(this.#txCount) === true) {
        this.faults.dropTx = this.faults.dropTx.filter((n) => n !== this.#txCount);
        h.event(`xboot fault: sent byte ${this.#txCount} dropped`);
        continue;
      }
      out.push(b & 0xff);
    }
    // A reply goes out when the work before it (page programming, the CRC) is done, and the main loop sits in
    // send_char() while the bytes go out (interrupt-driven, one in flight).
    const start = Math.max(this.#now(), this.#busyUntil);
    this.#busyUntil = start + bytes.length * h.byteMs();
    if (out.length === 0) return;
    const payload = Uint8Array.from(out);
    const delay = start - this.#now();
    if (delay <= 0) h.transmit(payload);
    else h.setTimeout(() => h.transmit(payload), delay);
  }

  #consume(byte: number): void {
    const p = this.#pending;
    if (p !== null) {
      p.bytes.push(byte);
      if (p.bytes.length < p.need) return;
      this.#pending = null;
      this.#finish(p);
      return;
    }
    this.commands.push(byte);
    const swallow = this.faults.swallow;
    if (swallow !== undefined && swallow.count > 0 && swallow.opcode === byte) {
      swallow.count--;
      (this.#host as XbootHost).event(`xboot fault: command 0x${byte.toString(16)} swallowed`);
      // Its parameters are swallowed too.
      const need = { 0x48: 3, 0x41: 2, 0x42: 3, 0x67: 3, 0x68: 1 }[byte] ?? 0;
      if (need > 0) this.#pending = { op: -1, need, bytes: [] };
      return;
    }
    switch (byte) {
      case 0x61: // a
        this.#send([YES]);
        return;
      case 0x41: // A
        this.#pending = { op: byte, need: 2, bytes: [] };
        return;
      case 0x48: // H
        this.#pending = { op: byte, need: 3, bytes: [] };
        return;
      case 0x65: // e: erase the application section and ALL EEPROM (src/xboot.c:373-400)
        this.eraseCount++;
        this.flash.fill(0xff, 0, XB_APP_BYTES);
        this.eeprom.fill(0xff);
        (this.#host as XbootHost).event('xboot: CHIP ERASE (application and EEPROM)');
        this.#busy(50);
        this.#send([ACK]);
        return;
      case 0x62: // b
        this.#send([YES, (XB_PAGE >> 8) & 0xff, XB_PAGE & 0xff]);
        return;
      case 0x42: // B size(2) mem
      case 0x67: // g size(2) mem
        this.#pending = { op: byte, need: 3, bytes: [] };
        return;
      case 0x52: {
        // R: read a program word, high byte first
        const at = (this.#address << 1) % (XB_APP_BYTES + XB_BOOT_BYTES);
        this.#send([this.flash[at + 1] ?? 0xff, this.flash[at] ?? 0xff]);
        this.#address++;
        return;
      }
      case 0x63: // c low byte
      case 0x43: // C high byte
      case 0x44: // D EEPROM byte
      case 0x6c: // l lock bits
      case 0x78: // x
      case 0x79: // y
      case 0x54: // T
        this.#pending = { op: byte, need: 1, bytes: [] };
        return;
      case 0x6d: {
        // m: write the page buffer; refused at or above the boot section (src/xboot.c:464-475)
        if (this.#address >= XB_APP_BYTES >> 1) {
          this.#send([ERR]);
          return;
        }
        this.#program((this.#address << 1) & ~(XB_PAGE - 1), this.#pageBuffer);
        this.#send([ACK]);
        return;
      }
      case 0x64: // d: read an EEPROM byte
        this.#send([this.eeprom[this.#address % XB_EEPROM_BYTES] as number]);
        this.#address++;
        return;
      case 0x72: // r: lock bits
        this.#send([0xff]);
        return;
      case 0x46: // F
      case 0x4e: // N
      case 0x51: // Q
        this.#send([0xff]);
        return;
      case 0x50: // P
      case 0x4c: // L
        this.#send([ACK]);
        return;
      case 0x45: // E: exit
        this.#send([ACK]);
        this.#leaveAfterSend();
        return;
      case 0x70: // p
        this.#send([0x53]);
        return;
      case 0x74: // t
        this.#send([123, 0]);
        return;
      case 0x53: // S
        this.#send([...'XBoot++'].map((ch) => ch.charCodeAt(0)));
        return;
      case 0x56: // V
        this.#send([0x31, 0x37]);
        return;
      case 0x73: // s
        this.#send([...(this.faults.signature ?? XB_SIGNATURE)]);
        return;
      case 0x68: // h section
        this.#pending = { op: byte, need: 1, bytes: [] };
        return;
      case ESC:
        return;
      default:
        this.#send([ERR]);
    }
  }

  #finish(p: Pending): void {
    const [b0 = 0, b1 = 0, b2 = 0] = p.bytes;
    switch (p.op) {
      case -1: // a swallowed command's parameters (fault injection)
        return;
      case 0x41:
        this.#address = (b0 << 8) | b1;
        this.#send([ACK]);
        return;
      case 0x48:
        this.#address = (b0 << 16) | (b1 << 8) | b2;
        this.#send([ACK]);
        return;
      case 0x42: {
        const size = (b0 << 8) | b1;
        if (p.bytes.length === 3) {
          // XB-RX in a block load: the loop reads min(size, 512) data bytes, fast enough to keep up.
          this.#kickWatchdog();
          const n = Math.min(size, XB_PAGE);
          if (n > 0) {
            this.#pending = { op: 0x142, need: 3 + n, bytes: [b0, b1, b2] };
            return;
          }
          this.#blockLoad(size, b2, []);
          return;
        }
        return;
      }
      case 0x142: {
        const [h0 = 0, h1 = 0, mem = 0, ...data] = p.bytes;
        this.#blockLoad((h0 << 8) | h1, mem, data);
        return;
      }
      case 0x67:
        this.#blockRead((b0 << 8) | b1, b2);
        return;
      case 0x63:
        this.#byteWord = b0;
        this.#send([ACK]);
        return;
      case 0x43: {
        const word = this.#byteWord | (b0 << 8);
        const at = (this.#address << 1) % XB_PAGE;
        this.#pageBuffer[at] = word & 0xff;
        this.#pageBuffer[at + 1] = word >> 8;
        this.#address++;
        this.#send([ACK]);
        return;
      }
      case 0x44:
        this.eeprom[this.#address % XB_EEPROM_BYTES] = b0;
        this.#address++;
        this.#send([ACK]);
        return;
      case 0x6c:
        this.lockWrites++;
        (this.#host as XbootHost).event('xboot: LOCK BITS written');
        this.#send([ACK]);
        return;
      case 0x78:
      case 0x79:
      case 0x54:
        this.#send([ACK]);
        return;
      case 0x68: {
        const section = { 0x46: [0, XB_APP_BYTES + XB_BOOT_BYTES], 0x41: [0, XB_APP_BYTES], 0x42: [XB_APP_BYTES, XB_APP_BYTES + XB_BOOT_BYTES], 0x61: [0, XB_APP_BYTES / 2], 0x74: [XB_APP_BYTES / 2, XB_APP_BYTES] }[b0];
        if (section === undefined) {
          this.#send([ERR]);
          return;
        }
        this.#busy(this.timings.crcMs);
        const crc = simCrc16(this.flash, section[0], section[1]);
        this.#send([crc >> 8, crc & 0xff]);
        return;
      }
    }
  }

  #blockLoad(size: number, mem: number, data: readonly number[]): void {
    const buffer = new Uint8Array(XB_PAGE).fill(0xff);
    buffer.set(data.slice(0, XB_PAGE));
    this.#blockLoads++;
    if (this.faults.refuseBlockLoadFrom !== undefined && this.#blockLoads >= this.faults.refuseBlockLoadFrom) {
      this.#send([ERR]);
      return;
    }
    if (mem === 0x45) {
      // EEPROM block write (src/xboot.c:1155-1161).
      for (let i = 0; i < size; i++) this.eeprom[(this.#address + i) % XB_EEPROM_BYTES] = buffer[i] as number;
      this.#address += size;
      this.#send([ACK]);
      return;
    }
    if (mem === 0x46 || mem === 0x55) {
      const byteAddress = this.#address << 1;
      this.#address += size >> 1;
      if (mem === 0x46) this.#program(byteAddress & ~(XB_PAGE - 1), buffer);
      this.#send([ACK]);
      return;
    }
    this.#send([ERR]);
  }

  #program(page: number, buffer: Uint8Array): void {
    const h = this.#host as XbootHost;
    this.#busy(this.timings.pageWriteMs);
    // Model limit: the application-page command cannot write the boot section.
    if (page >= XB_APP_BYTES) {
      h.event(`xboot: page write at 0x${page.toString(16)} (boot section) has no effect`);
      return;
    }
    this.flash.set(buffer, page);
    this.pageWrites.push(page);
    const c = this.faults.corruptPage;
    if (c !== undefined && c.count > 0 && c.byteAddress === page) {
      c.count--;
      this.flash[page + 17] = (this.flash[page + 17] as number) ^ 0x40;
      h.event(`xboot fault: page 0x${page.toString(16)} written with a flipped bit`);
    }
  }

  #blockRead(size: number, mem: number): void {
    if (size > XB_PAGE) {
      // The read overruns xboot's page buffer: undefined; the model resets the chip.
      (this.#host as XbootHost).event('xboot: block read larger than the page buffer: the board resets');
      this.start(this.#host as XbootHost, false);
      return;
    }
    if (mem === 0x45) {
      const out: number[] = [];
      for (let i = 0; i < size; i++) out.push(this.eeprom[(this.#address + i) % XB_EEPROM_BYTES] as number);
      this.#address += size;
      this.#send(out);
      return;
    }
    if (mem === 0x46 || mem === 0x55 || mem === 0x50) {
      const start = this.#address << 1;
      const out: number[] = [];
      for (let i = 0; i < size; i++) out.push(mem === 0x46 ? (this.flash[start + i] ?? 0xff) : 0xff);
      this.#address = (start + size) >> 1;
      this.#send(out);
      return;
    }
    // A bad memory type sends nothing at all (src/xboot.c:1236-1240).
  }

  #leaveAfterSend(): void {
    const h = this.#host as XbootHost;
    const wait = Math.max(0, this.#busyUntil - this.#now());
    this.#mode = 'off';
    if (this.#wdtTimer !== null) h.clearTimeout(this.#wdtTimer);
    this.#wdtTimer = null;
    h.setTimeout(() => this.#exit(), wait + 1);
  }

  #exit(): void {
    const h = this.#host as XbootHost;
    this.stop();
    h.jumpToApplication();
  }
}
