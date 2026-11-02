/**
 * Row 35 / BENCH-P100-5: the axis-mode facts are rendered for read-only
 * sessions, never hidden; a mode that was not read is reported, never
 * assumed standard.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { AxisModes, axisModeView, familyOf } from '../src/machine-ui/AxisModes.ts';

const STANDARD = { xam: 1, yam: 1, zam: 1, aam: 1, bam: 0, cam: 0 };
const AT_ZERO = ['x', 'y', 'z', 'a', 'b', 'c'].map((axis) => ({ axis, machine: 0 }));

describe('axisModeView', () => {
  it('knows the families by dialect id, and nothing else', () => {
    expect(familyOf('tinyg-en')).toBe('tinyg');
    expect(familyOf('tinyg-440')).toBe('tinyg');
    expect(familyOf('g2core-edge')).toBe('g2core');
    expect(familyOf('marlin')).toBeNull();
    expect(familyOf(null)).toBeNull();
  });

  it('an unclassified board, and a read in progress, say so', () => {
    expect(axisModeView({ dialectId: null, reading: false, settings: STANDARD, machine: AT_ZERO })).toEqual({ kind: 'unclassified' });
    expect(axisModeView({ dialectId: 'tinyg-440', reading: true, settings: {}, machine: AT_ZERO })).toEqual({ kind: 'reading' });
  });

  it('standard modes give no fact', () => {
    const view = axisModeView({ dialectId: 'tinyg-en', reading: false, settings: STANDARD, machine: AT_ZERO });
    expect(view.kind === 'facts' && view.facts).toEqual([]);
  });

  it('no settings read (incomplete, or a dialect without a read allowlist) reports every axis as not read', () => {
    const view = axisModeView({ dialectId: 'tinyg-449-stock', reading: false, settings: {}, machine: [] });
    expect(view.kind === 'facts' && view.facts.map((f) => `${f.axis}:${f.code}`)).toEqual(['X', 'Y', 'Z', 'A', 'B', 'C'].map((a) => `${a}:mode-not-read`));
  });

  it('an inhibited axis away from 0 (or with no polled position) is reported, and the session remembers it', () => {
    const settings = { ...STANDARD, aam: 2 };
    const away = axisModeView({ dialectId: 'tinyg-440', reading: false, settings, machine: AT_ZERO.map((a) => (a.axis === 'a' ? { axis: 'a', machine: 30 } : a)) });
    expect(away.kind === 'facts' && away.facts.map((f) => f.code)).toEqual(['inhibited-away-from-zero']);
    const unknown = axisModeView({ dialectId: 'tinyg-440', reading: false, settings, machine: [] });
    expect(unknown.kind === 'facts' && unknown.facts.map((f) => `${f.axis}:${f.code}`)).toEqual(['A:inhibited-away-from-zero']);
    if (away.kind !== 'facts') throw new Error('facts');
    const later = axisModeView({ dialectId: 'tinyg-440', reading: false, settings: STANDARD, machine: AT_ZERO, session: away.session });
    expect(later.kind === 'facts' && later.facts.map((f) => f.code)).toEqual(['left-inhibited-this-session']);
  });
});

describe('AxisModes', () => {
  it('renders every fact as text, with its axis and code', () => {
    const view = axisModeView({ dialectId: 'tinyg-en', reading: false, settings: { ...STANDARD, xam: 0, aam: 2 }, machine: AT_ZERO.map((a) => (a.axis === 'a' ? { axis: 'a', machine: 12 } : a)) });
    const html = renderToString(h(AxisModes, { view }));
    expect(html).toContain('data-region="axis-modes"');
    expect(html).toContain('data-axis="X" data-axis-fact="linear-disabled"');
    expect(html).toContain('data-axis="A" data-axis-fact="inhibited-away-from-zero"');
    expect(html).toMatch(/A is inhibited \(aam=2\) and it reads 12(\.0+)?\b/);
  });

  it('renders the clear, reading and unclassified states', () => {
    expect(renderToString(h(AxisModes, { view: axisModeView({ dialectId: 'tinyg-en', reading: false, settings: STANDARD, machine: AT_ZERO }) }))).toContain('data-axis-modes="clear"');
    expect(renderToString(h(AxisModes, { view: { kind: 'reading' } }))).toContain('data-axis-modes="reading"');
    expect(renderToString(h(AxisModes, { view: { kind: 'unclassified' } }))).toContain('data-axis-modes="unclassified"');
  });
});
