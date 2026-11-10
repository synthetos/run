/**
 * The work coordinate systems the sanitiser tracks (G10 L2/L20 P1-P6 and G54-G59): P1 is G54 and P6 is G59, in order.
 * G10 L20 P3 sets G56's offset only because WCS_CODES[2] is G56; a blanked or reordered entry would move an offset to
 * the wrong system without failing a rule test.
 */
import { describe, expect, it } from 'vitest';
import { WCS_CODES } from '../src/sanitize/index.ts';

describe('WCS_CODES', () => {
  it('is G54 to G59, in P order', () => {
    expect(WCS_CODES).toEqual(['G54', 'G55', 'G56', 'G57', 'G58', 'G59']);
  });
});
