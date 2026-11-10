/** Release titles (owner polish, 2026-11-10): product and major build, then the full version. */
import { describe, expect, it } from 'vitest';
import { releaseTitle } from '../src/firmware/releaseTitle.ts';

describe('releaseTitle', () => {
  it('product and major build, then the full version, for every dialect', () => {
    expect(releaseTitle({ dialect: 'tinyg-440', fb: 440.21 })).toBe('TinyG 440 · 440.21');
    expect(releaseTitle({ dialect: 'tinyg-en', fb: 450.02 })).toBe('TinyG edge-next 450 · 450.02');
    expect(releaseTitle({ dialect: 'tinyg-en', fb: 451 })).toBe('TinyG edge-next 451 · 451.00');
    expect(releaseTitle({ dialect: 'tinyg-449-stock', fb: 449.01 })).toBe('TinyG 449 · 449.01');
    expect(releaseTitle({ dialect: 'g2core-101.03', fb: 101.03 })).toBe('g2core 101 · 101.03');
  });

  it('an unknown dialect reads "Firmware", never a prototype key', () => {
    expect(releaseTitle({ dialect: 'something-new' as never, fb: 1.5 })).toBe('Firmware 1 · 1.50');
    expect(releaseTitle({ dialect: 'constructor' as never, fb: 2 })).toBe('Firmware 2 · 2.00');
  });
});
