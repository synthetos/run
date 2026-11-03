/**
 * The flash gate's last step: decide whether THIS image may be flashed to
 * THIS board, and only then hand out the `BootloaderCapability` that lets the
 * machine package open the port in bootloader role (SAFETY §4.8 as amended
 * 2026-11-03, H79, H85, H86, H87; ROADMAP P0-12).
 *
 * The capability is minted here and nowhere else (the mint stays
 * flasher-internal: bootloaderCapability.ts is importable by flasher source
 * only). A `FlashAuthorization` mints one single-use token per port open,
 * at most `MAX_OPENS` in its life (a recovery reopens the port after the
 * user replugs it), and none after `finish()`.
 *
 * Checks, all of which must pass:
 * - the `.hex` text's SHA-256 is the one the caller named, and, for a
 *   signed release, the one and the size the verified release list names;
 * - it parses as a strict Intel HEX application image for the part
 *   (ihex.ts: application section only, never the boot section, a reset
 *   vector, no install marker);
 * - a signed release is for this board's hardware version (`hv`) and part,
 *   and an image for the simulated board is refused on a real port;
 * - a firmware image backup is this board's own (its board id);
 * - custom (unsigned) firmware was confirmed explicitly by the user;
 * - the settings backup was saved first (or the board's firmware cannot be
 *   read token by token, which the caller states, and the raw EEPROM read in
 *   the bootloader is then the only settings copy).
 */
import type { FirmwareRelease } from '@synthetos/protocol';
import { mintBootloaderCapability, type BootloaderCapability } from './bootloaderCapability.ts';
import { parseIntelHex, type HexImage } from './ihex.ts';
import type { Part } from './part.ts';
import { isSha256, sha256Hex } from './sha256.ts';

/** Port opens one authorization may cover (the first open plus recovery reopens). */
export const MAX_OPENS = 32;

export type FlashSource =
  /** A release from the signed list (the list verified by the caller, in the machine worker). */
  | { readonly kind: 'release'; readonly release: FirmwareRelease }
  /** A firmware image backup read from this board earlier ("Put this firmware back"). */
  | { readonly kind: 'backup'; readonly boardId: string; readonly fb: number | null }
  /** The user's own image: unsigned custom firmware, confirmed explicitly. */
  | { readonly kind: 'custom'; readonly confirmed: boolean; readonly name: string };

export interface BoardFacts {
  /** The board's id as the session read it (null when it could not be read). */
  readonly id: string | null;
  /** Hardware version (`hv`). */
  readonly hv: number | null;
  readonly fb: number | null;
}

export interface FlashCheck {
  readonly source: FlashSource;
  readonly hexText: string;
  /** The SHA-256 the caller says the text has (re-computed here). */
  readonly sha256: string;
  readonly board: BoardFacts;
  readonly part: Part;
  /** `saved`: the token-by-token settings backup was stored first. `unreadable`: this firmware cannot be read that way. */
  readonly settingsBackup: 'saved' | 'unreadable' | 'missing';
  /** True only when the port is the test kit's simulated board (the worker's transport source is `fake`). */
  readonly simulatedPort: boolean;
}

export type FlashRefusal =
  | 'hash-mismatch'
  | 'size-mismatch'
  | 'bad-image'
  | 'wrong-hardware'
  | 'wrong-part'
  | 'simulator-image'
  | 'not-this-board'
  | 'not-confirmed'
  | 'no-settings-backup';

export type Authorized =
  | { readonly ok: true; readonly authorization: FlashAuthorization }
  | { readonly ok: false; readonly code: FlashRefusal; readonly message: string };

export class FlashAuthorization {
  readonly image: HexImage;
  readonly sha256: string;
  readonly source: FlashSource;
  readonly board: BoardFacts;
  #opens = 0;
  #finished = false;

  /** Only `authorizeFlash` constructs one (the constructor is not exported from the package entry's types). */
  constructor(token: typeof CONSTRUCT, image: HexImage, sha256: string, source: FlashSource, board: BoardFacts) {
    if (token !== CONSTRUCT) throw new Error('FlashAuthorization is created by authorizeFlash only');
    this.image = image;
    this.sha256 = sha256;
    this.source = source;
    this.board = board;
  }

  /** A fresh single-use token for one port open, or null once finished or after `MAX_OPENS`. */
  capability(): BootloaderCapability | null {
    if (this.#finished || this.#opens >= MAX_OPENS) return null;
    this.#opens++;
    return mintBootloaderCapability();
  }

  /** No more tokens, ever. */
  finish(): void {
    this.#finished = true;
  }

  get finished(): boolean {
    return this.#finished;
  }

  get opens(): number {
    return this.#opens;
  }
}

const CONSTRUCT: unique symbol = Symbol('FlashAuthorization');

function refuse(code: FlashRefusal, message: string): Authorized {
  return { ok: false, code, message };
}

export async function authorizeFlash(check: FlashCheck): Promise<Authorized> {
  const { source, hexText, board, part } = check;
  if (check.settingsBackup === 'missing') return refuse('no-settings-backup', 'Back up the settings first: nothing is flashed without a settings backup.');
  if (typeof hexText !== 'string') return refuse('bad-image', 'The image is not text.');
  const actual = await sha256Hex(hexText);
  if (!isSha256(check.sha256) || actual !== check.sha256) return refuse('hash-mismatch', 'The image is not the file that was checked: its SHA-256 differs.');
  const byteLength = new TextEncoder().encode(hexText).length;
  switch (source.kind) {
    case 'release': {
      const r = source.release;
      if (r.sha256 !== actual) return refuse('hash-mismatch', `The file's SHA-256 is not the one the signed release list names for ${r.file}. It may be damaged or altered; nothing was flashed.`);
      if (r.size !== byteLength) return refuse('size-mismatch', `The file is ${byteLength} bytes, not the ${r.size} the signed release list names.`);
      if (r.part !== part.name) return refuse('wrong-part', `This release is for the ${r.part}, not the ${part.name}.`);
      if (board.hv === null || r.hv !== board.hv) return refuse('wrong-hardware', `This release is for hardware version ${r.hv}; the board reports ${board.hv === null ? 'no hardware version' : String(board.hv)}.`);
      if (r.simulatorOnly && !check.simulatedPort) return refuse('simulator-image', 'This image is for the simulated test board only and is never flashed to a real board.');
      break;
    }
    case 'backup':
      if (board.id === null || source.boardId !== board.id) return refuse('not-this-board', 'This firmware backup was read from another board. A backup is only put back on the board it came from.');
      break;
    case 'custom':
      if (source.confirmed !== true) return refuse('not-confirmed', 'Unsigned custom firmware needs your explicit confirmation.');
      break;
  }
  const parsed = parseIntelHex(hexText, part);
  if (!parsed.ok) return refuse('bad-image', `The image was refused: ${parsed.error.message}${parsed.error.line === undefined ? '' : ` (line ${parsed.error.line})`}`);
  return { ok: true, authorization: new FlashAuthorization(CONSTRUCT, parsed.image, actual, source, board) };
}
