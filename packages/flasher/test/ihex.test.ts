/**
 * The Intel HEX validator (SAFETY §4.8 image checks, H79, H84): checksums,
 * record types, the application section only (never the boot section), a
 * reset vector, no install marker, and the round trip of a firmware image
 * backup.
 */
import { describe, expect, it } from 'vitest';
import { X192A3, installMarkerAt, isResetVector, parseIntelHex, toIntelHex, type HexParse } from '../src/index.ts';

/** One record with a correct checksum. */
export function rec(offset: number, type: number, data: readonly number[]): string {
  const body = [data.length, (offset >> 8) & 0xff, offset & 0xff, type, ...data];
  const sum = body.reduce((a, b) => (a + b) & 0xff, 0);
  return `:${[...body, (0x100 - sum) & 0xff].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('')}`;
}

const JMP = [0x0c, 0x94, 0x00, 0x01];
const EOF = ':00000001FF';

function hex(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

function error(p: HexParse): string {
  return p.ok ? 'ok' : p.error.code;
}

describe('parseIntelHex', () => {
  it('reads a minimal image: data at 0 with a jmp reset vector', () => {
    const p = parseIntelHex(hex(rec(0, 0, [...JMP, 0x11, 0x22]), EOF), X192A3);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect([...p.image.bytes.subarray(0, 6)]).toEqual([...JMP, 0x11, 0x22]);
    expect(p.image.bytes[6]).toBe(0xff);
    expect(p.image.bytes.length).toBe(0x30000);
    expect(p.image.dataBytes).toBe(6);
    expect(p.image.end).toBe(6);
    expect(p.image.usedPages[0]).toBe(true);
    expect(p.image.usedPages[1]).toBe(false);
  });

  it('accepts CRLF line ends, lower-case hex, an rjmp vector and start address records', () => {
    const text = [rec(0, 0, [0x00, 0xc0]).toLowerCase(), rec(0, 5, [0, 0, 0, 0]), rec(0, 3, [0, 0, 0, 0]), EOF, ''].join('\r\n');
    expect(error(parseIntelHex(text, X192A3))).toBe('ok');
  });

  it('places data with extended linear (04) and segment (02) address records', () => {
    const p = parseIntelHex(hex(rec(0, 0, JMP), rec(0, 4, [0x00, 0x02]), rec(0x0010, 0, [0xab]), rec(0, 2, [0x10, 0x00]), rec(0x0001, 0, [0xcd]), EOF), X192A3);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.image.bytes[0x20010]).toBe(0xab);
    expect(p.image.bytes[0x10001]).toBe(0xcd);
  });

  it('refuses any byte in the boot section (0x30000 and above), and beyond the flash', () => {
    const boot = parseIntelHex(hex(rec(0, 0, JMP), rec(0, 4, [0x00, 0x03]), rec(0x0000, 0, [0x00]), EOF), X192A3);
    expect(error(boot)).toBe('boot-section');
    // The last byte of the application section is fine; the next is the bootloader.
    expect(error(parseIntelHex(hex(rec(0, 0, JMP), rec(0, 4, [0x00, 0x02]), rec(0xffff, 0, [0x01]), EOF), X192A3))).toBe('ok');
    expect(error(parseIntelHex(hex(rec(0, 0, JMP), rec(0, 4, [0x00, 0x02]), rec(0xfffe, 0, [0x01, 0x02]), EOF), X192A3))).toBe('ok');
    expect(error(parseIntelHex(hex(rec(0, 0, JMP), rec(0, 4, [0x00, 0x04]), rec(0, 0, [0x01]), EOF), X192A3))).toBe('out-of-range');
    // An xboot image itself (it lives at 0x30000).
    expect(error(parseIntelHex(hex(rec(0, 4, [0x00, 0x03]), rec(0, 0, JMP), EOF), X192A3))).toBe('boot-section');
  });

  it('refuses damaged records: checksum, length, characters, odd digits', () => {
    const good = rec(0, 0, JMP);
    const badSum = `${good.slice(0, -2)}${((parseInt(good.slice(-2), 16) + 1) & 0xff).toString(16).padStart(2, '0').toUpperCase()}`;
    expect(error(parseIntelHex(hex(badSum, EOF), X192A3))).toBe('bad-checksum');
    expect(error(parseIntelHex(hex(':0500000000', EOF), X192A3))).toBe('bad-length');
    expect(error(parseIntelHex(hex(':00000001', EOF), X192A3))).toBe('bad-length');
    expect(error(parseIntelHex(hex('<!doctype html>', EOF), X192A3))).toBe('bad-character');
    expect(error(parseIntelHex(hex(':0G', EOF), X192A3))).toBe('bad-record');
    expect(error(parseIntelHex(hex(`${good}0`, EOF), X192A3))).toBe('bad-record');
  });

  it('refuses unknown record types, malformed address and end records', () => {
    expect(error(parseIntelHex(hex(rec(0, 0, JMP), rec(0, 6, []), EOF), X192A3))).toBe('unknown-record-type');
    expect(error(parseIntelHex(hex(rec(0, 0, JMP), rec(0, 4, [0x00]), EOF), X192A3))).toBe('bad-address-record');
    expect(error(parseIntelHex(hex(rec(0, 0, JMP), rec(4, 4, [0x00, 0x01]), EOF), X192A3))).toBe('bad-address-record');
    expect(error(parseIntelHex(hex(rec(0, 0, JMP), rec(0, 2, [0x00]), EOF), X192A3))).toBe('bad-address-record');
    expect(error(parseIntelHex(hex(rec(0, 0, JMP), rec(0, 5, [0, 0]), EOF), X192A3))).toBe('bad-address-record');
    expect(error(parseIntelHex(hex(rec(0, 0, JMP), rec(0, 1, [0]), EOF), X192A3))).toBe('bad-record');
  });

  it('needs exactly one end record, last; blank lines only after it', () => {
    expect(error(parseIntelHex(hex(rec(0, 0, JMP)), X192A3))).toBe('missing-end');
    expect(error(parseIntelHex(hex(rec(0, 0, JMP), EOF, rec(0x10, 0, [1])), X192A3))).toBe('data-after-end');
    expect(error(parseIntelHex(hex(rec(0, 0, JMP), EOF, EOF), X192A3))).toBe('data-after-end');
    expect(error(parseIntelHex(hex(rec(0, 0, JMP), '', EOF), X192A3))).toBe('bad-record');
    expect(error(parseIntelHex(`${rec(0, 0, JMP)}\n${EOF}\n\n\n`, X192A3))).toBe('ok');
    expect(error(parseIntelHex(`${rec(0, 0, JMP)}\n${EOF}`, X192A3))).toBe('ok');
  });

  it('refuses overlaps (even with equal bytes), wrap-around, empty files and images with no data', () => {
    expect(error(parseIntelHex(hex(rec(0, 0, JMP), rec(2, 0, [0x00]), EOF), X192A3))).toBe('overlap');
    expect(error(parseIntelHex(hex(rec(0, 0, JMP), rec(0xffff, 0, [1, 2]), EOF), X192A3))).toBe('address-wrap');
    expect(error(parseIntelHex('', X192A3))).toBe('empty');
    expect(error(parseIntelHex('\n', X192A3))).toBe('empty');
    expect(error(parseIntelHex(hex(EOF), X192A3))).toBe('no-data');
    expect(error(parseIntelHex(42 as unknown as string, X192A3))).toBe('empty');
    expect(error(parseIntelHex(':'.repeat(2 * 1024 * 1024 + 1), X192A3))).toBe('too-large');
  });

  it('needs a reset vector at address 0', () => {
    expect(error(parseIntelHex(hex(rec(0x100, 0, JMP), EOF), X192A3))).toBe('no-reset-vector');
    expect(error(parseIntelHex(hex(rec(0, 0, [0xff, 0xff]), EOF), X192A3))).toBe('no-reset-vector');
    expect(error(parseIntelHex(hex(rec(0, 0, [0x0c]), EOF), X192A3))).toBe('no-reset-vector');
    expect(isResetVector(0x0c, 0x94)).toBe(true);
    expect(isResetVector(0x0d, 0x94)).toBe(true);
    expect(isResetVector(0x00, 0xc0)).toBe(true);
    expect(isResetVector(0xff, 0xff)).toBe(false);
    expect(isResetVector(0x0e, 0x94)).toBe(false);
  });

  it('refuses an image carrying the xboot install marker (XBIF) at the end of the staging half', () => {
    const at = installMarkerAt(X192A3);
    expect(at).toBe(0x2fffa);
    const marker = parseIntelHex(hex(rec(0, 0, JMP), rec(0, 4, [0x00, 0x02]), rec(at & 0xffff, 0, [0x58, 0x42, 0x49, 0x46]), EOF), X192A3);
    expect(error(marker)).toBe('install-marker');
    const near = parseIntelHex(hex(rec(0, 0, JMP), rec(0, 4, [0x00, 0x02]), rec(at & 0xffff, 0, [0x58, 0x42, 0x49, 0x47]), EOF), X192A3);
    expect(error(near)).toBe('ok');
  });

  it('reports the line of the problem', () => {
    const p = parseIntelHex(hex(rec(0, 0, JMP), rec(0x10, 7, []), EOF), X192A3);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error.line).toBe(2);
  });
});

describe('toIntelHex (firmware image backup)', () => {
  it('round-trips a whole application section, leaving erased pages out', () => {
    const bytes = new Uint8Array(0x30000).fill(0xff);
    bytes.set(JMP, 0);
    for (let i = 0x1000; i < 0x1400; i++) bytes[i] = i & 0xff;
    bytes[0x2ffff] = 0x5a;
    const text = toIntelHex(bytes, X192A3);
    expect(text.endsWith(':00000001FF\n')).toBe(true);
    // Pages 0, 8, 9 and the last one: 4 pages × 32 records, 2 address records (blocks 0 and 2) and the end.
    expect(text.trim().split('\n').length).toBe(4 * 32 + 2 + 1);
    const back = parseIntelHex(text, X192A3);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.image.bytes).toEqual(bytes);
  });
});
