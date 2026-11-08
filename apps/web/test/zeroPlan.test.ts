/**
 * The Run step's work zero against the plan (first-time walk 2026-11-08, S6): a saved plan first, then Place
 * job's planned zero, with the difference in mm and in words, never "No plan is recorded" when Place job has one.
 */
import { describe, expect, it } from 'vitest';
import { differenceWords, placeWords, runZeroCheck, type SetupPlan } from '../src/workspace/zeroPlan.ts';

const SETUP: SetupPlan = { zero: { x: 70, y: 60, z: -46.65 }, corner: 'front-left', height: 'top' };
const BOARD = { x: 0, y: 0, z: 0 };

describe('runZeroCheck (S6)', () => {
  it('uses Place job’s planned zero when no plan is saved, and says the difference in mm and words', () => {
    const c = runZeroCheck(BOARD, null, SETUP, true);
    expect(c.state).toBe('differs');
    expect(c.source).toBe('setup');
    expect(c.text).toContain('Work zero Z is 46.6 mm above the top of the stock you planned.');
    expect(c.text).toContain('In X and Y it is 70.0 mm to the left and 60.0 mm towards the front of the front-left corner you planned.');
    expect(c.text).not.toContain('No plan is recorded');
    expect(c.planText).toContain('at the front-left corner of the top of the stock');
  });
  it('is a match within 0.05 mm of an established planned zero', () => {
    const c = runZeroCheck({ x: 70.02, y: 60, z: -46.65 }, null, SETUP, true);
    expect(c.state).toBe('match');
    expect(c.text).toContain('where you planned it');
  });
  it('before the machine position is set, says the distance is not known and still needs the confirmation', () => {
    const c = runZeroCheck({ x: 70, y: 60, z: -46.65 }, null, SETUP, false);
    expect(c.state).toBe('differs');
    expect(c.text).toContain('The machine position is not set (not homed)');
    expect(c.planText).toContain('not comparable until the machine position is set');
  });
  it('a saved plan wins over the setup, as before', () => {
    const c = runZeroCheck(BOARD, BOARD, SETUP, true);
    expect(c.state).toBe('match');
    expect(c.source).toBe('saved');
  });
  it('says no plan only when there is none at all', () => {
    const c = runZeroCheck(BOARD, null, null, true);
    expect(c.text).toContain('No plan is recorded');
    expect(c.planText).toBe('none recorded');
  });
});

describe('words', () => {
  it('names the corner and face', () => {
    expect(placeWords({ ...SETUP, corner: 'center', height: 'bottom' })).toBe('the centre of the bottom of the stock');
  });
  it('below, right and back', () => {
    expect(differenceWords({ x: 75, y: 62, z: -50 }, SETUP)).toBe('Work zero Z is 3.4 mm below the top of the stock you planned. In X and Y it is 5.0 mm to the right and 2.0 mm towards the back of the front-left corner you planned.');
  });
});
