/** Revisions and the bed's size in words (first-time walk 2026-11-08, C2 and C3). */
import { describe, expect, it } from 'vitest';
import { bedSizeText, bedTag, jobStateText, machineText, sameBed } from '../src/workspace/revisionWords.ts';

const placeholder = { width: 750, depth: 750, thickness: 19, toMachine: { x: 0, y: 0, z: -65 }, source: { kind: 'placeholder' as const, note: '' } };
const measured = { ...placeholder, source: { kind: 'measured' as const, note: '', at: '' } };

describe('revision words', () => {
  it('a placeholder bed shows its size with "(not measured yet)", never "not set"', () => {
    expect(bedSizeText(placeholder)).toBe('750 × 750 mm (not measured yet)');
    expect(bedSizeText(measured)).toBe('750 × 750 mm');
    expect(bedTag(placeholder)).toBe('Not measured yet');
    expect(bedTag(measured)).toBe('Measured');
  });
  it('Simple hides revision numbers; Advanced keeps them', () => {
    expect(jobStateText(3, true, false)).toBe('Saved');
    expect(jobStateText(3, false, false)).toBe('Unsaved changes');
    expect(jobStateText(3, true, true)).toBe('revision 3');
    expect(machineText('My X-Carve', 1, false)).toBe('My X-Carve');
    expect(machineText('My X-Carve', 1, true)).toBe('My X-Carve (rev 1)');
  });
  it('a bed matches another field for field', () => {
    expect(sameBed(placeholder, measured)).toBe(true);
    expect(sameBed(placeholder, { ...placeholder, width: 751 })).toBe(false);
  });
});
