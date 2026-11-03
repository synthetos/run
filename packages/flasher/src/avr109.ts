/**
 * The AVR109 commands run sends to xboot, and the guard that checks every
 * frame before it reaches the port (SAFETY §4.8 guard filter, H83, H84).
 *
 * The command set is CLOSED. `Command` names every frame the client can
 * build, and `encodeCommand` is the only function that turns one into
 * bytes. There is no variant for chip erase (`e`): xboot's `e` erases the
 * whole application section AND all of EEPROM, every setting
 * (XB src/xboot.c:373-400), so it is unrepresentable here, not merely
 * unused. Nothing else that writes outside a flash page is representable
 * either: no lock bits (`l`), no EEPROM writes (`D`, `B ... E`), no user
 * signature row (`B ... U`), no byte-wise flash writes (`c`, `C`, `m`).
 *
 * `FrameGuard` is the second, independent check. The bootloader link in the
 * machine package runs every outgoing write through it, so even a bug that
 * built bytes by hand could not send `e`:
 * - a write is exactly one frame of an allowed command, nothing before or
 *   after it;
 * - `B` (block load) is flash only (`F`), exactly one page, and only at a
 *   page-aligned address the guard saw set with `H`, below the boot section;
 * - `g` (block read) is flash or EEPROM, at most one page;
 * - `h` (CRC) is the application section only.
 * The guard tracks xboot's address register the way xboot does: `H` sets it
 * (a word address for flash, a byte address for EEPROM, XB src/xboot.c:362-371),
 * a flash block advances it by half the block size (words), an EEPROM block
 * by the block size (XB src/xboot.c:1157-1170, :1205-1240).
 *
 * xboot replies (XB src/protocol.h:104-108): `\r` acknowledges, `Y` answers
 * yes, `?` refuses. ESC (0x1B) is the sync byte and gets no reply
 * (XB src/xboot.c:767-772).
 */
import type { Part } from './part.ts';

/** Every opcode run may send, and nothing else. */
export const OPCODES = Object.freeze({
  /** ESC: enters the bootloader from the entry window; a no-op afterwards (no reply). */
  sync: 0x1b,
  /** `S`: program id, 7 bytes `XBoot++`. */
  programId: 0x53,
  /** `V`: version, 2 bytes. */
  version: 0x56,
  /** `s`: signature, 3 bytes, last byte first. */
  signature: 0x73,
  /** `a`: auto-increment supported? `Y`. Also the keep-alive while nothing else is due. */
  autoIncrement: 0x61,
  /** `b`: block support, `Y` then the block size high, low. */
  blockSupport: 0x62,
  /** `H` + 3 bytes: set the extended address (high byte first). */
  setAddress: 0x48,
  /** `B` + size (2) + memory: block load. Flash only. */
  blockLoad: 0x42,
  /** `g` + size (2) + memory: block read. */
  blockRead: 0x67,
  /** `h` + section: CRC-16 of a section, 2 bytes high first. */
  crc: 0x68,
  /** `E`: leave the bootloader and start the application; `\r`. */
  exit: 0x45,
} as const);

export type Opcode = (typeof OPCODES)[keyof typeof OPCODES];

/** The bytes run never sends as a command. `e` above all. */
export const FORBIDDEN_OPCODES: readonly number[] = Object.freeze([
  0x65, // e: chip erase (application AND all EEPROM)
  0x6c, // l: write lock bits
  0x44, // D: write an EEPROM byte
  0x63, // c: write a flash low byte
  0x43, // C: write a flash high byte
  0x6d, // m: write a flash page from the byte buffer
  0x41, // A: 16-bit address (run always uses H)
]);

export const REPLY = Object.freeze({ ack: 0x0d, yes: 0x59, error: 0x3f } as const);

/** Memory type letters for block access (XB src/protocol.h:91-95). */
export const MEMORY = Object.freeze({ flash: 0x46, eeprom: 0x45 } as const);

/** Section letter for the CRC: the application section (XB src/protocol.h:97-102). */
export const SECTION_APPLICATION = 0x41;

/** Every frame the client can build. There is no erase. */
export type Command =
  | { readonly op: 'sync' }
  | { readonly op: 'programId' }
  | { readonly op: 'version' }
  | { readonly op: 'signature' }
  | { readonly op: 'autoIncrement' }
  | { readonly op: 'blockSupport' }
  | { readonly op: 'setAddress'; readonly value: number }
  | { readonly op: 'writeFlashBlock'; readonly data: Uint8Array }
  | { readonly op: 'readBlock'; readonly memory: 'flash' | 'eeprom'; readonly size: number }
  | { readonly op: 'crcApplication' }
  | { readonly op: 'exit' };

