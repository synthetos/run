/** Board settings are described and drafted locally before the write path is used. */
import { describe, expect, it } from 'vitest';
import { clearDraft, draftDiff, draftStore, motorFor, plainValue, setDraft, stepsPerUnit } from '../src/workspace/boardFacts.ts';


describe('plain-words settings and the draft', () => {
  it('reads enumerations and units from the overlay', () => {
    expect(plainValue('xsn', 3)).toBe('limit + homing');
    expect(plainValue('st', 1)).toBe('normally closed');
    expect(plainValue('1sa', 1.8)).toBe('1.8 deg/step');
    expect(plainValue('ex', 1)).toBe('XON/XOFF');
    expect(plainValue('xvm', undefined)).toBeNull();
  });

  it('steps per unit come from step angle, microsteps and travel per revolution', () => {
    expect(stepsPerUnit(1.8, 8, 40)).toBeCloseTo(40);
    expect(stepsPerUnit(undefined, 8, 40)).toBeNull();
  });

  it('a draft is compared with the board and never needs the board to exist', () => {
    clearDraft();
    setDraft('1mi', 4);
    expect(draftDiff('1mi', { '1mi': 8 })).toBe('changed');
    expect(draftDiff('1mi', { '1mi': 4 })).toBe('same');
    expect(draftDiff('1mi', {})).toBe('unread');
    setDraft('1mi', null);
    expect(draftStore.value.value).toEqual({});
  });

  it('maps axes to motors by ma, or by the factory order until the board is read', () => {
    expect(motorFor({}, 'z')).toEqual({ motor: 3, assumed: true });
    expect(motorFor({ '1ma': 2, '2ma': 0 }, 'x')).toEqual({ motor: 2, assumed: false });
    expect(motorFor({ '1ma': 2 }, 'y')).toEqual({ motor: null, assumed: false });
  });
});