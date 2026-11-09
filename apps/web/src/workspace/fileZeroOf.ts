/**
 * The open file's own zero (fileZero.ts), from its drawn cutting moves and its first lines' comments. Remembered
 * per file, so the panel and the pre-selection read it without scanning the moves again. Null with no drawn file.
 */
import { latin1 } from '../gcode-worker/lines.ts';
import type { OpenFile } from './fileBridge.ts';
import { guessFileZero, type FileZero } from './fileZero.ts';
import { cutBounds } from './placeMargins.ts';

const seen = new WeakMap<Uint8Array, FileZero | null>();

/** The header comments a CAM post writes before the moves: the first 8 KB is plenty. */
const HEADER_BYTES = 8192;

export function fileZeroOf(file: OpenFile | null): FileZero | null {
  if (file === null || file.preview?.segments == null) return null;
  const cached = seen.get(file.bytes);
  if (cached !== undefined) return cached;
  const cut = cutBounds(file.preview.segments);
  const out = cut === null ? null : guessFileZero(cut, latin1(file.bytes, 0, Math.min(HEADER_BYTES, file.bytes.length)));
  seen.set(file.bytes, out);
  return out;
}
