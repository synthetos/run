/**
 * DEV ONLY. Firmware images for the simulated TinyG (the flashable board,
 * flashableBoard.ts). They are NOT firmware: no real board can run one.
 *
 * An image is an ordinary application-section image as far as the flasher
 * can tell (a `jmp` at the reset vector, data in the application section
 * only), and carries an identity block the simulated board reads when it
 * starts it:
 *
 *   0x200  "RUN-SIM-FW" NUL
 *   0x20B  "fb=<fb>;fv=<fv>;hv=<hv>;layout=<n>;" padded with NUL to 0x27C
 *   0x27C  image length in bytes (u16, big-endian, in 256-byte units)
 *   0x27E  CRC-16 (xboot's) of bytes 0x280 .. length, big-endian
 *   0x280  pseudo-random filler from the seed
 *
 * The board starts an image only when the vector, the block and the CRC are
 * all intact, so a half-written image is never mistaken for a complete one.
 * The test kit has its own CRC and HEX writer: the oracle shares no code with
 * the flasher it checks.
 */
import '../marker.ts';

export const SIM_MARKER = 'RUN-SIM-FW';
export const SIM_IDENTITY_AT = 0x200;
const FIELDS_AT = 0x20b;
const LENGTH_AT = 0x27c;
const CRC_AT = 0x27e;
const BODY_AT = 0x280;
/** The x192a3 application section. */
export const SIM_APP_BYTES = 0x30000;
const PAGE = 512;

export interface SimBuild {
  readonly fb: number;
  readonly fv: number;
  readonly hv: number;
  /** EEPROM layout marker: a different one makes the board load its defaults on first boot. */
  readonly layout: number;
}

/** xboot's CRC (avr-libc `_crc16_update`, 0xA001, from 0). */
export function simCrc16(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i] as number;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

/** The whole application section of a simulated image, `sizeBytes` long (a multiple of 256), 0xFF after it. */
export function simFirmwareImage(build: SimBuild, sizeBytes: number, seed: number): Uint8Array {
  if (sizeBytes % 256 !== 0 || sizeBytes < 0x400 || sizeBytes > SIM_APP_BYTES) throw new RangeError('size must be a multiple of 256 between 1 KB and 192 KB');
  const img = new Uint8Array(SIM_APP_BYTES).fill(0xff);
  // A vector table of `jmp`s to 0x100 words, as an AVR application starts.
  for (let v = 0; v < 0x1f4; v += 4) img.set([0x0c, 0x94, 0x80, 0x00], v);
  const enc = new TextEncoder();
  img.fill(0, SIM_IDENTITY_AT, BODY_AT);
  img.set(enc.encode(SIM_MARKER), SIM_IDENTITY_AT);
  const fields = enc.encode(`fb=${build.fb};fv=${build.fv};hv=${build.hv};layout=${build.layout};`);
  if (fields.length > LENGTH_AT - FIELDS_AT) throw new RangeError('identity too long');
  img.set(fields, FIELDS_AT);
  img[LENGTH_AT] = (sizeBytes / 256) >> 8;
  img[LENGTH_AT + 1] = (sizeBytes / 256) & 0xff;
  let x = seed >>> 0 || 1;
  for (let i = BODY_AT; i < sizeBytes; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    img[i] = x & 0xff;
  }
  const crc = simCrc16(img, BODY_AT, sizeBytes);
  img[CRC_AT] = crc >> 8;
  img[CRC_AT + 1] = crc & 0xff;
  return img;
}

/** The build a complete image carries, or null when the vector, the block or the CRC is not intact. */
export function readSimBuild(app: Uint8Array): SimBuild | null {
  if (app.length !== SIM_APP_BYTES) return null;
  if (app[0] !== 0x0c || app[1] !== 0x94) return null;
  const marker = new TextDecoder().decode(app.subarray(SIM_IDENTITY_AT, SIM_IDENTITY_AT + SIM_MARKER.length));
  if (marker !== SIM_MARKER) return null;
  const size = (((app[LENGTH_AT] as number) << 8) | (app[LENGTH_AT + 1] as number)) * 256;
  if (size < BODY_AT || size > SIM_APP_BYTES) return null;
  const crc = ((app[CRC_AT] as number) << 8) | (app[CRC_AT + 1] as number);
  if (simCrc16(app, BODY_AT, size) !== crc) return null;
  const end = app.indexOf(0, FIELDS_AT);
  const text = new TextDecoder().decode(app.subarray(FIELDS_AT, end < 0 ? LENGTH_AT : end));
  const m = /^fb=([\d.]+);fv=([\d.]+);hv=(\d+);layout=(\d+);$/.exec(text);
  if (m === null) return null;
  return { fb: Number(m[1]), fv: Number(m[2]), hv: Number(m[3]), layout: Number(m[4]) };
}

/** Intel HEX of an application section: 16-byte records, pages of 0xFF left out, LF ends. */
export function simHex(app: Uint8Array): string {
  const out: string[] = [];
  let block = -1;
  const rec = (offset: number, type: number, data: readonly number[]): string => {
    const body = [data.length, (offset >> 8) & 0xff, offset & 0xff, type, ...data];
    const sum = body.reduce((a, b) => (a + b) & 0xff, 0);
    return `:${[...body, (0x100 - sum) & 0xff].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('')}`;
  };
  for (let p = 0; p < app.length / PAGE; p++) {
    const start = p * PAGE;
    if (app.subarray(start, start + PAGE).every((b) => b === 0xff)) continue;
    for (let at = start; at < start + PAGE; at += 16) {
      const hi = Math.floor(at / 0x10000);
      if (hi !== block) {
        block = hi;
        out.push(rec(0, 4, [(hi >> 8) & 0xff, hi & 0xff]));
      }
      out.push(rec(at & 0xffff, 0, [...app.subarray(at, at + 16)]));
    }
  }
  out.push(':00000001FF');
  return `${out.join('\n')}\n`;
}

/**
 * The simulated images the fake-serial suite flashes (generated into
 * `firmware/sim/` by `pnpm --filter @synthetos/testkit gen:sim-firmware`):
 * the board's current build, an update with the same EEPROM layout, an
 * update with a NEW layout (the board loads its defaults: switch type and
 * switch modes change, as the bench saw between 450 and 440.21), and a
 * "custom" build of the user's own.
 */
export const SIM_IMAGES = Object.freeze({
  current: { file: 'sim-edge-next-450.01.hex', build: { fb: 450.01, fv: 0.97, hv: 99, layout: 10002 }, size: 0x8000, seed: 45001 },
  update: { file: 'sim-edge-next-450.02.hex', build: { fb: 450.02, fv: 0.97, hv: 99, layout: 10002 }, size: 0x8800, seed: 45002 },
  newLayout: { file: 'sim-edge-next-451.00.hex', build: { fb: 451, fv: 0.97, hv: 99, layout: 10003 }, size: 0x9000, seed: 45100 },
  custom: { file: 'sim-custom-450.90.hex', build: { fb: 450.9, fv: 0.97, hv: 99, layout: 10002 }, size: 0x8400, seed: 45090 },
} as const);

export type SimImageName = keyof typeof SIM_IMAGES;

export function simImage(name: SimImageName): Uint8Array {
  const s = SIM_IMAGES[name];
  return simFirmwareImage(s.build, s.size, s.seed);
}
