import {
  type Segment
} from '../geometry.ts';
import { type Word } from '../lex.ts';
import { AFTER_MOTION, ARC_LETTERS, AXIS_LETTERS, MOTION_CODES } from './tables.ts';

/**
 * Sub-segment bodies. The first carries every word of the original line that
 * acts before motion (modal codes, spindle and coolant codes, then F, S, T
 * and any other parameter word); every one carries the motion code (and
 * G53, which applies to its own block only); the last carries the
 * program-flow codes that act after motion (M0, M1, M2, M30, M60), so
 * barriers and holdback land on it. Axis and arc words come from the
 * segment; `dropLetters` (the arc's P turns) are already in the geometry.
 */
export function bodies(...[codes, params, segments, motionWords, perSegment, dropLetters]: [codes: readonly { word: Word; code: string }[], params: ReadonlyMap<string, Word>, segments: readonly Segment[], motionWords: readonly string[], perSegment: ReadonlySet<string>, dropLetters: readonly string[]]
): string[] {
  const before: string[] = [];
  const after: string[] = [];
  for (const { code } of codes) {
    if (MOTION_CODES.has(code) || code === 'G80' || perSegment.has(code)) continue;
    (AFTER_MOTION.has(code) ? after : before).push(code);
  }
  for (const [letter, w] of params) {
    if (AXIS_LETTERS.has(letter) || ARC_LETTERS.has(letter) || dropLetters.includes(letter)) continue;
    before.push(`${letter}${w.text}`);
  }
  return segments.map((seg, i) => {
    const parts: string[] = [];
    if (i === 0) parts.push(...before);
    parts.push(...motionWords, ...seg.words);
    if (i === segments.length - 1) parts.push(...after);
    return parts.join(' ');
  });
}
