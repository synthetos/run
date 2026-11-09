/**
 * Colour by tool (owner, 2026-11-09): the slot of every line and the legend, built from the tools the file
 * uses in the order it uses them (preview/toolSlots.ts), and the palette for light and dark backgrounds
 * (preview/toolPalette.ts).
 */
import { describe, expect, it } from 'vitest';
import { NO_TOOL, type ToolChanges } from '@synthetos/gcode';
import { SEGMENT } from '@synthetos/gcode-view';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import { NO_TOOL_CHOSEN, NO_TOOL_NAMED, toolLegend } from '../src/preview/toolSlots.ts';
import { DARK_PALETTE, LIGHT_PALETTE, TOOL_COLOURS, toolPalette } from '../src/preview/toolPalette.ts';

const changes = (lines: number[], tools: number[]): Pick<ToolChanges, 'lines' | 'tools'> => ({ lines: Uint32Array.from(lines), tools: Int32Array.from(tools) });
/** Sent lines that each draw one segment of the given kind (0 for none). */
function segs(kinds: number[]): { kinds: Uint8Array; lineToVertex: Uint32Array } {
  return { kinds: Uint8Array.from([SEGMENT.BREAK, ...kinds.filter((k) => k !== 0)]), lineToVertex: Uint32Array.from(kinds.reduce<number[]>((acc, k) => [...acc, (acc.at(-1) as number) + (k === 0 ? 0 : 1)], [1])) };
}
const { FEED, RAPID } = SEGMENT;
const lines = (n: number): Uint32Array => Uint32Array.from({ length: n }, (_, i) => i + 1);

describe('toolLegend', () => {
  it('gives each tool a slot by first use, keeps it when the tool comes back, and lists the tools in that order', () => {
    // T4 at line 2, T1 at line 4, T4 again at line 6.
    const l = toolLegend(changes([2, 4, 6], [4, 1, 4]), lines(7), segs([RAPID, FEED, FEED, FEED, FEED, FEED, FEED]), SEED_TOOLS);
    expect([...l.lineSlots]).toEqual([0, 1, 1, 2, 2, 1, 1]);
    expect(l.entries.map((e) => [e.slot, e.label])).toEqual([[1, 'T4 · 90° V-bit'], [2, 'T1 · 3.175 mm 2-flute up-cut']]);
  });

  it('draws an unknown tool neutral and names it as such', () => {
    const l = toolLegend(changes([3, 5, 7], [9, NO_TOOL, 1]), lines(8), segs([FEED, 0, FEED, 0, FEED, 0, FEED, 0]), SEED_TOOLS);
    expect([...l.lineSlots]).toEqual([0, 0, 0, 0, 0, 0, 1, 1]);
    expect(l.entries.map((e) => [e.slot, e.known, e.label])).toEqual([[0, false, NO_TOOL_CHOSEN], [0, false, 'T9 · not in your tool table'], [0, false, NO_TOOL_NAMED], [1, true, 'T1 · 3.175 mm 2-flute up-cut']]);
  });

  it('uses the tool the user chose as already in the spindle before the first tool change', () => {
    const l = toolLegend(changes([3], [4]), lines(4), segs([FEED, FEED, FEED, FEED]), SEED_TOOLS, 1);
    expect([...l.lineSlots]).toEqual([1, 1, 2, 2]);
    expect(l.entries.map((e) => e.label)).toEqual(['T1 · 3.175 mm 2-flute up-cut', 'T4 · 90° V-bit']);
  });

  it('lists only tools that cut; a header of rapids before the first tool change is not a tool', () => {
    const l = toolLegend(changes([2], [3]), lines(3), segs([RAPID, FEED, FEED]), SEED_TOOLS);
    expect(l.entries.map((e) => e.label)).toEqual(['T3 · 3.175 mm ball nose']);
  });

  it('never cycles the colours: a ninth tool shares the eighth colour', () => {
    const table = Array.from({ length: 10 }, (_, k) => ({ number: k + 1, tool: { ...(SEED_TOOLS[0] as (typeof SEED_TOOLS)[number]).tool, name: `Tool ${String(k + 1)}` } }));
    const n = 10;
    const l = toolLegend(changes(Array.from({ length: n }, (_, k) => k + 1), Array.from({ length: n }, (_, k) => k + 1)), lines(n), segs(Array.from({ length: n }, () => FEED)), table);
    expect([...l.lineSlots]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8, 8]);
    expect(TOOL_COLOURS).toBe(8);
  });
});

describe('toolPalette', () => {
  it('picks the set for the background', () => {
    expect(toolPalette([1, 1, 1, 1])).toBe(LIGHT_PALETTE);
    expect(toolPalette([0.09, 0.1, 0.12, 1])).toBe(DARK_PALETTE);
    expect(toolPalette(null)).toBe(LIGHT_PALETTE);
  });
  it('has a neutral slot and eight distinct tool colours in each set, none of them red', () => {
    for (const p of [LIGHT_PALETTE, DARK_PALETTE]) {
      expect(p).toHaveLength(9);
      expect(new Set(p.map((c) => c.join(','))).size).toBe(9);
      // Neutral: no hue.
      const [r, g, b] = p[0] as readonly number[];
      expect(Math.max(r as number, g as number, b as number) - Math.min(r as number, g as number, b as number)).toBeLessThan(0.1);
      // No warning red: red never dominates green and blue together.
      for (const c of p) expect(!((c[0] as number) > 0.6 && (c[1] as number) < 0.35 && (c[2] as number) < 0.35)).toBe(true);
    }
  });
  it('reads on its background: each tool colour has at least 3:1 contrast', () => {
    const lum = (c: readonly number[]): number => {
      const f = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(c[0] as number) + 0.7152 * f(c[1] as number) + 0.0722 * f(c[2] as number);
    };
    const ratio = (a: readonly number[], b: readonly number[]): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    for (const c of LIGHT_PALETTE.slice(1)) expect(ratio(c, [1, 1, 1])).toBeGreaterThanOrEqual(3);
    for (const c of DARK_PALETTE.slice(1)) expect(ratio(c, [0.1, 0.11, 0.13])).toBeGreaterThanOrEqual(3);
  });
});
