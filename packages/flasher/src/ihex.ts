/**
 * Intel HEX parser and validator for firmware images (SAFETY §4.8 "image
 * checks", H79, H84; OLD-S §4.8 step 5).
 *
 * Strict by design: anything this reader does not fully understand refuses
 * the whole image, and nothing is flashed from a partial parse.
 *
 * - Every line is one record: `:`, then an even number of hex digits. Line
 *   ends may be LF or CRLF; blank lines are allowed only after the end
 *   record. Any other character refuses the file (an HTML page saved as
 *   `.hex`, a corrupted download).
 * - Record types 00 (data), 01 (end of file), 02 (extended segment address)
 *   and 04 (extended linear address). Types 03 and 05 (start addresses) are
 *   read and ignored: an AVR starts at its reset vector. Any other type
 *   refuses the file.
 * - The byte count must match the record, and the checksum (two's
 *   complement of the sum of every byte) must be right on every record.
 * - Exactly one end record, last.
 * - No byte is given twice (an overlap is refused even with equal values).
 * - **Every byte lies in the application section** (below 0x30000 on the
 *   x192a3). An image that touches the boot section, where xboot lives, is
 *   refused outright: a bootloader image, or an application built for another
 *   part, never reaches the board (H84).
 * - The image has a reset vector: bytes at address 0 holding a `jmp`
 *   (0x940C..0x940D with its high address bits) or an `rjmp`. Without one the
 *   board would run erased flash.
 * - It does not carry xboot's install marker (`XBIF` in the last page of the
 *   staging half, part.ts), so leaving the bootloader never installs
 *   something else.
 *
 * The parse is pure and never throws for any input.
 */
import { appPages, type Part } from './part.ts';

/** The largest text accepted (a full 192 KB image is about 540 KB of HEX). */
export const MAX_HEX_TEXT_BYTES = 2 * 1024 * 1024;

export type HexErrorCode =
  | 'too-large'
  | 'empty'
  | 'bad-character'
  | 'bad-record'
  | 'bad-length'
  | 'bad-checksum'
  | 'unknown-record-type'
  | 'bad-address-record'
  | 'missing-end'
  | 'data-after-end'
  | 'address-wrap'
  | 'overlap'
  | 'boot-section'
  | 'out-of-range'
  | 'no-data'
  | 'no-reset-vector'
  | 'install-marker';

export interface HexError {
  readonly code: HexErrorCode;
  /** 1-based line, when the problem is on one line. */
  readonly line?: number;
  readonly message: string;
}

export interface HexImage {
  readonly part: Part;
  /** The whole application section, 0xFF where the file gives no byte (erased flash). */
  readonly bytes: Uint8Array;
  /** One flag per page: true when the file gave at least one byte in that page. */
  readonly usedPages: readonly boolean[];
  /** Number of bytes the file gave. */
  readonly dataBytes: number;
  /** One past the highest address the file gave. */
  readonly end: number;
}

export type HexParse = { readonly ok: true; readonly image: HexImage } | { readonly ok: false; readonly error: HexError };

function fail(code: HexErrorCode, message: string, line?: number): HexParse {
  return { ok: false, error: Object.freeze({ code, message, ...(line === undefined ? {} : { line }) }) };
}

const RECORD = /^:([0-9A-Fa-f]{2})+$/;

/** True when the 16-bit word at 0 is a `jmp` (1001 010k kkkk 110k) or an `rjmp` (1100 kkkk kkkk kkkk). */
export function isResetVector(lo: number, hi: number): boolean {
  const word = lo | (hi << 8);
  const jmp = (word & 0xfe0e) === 0x940c;
  const rjmp = (word & 0xf000) === 0xc000;
  return jmp || rjmp;
}

/**
 * Offset of `XBIF` in the last page of xboot's staging half, which ends where
 * the application section ends (XB_APP_TEMP_END, XB src/api.h:72): the page's
 * bytes PAGE-6..PAGE-3 (XB src/xboot.c:1300-1301).
 */
export function installMarkerAt(part: Part): number {
  return part.appBytes - 6;
}

