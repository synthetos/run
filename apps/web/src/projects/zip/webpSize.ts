/** Inspect dimensions before decoding pixels (WebP RIFF: VP8X, VP8L, or the VP8 key-frame header). */
export function webpSize(bytes: Uint8Array): { width: number; height: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = new TextDecoder('ascii').decode(bytes.slice(12, 16));
  if (kind === 'VP8X' && bytes.length >= 30) {
    if ((bytes[20]! & 2) !== 0) throw new Error('Animated WebP images are not supported.');
    const uint24 = (at: number) => bytes[at]! + (bytes[at + 1]! << 8) + (bytes[at + 2]! << 16);
    return { width: uint24(24) + 1, height: uint24(27) + 1 };
  }
  if (kind === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = v.getUint32(21, true); return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
    return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
  }
  throw new Error('The WebP image header could not be read.');
}
