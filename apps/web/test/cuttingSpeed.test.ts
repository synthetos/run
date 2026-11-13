import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { newTool } from '../src/workspace/library.ts';
import { canConvertSpeed, fromRpmFeed, toRpmFeed } from '../src/workspace/tools/cuttingSpeed.ts';
import { CuttingRowForm } from '../src/workspace/views/tools/CuttingRowForm.ts';
const base = newTool(1);
const tool = { ...base, geometry: { ...base.geometry, diameter: 6.35, flutes: 2 } };
describe('RPM/feed conversions', () => {
  it('round trips metric storage using the tool diameter and flutes', () => {
    const stored = fromRpmFeed(tool, 12000, 1524)!;
    expect(stored.vc).toBeCloseTo(Math.PI * 6.35 * 12, 12);
    expect(stored.fz).toBeCloseTo(0.0635, 12);
    const shown = toRpmFeed(tool, stored.vc, stored.fz)!;
    expect(shown.rpm).toBeCloseTo(12000, 10); expect(shown.feed).toBeCloseTo(1524, 10);
    expect(shown.feed / 25.4).toBeCloseTo(60, 10);
    expect(fromRpmFeed(tool, Math.round(shown.rpm), shown.feed)).toEqual(stored);
  });
  it.each([0, -1, 12000.5, NaN, Infinity])('rejects invalid RPM %s', rpm => expect(fromRpmFeed(tool, rpm, 100)).toBeNull());
  it.each([0, -1, NaN, Infinity])('rejects invalid feed %s', feed => expect(fromRpmFeed(tool, 12000, feed)).toBeNull());
  it('requires valid geometry and hides the RPM entry choice without it', () => {
    for (const geometry of [{ diameter: 0 }, { diameter: NaN }, { flutes: 0 }, { flutes: 1.5 }]) {
      const missing = { ...tool, geometry: { ...tool.geometry, ...geometry } };
      expect(canConvertSpeed(missing)).toBe(false);
      expect(fromRpmFeed(missing, 12000, 100)).toBeNull();
      expect(toRpmFeed(missing, 100, 0.1)).toBeNull();
      const html = renderToString(h(CuttingRowForm, { tool: missing, row: null, unit: 'mm', onApply: () => undefined, onCancel: () => undefined }));
      expect(html).toContain('needs a tool diameter and flute count');
      expect(html).not.toContain('data-action="cutting-row-rpm"');
    }
  });
  it('does not derive absent/invalid values or overflowing conversions', () => {
    for (const vc of [undefined, 0, -1, NaN, Infinity]) expect(toRpmFeed(tool, vc, 0.1)).toBeNull();
    for (const fz of [0, -1, NaN, Infinity]) expect(toRpmFeed(tool, 100, fz)).toBeNull();
    expect(fromRpmFeed(tool, Number.MAX_VALUE, 1)).toBeNull();
    expect(toRpmFeed(tool, Number.MAX_VALUE, Number.MAX_VALUE)).toBeNull();
  });
});
