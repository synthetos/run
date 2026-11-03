/**
 * The page plan (SAFETY H80): the whole application section, the stub page 0
 * first, pages N..1, the real page 0 last; pages that already match are
 * skipped; the CRC xboot answers is avr-libc's crc16.
 */
import { describe, expect, it } from 'vitest';
import { X192A3, bootloaderJump, crc16, crc16Update, isResetVector, parseIntelHex, planFlash, toIntelHex } from '../src/index.ts';

function image(fill: (bytes: Uint8Array) => void) {
  const bytes = new Uint8Array(0x30000).fill(0xff);
  bytes.set([0x0c, 0x94, 0x00, 0x01], 0);
  fill(bytes);
  const p = parseIntelHex(toIntelHex(bytes, X192A3), X192A3);
  if (!p.ok) throw new Error(p.error.message);
  return p.image;
}

describe('bootloaderJump', () => {
  it('is jmp 0x30000 (word 0x18000): 0D 94 00 80, a valid reset vector', () => {
    expect([...bootloaderJump(X192A3)]).toEqual([0x0d, 0x94, 0x00, 0x80]);
    const j = bootloaderJump(X192A3);
    expect(isResetVector(j[0] as number, j[1] as number)).toBe(true);
  });
});

describe('planFlash', () => {
  it('covers every page: stub first, then N..1 (erased pages too), then the real page 0', () => {
    const img = image((b) => b.fill(0x11, 0x400, 0x600));
    const plan = planFlash(img);
    expect(plan.stub.page).toBe(0);
    expect([...plan.stub.data.subarray(0, 4)]).toEqual([0x0d, 0x94, 0x00, 0x80]);
    expect(plan.stub.data.subarray(4).every((b) => b === 0xff)).toBe(true);
    expect(plan.body.length).toBe(383);
    expect(plan.body[0]?.page).toBe(383);
    expect(plan.body.at(-1)?.page).toBe(1);
    expect(plan.body.every((p, i, a) => i === 0 || (a[i - 1] as typeof p).page === p.page + 1)).toBe(true);
    expect(plan.final.page).toBe(0);
    expect([...plan.final.data.subarray(0, 4)]).toEqual([0x0c, 0x94, 0x00, 0x01]);
    expect(plan.unchanged).toEqual([]);
    const two = plan.body.find((p) => p.page === 2);
    expect(two?.data.every((b) => b === 0x11)).toBe(true);
    expect(two?.byteAddress).toBe(0x400);
  });

  it('skips pages the board already holds, never page 0', () => {
    const img = image((b) => b.fill(0x22, 0x200, 0x400));
    const current = new Uint8Array(img.bytes);
    current[0x10000] = 0x00; // one page differs
    current[3] = 0x77; // page 0 differs too, but page 0 is always written (stub, then real)
    const plan = planFlash(img, current);
    expect(plan.body.map((p) => p.page)).toEqual([0x10000 / 512]);
    expect(plan.unchanged.length).toBe(382);
    expect(plan.final.page).toBe(0);
    // A current read of the wrong size is ignored: every page is written.
    expect(planFlash(img, new Uint8Array(10)).body.length).toBe(383);
  });
});

describe('crc16 (xboot crc16_block, avr-libc _crc16_update)', () => {
  it('matches the CRC-16/ARC check value and starts from 0', () => {
    expect(crc16(new TextEncoder().encode('123456789'))).toBe(0xbb3d);
    expect(crc16(new Uint8Array(0))).toBe(0);
    expect(crc16Update(0, 0x01)).toBe(0xc0c1);
  });
});