/** Parse and validate `text` as an application image for `part`. */
export function parseIntelHex(text: string, part: Part): HexParse {
  if (typeof text !== 'string') return fail('empty', 'The file is not text.');
  if (text.trim() === '') return fail('empty', 'The file is empty.');
  if (text.length > MAX_HEX_TEXT_BYTES) return fail('too-large', `The file is larger than ${MAX_HEX_TEXT_BYTES} bytes; a firmware image for this board is much smaller.`);
  const lines = text.split('\n');
  const bytes = new Uint8Array(part.appBytes).fill(0xff);
  const given = new Uint8Array(part.appBytes);
  const used: boolean[] = Array.from({ length: appPages(part) }, () => false);
  let base = 0;
  let ended = false;
  let dataBytes = 0;
  let end = 0;
  let records = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let raw = lines[i] as string;
    if (raw.endsWith('\r')) raw = raw.slice(0, -1);
    if (raw === '') {
      // Blank lines only after the end record (the final newline makes one).
      if (ended || i === lines.length - 1) continue;
      return fail('bad-record', 'A blank line before the end record.', lineNo);
    }
    if (ended) return fail('data-after-end', 'A record after the end-of-file record.', lineNo);
    if (!RECORD.test(raw)) {
      return /^:/.test(raw) ? fail('bad-record', 'A record with an odd number of hex digits or a non-hex character.', lineNo) : fail('bad-character', 'A line that is not an Intel HEX record. Is this really a .hex file?', lineNo);
    }
    const rec = new Uint8Array((raw.length - 1) / 2);
    for (let k = 0; k < rec.length; k++) rec[k] = parseInt(raw.slice(1 + 2 * k, 3 + 2 * k), 16);
    if (rec.length < 5) return fail('bad-length', 'A record shorter than its header.', lineNo);
    const count = rec[0] as number;
    if (rec.length !== count + 5) return fail('bad-length', `The record says ${count} data bytes but carries ${rec.length - 5}.`, lineNo);
    let sum = 0;
    for (const b of rec) sum = (sum + b) & 0xff;
    if (sum !== 0) return fail('bad-checksum', 'A record checksum does not match: the file is damaged.', lineNo);
    records++;
    const offset = ((rec[1] as number) << 8) | (rec[2] as number);
    const type = rec[3] as number;
    const data = rec.subarray(4, 4 + count);
    switch (type) {
      case 0x00: {
        if (offset + count > 0x10000) return fail('address-wrap', 'A data record runs past the end of its 64 KB block.', lineNo);
        for (let k = 0; k < count; k++) {
          const at = base + offset + k;
          if (at >= part.bootStart && at < part.bootStart + part.bootBytes) {
            return fail('boot-section', `The image writes address 0x${at.toString(16)}, inside the bootloader section (0x${part.bootStart.toString(16)} and above). Run never writes the bootloader.`, lineNo);
          }
          if (at >= part.appBytes) return fail('out-of-range', `The image writes address 0x${at.toString(16)}, beyond this board's flash.`, lineNo);
          if (given[at] === 1) return fail('overlap', `Address 0x${at.toString(16)} is given twice.`, lineNo);
          given[at] = 1;
          bytes[at] = data[k] as number;
          used[Math.floor(at / part.pageBytes)] = true;
          dataBytes++;
          end = Math.max(end, at + 1);
        }
        break;
      }
      case 0x01:
        if (count !== 0 || offset !== 0) return fail('bad-record', 'A malformed end-of-file record.', lineNo);
        ended = true;
        break;
      case 0x02:
        if (count !== 2 || offset !== 0) return fail('bad-address-record', 'A malformed extended segment address record.', lineNo);
        base = (((data[0] as number) << 8) | (data[1] as number)) << 4;
        break;
      case 0x04:
        if (count !== 2 || offset !== 0) return fail('bad-address-record', 'A malformed extended linear address record.', lineNo);
        base = (((data[0] as number) << 8) | (data[1] as number)) * 0x10000;
        break;
      case 0x03:
      case 0x05:
        if (count !== 4 || offset !== 0) return fail('bad-address-record', 'A malformed start address record.', lineNo);
        break;
      default:
        return fail('unknown-record-type', `Record type ${type} is not one a firmware image uses.`, lineNo);
    }
  }
  if (records === 0) return fail('empty', 'The file has no records.');
  if (!ended) return fail('missing-end', 'The file has no end-of-file record: it may be cut short.');
  if (dataBytes === 0) return fail('no-data', 'The file holds no data.');
  if (given[0] !== 1 || given[1] !== 1 || !isResetVector(bytes[0] as number, bytes[1] as number)) {
    return fail('no-reset-vector', 'The image does not start with a reset vector (a jump at address 0), so the board could not start it.');
  }
  const marker = installMarkerAt(part);
  if (bytes[marker] === 0x58 && bytes[marker + 1] === 0x42 && bytes[marker + 2] === 0x49 && bytes[marker + 3] === 0x46) {
    return fail('install-marker', "The image carries xboot's install marker (XBIF), which would make the bootloader copy part of it over itself on exit.");
  }
  return { ok: true, image: Object.freeze({ part, bytes, usedPages: Object.freeze(used), dataBytes, end }) };
}

/**
 * The application section as Intel HEX: 16 data bytes per record, extended
 * linear address records every 64 KB, pages that are entirely 0xFF (erased)
 * left out, then the end record. LF line ends. Used to save a firmware image
 * backup read from the board; `parseIntelHex` reads it back to the same
 * bytes (0xFF where nothing is given).
 */
export function toIntelHex(bytes: Uint8Array, part: Part): string {
  const out: string[] = [];
  let block = -1;
  for (let page = 0; page < appPages(part); page++) {
    const start = page * part.pageBytes;
    const slice = bytes.subarray(start, start + part.pageBytes);
    if (slice.every((b) => b === 0xff)) continue;
    for (let at = start; at < start + part.pageBytes; at += 16) {
      const hi = Math.floor(at / 0x10000);
      if (hi !== block) {
        block = hi;
        out.push(record(0, 0x04, [(hi >> 8) & 0xff, hi & 0xff]));
      }
      out.push(record(at & 0xffff, 0x00, [...bytes.subarray(at, at + 16)]));
    }
  }
  out.push(':00000001FF');
  return `${out.join('\n')}\n`;
}

function record(offset: number, type: number, data: readonly number[]): string {
  const body = [data.length, (offset >> 8) & 0xff, offset & 0xff, type, ...data];
  const sum = body.reduce((a, b) => (a + b) & 0xff, 0);
  return `:${[...body, (0x100 - sum) & 0xff].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('')}`;
}
