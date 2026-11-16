import { describe, expect, it } from 'vitest';
import { SHA256_HEX, isArray, isDateTime, isHole, isNum, isObject, isPoint } from '../src/index.ts';

describe('shape guards', () => {
  it('tell objects, arrays and finite numbers apart', () => {
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(false);
    expect(isObject(null)).toBe(false);
    expect(isArray([])).toBe(true);
    expect(isArray({ length: 0 })).toBe(false);
    expect(isNum(1.5)).toBe(true);
    expect(isNum(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isNum('1')).toBe(false);
  });

  it('read points, holes, digests and dates', () => {
    expect(isPoint([1, 2])).toBe(true);
    expect(isPoint([1])).toBe(false);
    expect(isPoint([1, 'two'])).toBe(false);
    expect(isHole([1, 2, 3])).toBe(true);
    expect(isHole([1, 2])).toBe(false);
    expect(SHA256_HEX.test('ab'.repeat(32))).toBe(true);
    expect(SHA256_HEX.test('AB'.repeat(32))).toBe(false);
    expect(isDateTime('2026-11-15T12:00:00.000Z')).toBe(true);
    expect(isDateTime('2026-11-15')).toBe(true);
    expect(isDateTime('not a date')).toBe(false);
    expect(isDateTime(`2026-11-15T12:00:00.000Z${' '.repeat(20)}`)).toBe(false);
    expect(isDateTime(20261115)).toBe(false);
  });
});
