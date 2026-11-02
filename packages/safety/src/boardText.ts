/**
 * Strings from the serial port, made safe to show (ROADMAP P1-07; SAFETY
 * T-S85: "strings from the serial port render via `textContent` with bidi
 * sanitising").
 *
 * A board's `id`, `fbs`, `msg` and error text are data from a device the
 * app does not control. The UI only ever puts them in text nodes, never in
 * markup; this function removes what a text node would still let through:
 * control characters that break lines or erase text, and the bidirectional
 * marks, embeddings, overrides and isolates that can reorder what the user
 * reads (a board id that displays as another machine's), and the invisible
 * format characters that make two ids look identical. Each such code
 * point becomes U+FFFD, so the user sees that something was there.
 *
 * Unlike `strings.ts` this never throws: a hostile board must not be able to
 * make the DRO or the settings view fail to render.
 */

/** Longest board string shown; longer ones are cut with an ellipsis. */
export const BOARD_TEXT_MAX = 200;

/**
 * The controls `strings.ts` refuses, the line and paragraph separators, and every format character
 * (\p{Cf}): the bidi marks, embeddings, overrides and isolates, and also the invisible ones
 * (U+200B..U+200D, U+2060..U+2064, U+FEFF, U+00AD, U+180E) that make two different ids look the
 * same (HIL-1.4: the operator picks a board by the id they see).
 */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/gu;

/** `value` with every control and bidi-control character replaced by U+FFFD, capped at `max` code points. Non-strings show as ''. */
export function boardText(value: unknown, max: number = BOARD_TEXT_MAX): string {
  if (typeof value !== 'string') return '';
  const clean = value.replace(UNSAFE, '\ufffd');
  const points = Array.from(clean);
  return points.length > max ? `${points.slice(0, max).join('')}\u2026` : clean;
}
