import { describe, expect, it } from 'vitest';
import { COOLANT_CHIP, COOLANT_TEXT, COOLANT_VALUE } from '../src/workspace/views/materialCoolant.ts';

const NEEDS = ['required', 'recommended', 'none', 'avoid'] as const;

describe('material coolant words', () => {
  it('has a readable value for every need, never the raw enum word in lower case', () => {
    expect(NEEDS.map((n) => COOLANT_VALUE[n])).toEqual(['Required', 'Recommended', 'Not needed', 'Avoid']);
    for (const n of NEEDS) expect(COOLANT_VALUE[n]).toMatch(/^[A-Z]/);
  });
  it('keeps the chip and its title for every need', () => {
    expect(NEEDS.map((n) => COOLANT_CHIP[n])).toEqual(['Coolant', 'Air or mist', 'Dry', 'Keep dry']);
    expect(COOLANT_TEXT.required).toBe('Coolant required');
  });
});
