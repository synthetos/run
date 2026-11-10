/**
 * The page plan: which application pages are written, and in what order
 * (SAFETY §4.8 flow, H80; OLD-S §4.8 step 7, the stub-vector order).
 *
 * run never erases the chip (`e` would also erase every EEPROM setting).
 * Each page is written with one block write, which xboot erases and writes
 * page by page (ENABLE_FLASH_ERASE_WRITE, XB src/xboot.c:1173-1178). So the
 * plan covers the WHOLE application section: a page the new image leaves
 * empty is written as 0xFF (erased), and the section ends exactly equal to
 * the image. That is also what makes a firmware image backup restorable bit
 * for bit, and the final CRC over the section meaningful.
 *
 * Order, so that an interrupted flash can never start a half-written image:
 * 1. **Stub page 0**: page 0 holding only `jmp 0x30000` (the bootloader).
 *    From here until step 4, a reset or the end of the entry window jumps to
 *    address 0 and straight back into xboot (XB src/xboot.c `asm("jmp 0")`),
 *    so the board stays in the bootloader whatever else is in flash.
 * 2. Pages N down to 1 (each skipped when the pre-flash read shows it already
 *    holds exactly the new bytes).
 * 3. Verify pages 1..N and the stub, by reading them back.
 * 4. The real page 0, then verify it.
 * The residual window is step 4 alone (one page, a few milliseconds of
 * erase-write): W11 says so.
 */
import { appPages, type Part } from './part.ts';
import type { HexImage } from './ihex.ts';

export interface PageWrite {
  /** Page index in the application section. */
  readonly page: number;
  readonly byteAddress: number;
  readonly data: Uint8Array;
}

export interface FlashPlan {
  readonly part: Part;
  /** The bytes the application section must hold when the flash is done. */
  readonly target: Uint8Array;
  /** Step 1: page 0 holding only the jump to the bootloader. */
  readonly stub: PageWrite;
  /** Step 2: pages N..1 that differ from the board, highest first. */
  readonly body: readonly PageWrite[];
  /** Step 4: the real page 0. */
  readonly final: PageWrite;
  /** Pages the pre-flash read showed already right (not written). */
  readonly unchanged: readonly number[];
}

/**
 * `jmp k` with k the bootloader's word address (0x30000 / 2 = 0x18000):
 * 1001 010k kkkk 110k kkkk kkkk kkkk kkkk, little-endian words.
 * k21..k17 = 0, k16 = 1, k15..k0 = 0x8000 → 0x940D 0x8000 → 0D 94 00 80.
 */
export function bootloaderJump(part: Part): Uint8Array {
  const k = part.bootStart / 2;
  const hi = 0x940c | ((k >> 16) & 0x1) | (((k >> 17) & 0x1f) << 4);
  const lo = k & 0xffff;
  return Uint8Array.of(hi & 0xff, hi >> 8, lo & 0xff, lo >> 8);
}

function page(target: Uint8Array, part: Part, index: number): PageWrite {
  const start = index * part.pageBytes;
  return Object.freeze({ page: index, byteAddress: start, data: target.slice(start, start + part.pageBytes) });
}

/**
 * The plan for `image`. `current` is the application section as read from the
 * board just before (the firmware image backup); pages 1..N that already
 * match it are skipped. Without `current` every page is written.
 */
export function planFlash(image: HexImage, current: Uint8Array | null = null): FlashPlan {
  const part = image.part;
  const target = image.bytes;
  const stubData = new Uint8Array(part.pageBytes).fill(0xff);
  stubData.set(bootloaderJump(part), 0);
  const body: PageWrite[] = [];
  const unchanged: number[] = [];
  for (let p = appPages(part) - 1; p >= 1; p--) {
    const start = p * part.pageBytes;
    const want = target.subarray(start, start + part.pageBytes);
    if (current !== null && current.length === target.length && current.subarray(start, start + part.pageBytes).every((b, i) => b === want[i])) {
      unchanged.push(p);
      continue;
    }
    body.push(page(target, part, p));
  }
  return Object.freeze({
    part,
    target,
    stub: Object.freeze({ page: 0, byteAddress: 0, data: stubData }),
    body: Object.freeze(body),
    final: page(target, part, 0),
    unchanged: Object.freeze(unchanged),
  });
}
