import { describe, expect, it } from 'vitest';
import { analysisDialect } from '../src/preview/analysisDialect.ts';

describe('automatic analysis firmware', () => {
  it.each(['tinyg-en', 'tinyg-440'] as const)('uses covered %s without a note', dialect => {
    expect(analysisDialect(true, dialect)).toEqual({ dialect, note: null });
  });
  it.each(['g2core-101.03', 'g2core-edge', 'tinyg-449-stock', null, undefined] as const)('explains the connected fallback for %s', dialect => {
    expect(analysisDialect(true, dialect)).toEqual({ dialect: 'tinyg-en', note: "Checked for TinyG edge-next. This board's firmware is not covered." });
  });
  it('ignores stale classification after disconnect', () => {
    expect(analysisDialect(false, 'tinyg-440')).toEqual({ dialect: 'tinyg-en', note: 'Checked for TinyG edge-next. Connect to check against your board.' });
  });
});
