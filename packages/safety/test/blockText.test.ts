import { describe, expect, it } from 'vitest';
import { BLOCK_FIXES, blockFindingText, programEndBlockText, findingReason } from '../src/sanitize/blockText.ts';
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
    expect(blockFindingText('future-rule', 'Check value; ', 1)).toBe('Check value.');
  });
});

it('every blocking rule keeps an existing repair without appending a second one', () => {
  for (const rule of [...Object.keys(BLOCK_FIXES), 'future-rule']) {
    for (const remedy of ['Remove the line, or export the file with a TinyG post-processor.', 'set G90 first.', 'write the rotary move on its own line.', 'Check the file around line 96.', 'Fix: Correct this line.']) {
      const detail = `Specific problem; ${remedy}`;
      const message = blockFindingText(rule, detail, 96);
      expect(message).toBe(detail);
      expect(message.match(/Fix:/g) ?? []).toHaveLength(remedy.startsWith('Fix:') ? 1 : 0);
      expect(blockFindingText(rule, message, 96)).toBe(message);
    }
    const generated = blockFindingText(rule, 'specific problem', 96);
    expect(blockFindingText(rule, generated, 96)).toBe(generated);
    expect(generated.match(/Fix:/g)).toHaveLength(1);
  }
});

it.each([
  ['modal-conflict', 'G53 under G91: TinyG moves by these values as distances, not to machine coordinates; use G90'],
  ['unknown-state', 'the distance mode in force is not known, so this G53 move cannot be modelled; set G90 first'],
  ['unknown-state', 'the motion mode in force is not known, so this line cannot be modelled; set G0 or G1 first'],
  ['unknown-state', 'the units in force before this line are not known, and the firmware converts F with them; set G20 or G21 on an earlier line'],
  ['feed-not-set', 'a feed move needs a feed rate: set F before the first G1, G2 or G3'],
  ['unsupported-word', 'rotary axis words on an arc are not modelled; write the rotary move on its own line'],
  ['end-state', 'the last line turns the spindle or coolant on together with the program end; move the M3/M4/M7/M8 off that line'],
])('%s: audited checker remedy remains the only repair', (rule, detail) => {
  expect(blockFindingText(rule, detail, 96)).toBe(detail.charAt(0).toUpperCase() + detail.slice(1) + '.');
});

it.each([
  ['The axis mode is unknown. Fix: Read settings.', 'the axis mode is unknown'],
  ['The axis mode is unknown..', 'the axis mode is unknown'],
  ['G53 needs G90.', 'G53 needs G90'],
  ['Z is unknown.', 'Z is unknown'],
  [' lower case; ', 'lower case'],
  ['', ''],
])('embedded finding strips list repair and sentence punctuation: %s', (message, reason) => {
  expect(findingReason(message)).toBe(reason);
  expect(`Cannot resume: ${findingReason(message)}.`).not.toContain('..');
});
