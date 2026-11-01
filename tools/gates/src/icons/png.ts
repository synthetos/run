/**
 * Minimal PNG encoder and decoder for the app icons (ROADMAP P0-05, D38):
 * 8-bit RGBA, no interlace, filter type 0 on every row. The decoder reads
 * only that form, which is what the encoder writes; anything else throws.
 * node:zlib only, so no image library is needed.
 */
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

export interface Image {
  readonly width: number;
  readonly height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  readonly rgba: Uint8Array;
}

export function encodePng(image: Image): Buffer {
  const { width, height, rgba } = image;
  if (rgba.length !== width * height * 4) throw new Error('png: pixel buffer size does not match the dimensions');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([Buffer.from(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}

/** The dimensions from the IHDR chunk of any PNG. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const b = Buffer.from(png);
  if (!b.subarray(0, 8).equals(Buffer.from(SIGNATURE)) || b.toString('latin1', 12, 16) !== 'IHDR') throw new Error('png: not a PNG file');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** Decodes a PNG written by `encodePng`. */
export function decodePng(png: Uint8Array): Image {
  const b = Buffer.from(png);
  const { width, height } = pngSize(b);
  if (b[24] !== 8 || b[25] !== 6 || b[28] !== 0) throw new Error('png: only 8-bit RGBA, non-interlaced images are supported');
  const idat: Buffer[] = [];
  let at = 8;
  while (at < b.length) {
    const length = b.readUInt32BE(at);
    const type = b.toString('latin1', at + 4, at + 8);
    const data = b.subarray(at + 8, at + 8 + length);
    if (crc32(b.subarray(at + 4, at + 8 + length)) !== b.readUInt32BE(at + 8 + length)) throw new Error(`png: bad CRC in ${type}`);
    if (type === 'IDAT') idat.push(data);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    if (raw[row] !== 0) throw new Error('png: only filter type 0 is supported');
    rgba.set(raw.subarray(row + 1, row + 1 + width * 4), y * width * 4);
  }
  return { width, height, rgba };
}
