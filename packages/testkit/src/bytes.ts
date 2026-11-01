/** Byte helpers shared by the kit. ASCII only: the TinyG wire protocol is 7-bit text. */

/** Encode a string of code points 0..255 as bytes (latin-1). Throws on anything wider. */
export function bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 0xff) throw new RangeError(`character U+${c.toString(16)} at ${i} does not fit in one byte`);
    out[i] = c;
  }
  return out;
}

/** Decode bytes as latin-1 (every byte maps to one code point, nothing is lost). */
export function text(data: Uint8Array | readonly number[]): string {
  let s = '';
  for (const b of data) s += String.fromCharCode(b);
  return s;
}

/**
 * A printable, unambiguous rendering for transcripts: printable ASCII as is
 * (with `\` doubled), LF and CR as `\n` and `\r`, everything else as `\xHH`.
 */
export function escapeBytes(data: Uint8Array | readonly number[]): string {
  let s = '';
  for (const b of data) {
    if (b === 0x5c) s += '\\\\';
    else if (b === 0x0a) s += '\\n';
    else if (b === 0x0d) s += '\\r';
    else if (b >= 0x20 && b < 0x7f) s += String.fromCharCode(b);
    else s += `\\x${b.toString(16).padStart(2, '0')}`;
  }
  return s;
}
