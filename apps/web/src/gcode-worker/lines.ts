/**
 * Line spans over the raw bytes of a G-code file, with the sanitiser's line
 * rules (SAFETY §4.7 step 1): CRLF, LFCR, CR and LF each end one line, and a
 * final terminator does not start another. The preview list reads rows
 * straight from the bytes through these spans, so a million-line file is held
 * once, as bytes, not as a million strings.
 *
 * Bytes map to characters one to one (Latin-1), as the sanitiser receives
 * them: it, not this module, decides what is allowed.
 */

const CR = 13;
const LF = 10;

/** [start, end) byte offsets per line, flattened: line i is spans[2i]..spans[2i+1]. */
export function lineSpans(bytes: Uint8Array): Uint32Array {
  let count = 0;
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === CR || c === LF) {
      count++;
      const pair = c === CR ? LF : CR;
      if (bytes[i + 1] === pair) i++;
    }
  }
  const last = bytes.length > 0 && bytes[bytes.length - 1] !== CR && bytes[bytes.length - 1] !== LF;
  const spans = new Uint32Array((count + (last ? 1 : 0)) * 2);
  let n = 0;
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === CR || c === LF) {
      spans[n++] = start;
      spans[n++] = i;
      const pair = c === CR ? LF : CR;
      if (bytes[i + 1] === pair) i++;
      start = i + 1;
    }
  }
  if (last) {
    spans[n++] = start;
    spans[n++] = bytes.length;
  }
  return spans;
}

/** Bytes [start, end) as a Latin-1 string. */
export function latin1(bytes: Uint8Array, start = 0, end = bytes.length): string {
  const parts: string[] = [];
  for (let i = start; i < end; i += 0x8000) parts.push(String.fromCharCode(...bytes.subarray(i, Math.min(end, i + 0x8000))));
  return parts.join('');
}

/** Text of line `index` (0-based). */
export function lineText(bytes: Uint8Array, spans: Uint32Array, index: number): string {
  return latin1(bytes, spans[index * 2] as number, spans[index * 2 + 1] as number);
}