export type CommandOp = Command['op'];

/** Bytes xboot sends back for each command, and their meaning. */
export function replyLength(command: Command): number {
  switch (command.op) {
    case 'sync':
      return 0;
    case 'programId':
      return 7;
    case 'version':
      return 2;
    case 'signature':
      return 3;
    case 'autoIncrement':
      return 1;
    case 'blockSupport':
      return 3;
    case 'setAddress':
      return 1;
    case 'writeFlashBlock':
      return 1;
    case 'readBlock':
      return command.size;
    case 'crcApplication':
      return 2;
    case 'exit':
      return 1;
    default:
      throw new CommandError(`no such command: ${String((command as { op?: unknown }).op)}`);
  }
}

export class CommandError extends Error {
  override readonly name = 'CommandError';
}

/** The one place a `Command` becomes bytes. Throws for a malformed command (never sends a guess). */
export function encodeCommand(command: Command): Uint8Array {
  switch (command.op) {
    case 'sync':
      return Uint8Array.of(OPCODES.sync);
    case 'programId':
      return Uint8Array.of(OPCODES.programId);
    case 'version':
      return Uint8Array.of(OPCODES.version);
    case 'signature':
      return Uint8Array.of(OPCODES.signature);
    case 'autoIncrement':
      return Uint8Array.of(OPCODES.autoIncrement);
    case 'blockSupport':
      return Uint8Array.of(OPCODES.blockSupport);
    case 'setAddress': {
      const v = command.value;
      if (!Number.isInteger(v) || v < 0 || v > 0xffffff) throw new CommandError(`address ${String(v)} is not a 24-bit value`);
      return Uint8Array.of(OPCODES.setAddress, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
    }
    case 'writeFlashBlock': {
      const n = command.data.length;
      if (n === 0 || n > 0xffff) throw new CommandError(`block of ${n} bytes`);
      const out = new Uint8Array(4 + n);
      out.set([OPCODES.blockLoad, (n >> 8) & 0xff, n & 0xff, MEMORY.flash], 0);
      out.set(command.data, 4);
      return out;
    }
    case 'readBlock': {
      const n = command.size;
      if (!Number.isInteger(n) || n <= 0 || n > 0xffff) throw new CommandError(`read of ${String(n)} bytes`);
      return Uint8Array.of(OPCODES.blockRead, (n >> 8) & 0xff, n & 0xff, command.memory === 'flash' ? MEMORY.flash : MEMORY.eeprom);
    }
    case 'crcApplication':
      return Uint8Array.of(OPCODES.crc, SECTION_APPLICATION);
    case 'exit':
      return Uint8Array.of(OPCODES.exit);
    default:
      // Unreachable for a typed Command; anything else (an erase smuggled in as an object) is refused.
      throw new CommandError(`no such command: ${String((command as { op?: unknown }).op)}`);
  }
}

export type FrameRefusal =
  | 'empty'
  | 'forbidden-opcode'
  | 'unknown-opcode'
  | 'bad-length'
  | 'bad-memory'
  | 'bad-section'
  | 'block-size'
  | 'no-address'
  | 'unaligned'
  | 'boot-section';

export type FrameVerdict = { readonly ok: true; readonly op: CommandOp } | { readonly ok: false; readonly reason: FrameRefusal; readonly detail: string };

function refuse(reason: FrameRefusal, detail: string): FrameVerdict {
  return { ok: false, reason, detail };
}

/**
 * Checks each outgoing write as exactly one allowed frame, tracking xboot's
 * address register. A refused frame changes nothing; the link sends nothing.
 */
export class FrameGuard {
  readonly #part: Part;
  /** xboot's address register as far as the guard knows; null until an `H` was seen (or after an exit). */
  #address: number | null = null;

  constructor(part: Part) {
    this.#part = part;
  }

  /** The address register the guard tracks (tests). */
  get address(): number | null {
    return this.#address;
  }

  /** Forget the address: the bootloader restarted (a resync after a watchdog reset, a recovery). */
  reset(): void {
    this.#address = null;
  }

  check(frame: Uint8Array): FrameVerdict {
    const verdict = this.#judge(frame);
    if (verdict.ok) this.#advance(frame, verdict.op);
    return verdict;
  }

  #judge(frame: Uint8Array): FrameVerdict {
    if (frame.length === 0) return refuse('empty', 'an empty write');
    const op = frame[0] as number;
    if (FORBIDDEN_OPCODES.includes(op)) return refuse('forbidden-opcode', `opcode 0x${op.toString(16)} (${String.fromCharCode(op)}) is never sent`);
    const single: readonly [number, CommandOp][] = [
      [OPCODES.sync, 'sync'],
      [OPCODES.programId, 'programId'],
      [OPCODES.version, 'version'],
      [OPCODES.signature, 'signature'],
      [OPCODES.autoIncrement, 'autoIncrement'],
      [OPCODES.blockSupport, 'blockSupport'],
      [OPCODES.exit, 'exit'],
    ];
    const one = single.find(([code]) => code === op);
    if (one !== undefined) return frame.length === 1 ? { ok: true, op: one[1] } : refuse('bad-length', `${one[1]} is one byte, got ${frame.length}`);
    const part = this.#part;
    switch (op) {
      case OPCODES.setAddress:
        return frame.length === 4 ? { ok: true, op: 'setAddress' } : refuse('bad-length', `H takes 3 address bytes, got ${frame.length - 1}`);
      case OPCODES.crc:
        if (frame.length !== 2) return refuse('bad-length', `h takes one section byte, got ${frame.length - 1}`);
        return frame[1] === SECTION_APPLICATION ? { ok: true, op: 'crcApplication' } : refuse('bad-section', 'only the application section CRC is asked for');
      case OPCODES.blockRead: {
        if (frame.length !== 4) return refuse('bad-length', `g takes size and memory (3 bytes), got ${frame.length - 1}`);
        const size = ((frame[1] as number) << 8) | (frame[2] as number);
        if (frame[3] !== MEMORY.flash && frame[3] !== MEMORY.eeprom) return refuse('bad-memory', 'block reads are of flash or EEPROM only');
        // xboot reads into its page buffer: a larger block would overrun it (XB src/xboot.c:1200-1240, buffer[SPM_PAGESIZE]).
        if (size === 0 || size > part.pageBytes || size % 2 !== 0) return refuse('block-size', `block read of ${size} bytes`);
        if (this.#address === null) return refuse('no-address', 'a block read before any address was set');
        return { ok: true, op: 'readBlock' };
      }
      case OPCODES.blockLoad: {
        if (frame.length < 4) return refuse('bad-length', 'a block load without its header');
        const size = ((frame[1] as number) << 8) | (frame[2] as number);
        if (frame[3] !== MEMORY.flash) return refuse('bad-memory', 'block loads are flash pages only: run never writes EEPROM, user signature or lock bits');
        if (size !== part.pageBytes) return refuse('block-size', `a block load of ${size} bytes; run writes whole ${part.pageBytes}-byte pages`);
        if (frame.length !== 4 + size) return refuse('bad-length', `the block carries ${frame.length - 4} bytes, not ${size}`);
        if (this.#address === null) return refuse('no-address', 'a block load before any address was set');
        const byte = this.#address * 2;
        if (byte % part.pageBytes !== 0) return refuse('unaligned', `a page write at 0x${byte.toString(16)}, not page-aligned`);
        if (byte + size > part.bootStart) return refuse('boot-section', `a page write at 0x${byte.toString(16)} would reach the bootloader section`);
        return { ok: true, op: 'writeFlashBlock' };
      }
      default:
        return refuse('unknown-opcode', `opcode 0x${op.toString(16)} is not one run sends`);
    }
  }

  #advance(frame: Uint8Array, op: CommandOp): void {
    switch (op) {
      case 'setAddress':
        this.#address = ((frame[1] as number) << 16) | ((frame[2] as number) << 8) | (frame[3] as number);
        return;
      case 'writeFlashBlock':
        this.#address = (this.#address as number) + (frame.length - 4) / 2;
        return;
      case 'readBlock': {
        const size = ((frame[1] as number) << 8) | (frame[2] as number);
        this.#address = (this.#address as number) + (frame[3] === MEMORY.flash ? size / 2 : size);
        return;
      }
      case 'exit':
        this.#address = null;
        return;
      default:
        return;
    }
  }
}
