import { describe, expect, it } from 'vitest';
import { BLOCK_FIXES, blockFindingText, programEndBlockText } from '../src/sanitize/blockText.ts';
describe('plain blocking findings', () => {
  for (const rule of Object.keys(BLOCK_FIXES)) {
    it(`${rule}: preserves the specific problem and supplies a repair`, () => {
      expect(blockFindingText(rule, 'specific offending command (E154, PN §9.3).', 96)).toMatchSnapshot();
    });
  }
  it('shares the H35 explanation without exposing its reference in Simple', () => {
    expect(blockFindingText('mid-file-program-end', '', 96)).toBe(programEndBlockText(96));
    expect(programEndBlockText(96)).toMatchSnapshot();
  });
  it('keeps an unrecognised checker detail and still gives a next step', () => {
    expect(blockFindingText('future-rule', '', 0)).toBe('. Fix: Correct this line in the source file and check it again before running.');
    expect(blockFindingText('future-rule', 'Check value; ', 1)).toBe('Check value. Fix: Correct this line in the source file and check it again before running.');
  });
});
