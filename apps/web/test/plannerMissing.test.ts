import { describe, expect, it } from 'vitest';
import type { BoardReading } from '../src/workspace/analysisInputs.ts';
import { missingPlannerSettings, plannerProfile } from '../src/workspace/plannerInputs.ts';
import { subLine } from '../src/workspace/views/analyze/headlineText.ts';

const axes = { X: 1, Y: 1, Z: 1 };
const FULL: BoardReading = { dialect: 'tinyg', boardId: 'b', unit: 1, vm: { X: 800, Y: 800, Z: 800 }, fr: { X: 800, Y: 800, Z: 800 }, jm: { X: 20, Y: 20, Z: 20 }, jd: axes, ja: 200000, ct: 0.01, at: 1 };

describe('missingPlannerSettings', () => {
  it('names nothing for a complete reading and agrees with plannerProfile', () => {
    expect(missingPlannerSettings(FULL)).toEqual([]);
    expect(plannerProfile(FULL)).not.toBeNull();
  });
  it('names each missing group in plain words, once', () => {
    const r: BoardReading = { ...FULL, unit: null, vm: { X: 800 }, jm: {}, ja: 0, ct: undefined as unknown as number };
    expect(missingPlannerSettings(r)).toEqual(['units', 'max speed', 'jerk', 'junction acceleration', 'chordal tolerance']);
    expect(plannerProfile(r)).toBeNull();
  });
  it('treats a missing junction deviation as missing, a zero one as set', () => {
    const { jd: _jd, ...noJd } = FULL;
    expect(missingPlannerSettings(noJd)).toEqual(['junction deviation']);
    expect(missingPlannerSettings({ ...FULL, jd: { X: 0, Y: 0, Z: 0 } })).toEqual([]);
  });
  it('is empty without a reading', () => expect(missingPlannerSettings(null)).toEqual([]));
});

describe('subLine with missing settings', () => {
  const base = { estimate: null, modelled: false, connected: true, reading: true };
  it('lists up to three names, then "and more"', () => {
    expect(subLine({ ...base, missing: ['units', 'jerk'] })).toEqual({ kind: 'settings', text: 'Missing: units, jerk.' });
    expect(subLine({ ...base, missing: ['a', 'b', 'c'] }).text).toBe('Missing: a, b, c.');
    expect(subLine({ ...base, missing: ['a', 'b', 'c', 'd'] }).text).toBe('Missing: a, b, c and more.');
  });
  it('falls back to the old sentence when none are named', () => {
    expect(subLine({ ...base, missing: [] }).text).toBe('Some machine settings are missing.');
    expect(subLine(base).text).toBe('Some machine settings are missing.');
  });
});
