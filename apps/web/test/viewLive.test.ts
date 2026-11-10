/**
 * The 3D view during a job (owner, 2026-11-10): the lines' looks by planner state with their legend, the
 * "Planner starved" chip, and the spindle spinning the bit the way the board reports it (a badge under reduced
 * motion). Read only: all of it comes from what the board already reports.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { spinDirection } from '../src/preview/spinDirection.ts';
import { PlannerLegend } from '../src/preview/PlannerLegend.ts';
import { liveChips } from '../src/preview/ViewerOverlay.ts';
import { SceneKey } from '../src/preview/SceneKey.ts';

describe('spinDirection', () => {
  it('turns the way the board reports, and not at all when off or when the direction is not reported', () => {
    expect(spinDirection({ spe: 1, spc: 1 })).toBe(1);
    expect(spinDirection({ spe: 1, spc: 2 })).toBe(-1);
    expect(spinDirection({ spc: 1 })).toBe(1);
    expect(spinDirection({ spc: 2 })).toBe(-1);
    expect(spinDirection({ spe: 1, spd: 0 })).toBe(1);
    expect(spinDirection({ spe: 1, spd: 1 })).toBe(-1);
    expect(spinDirection({ spe: 0, spc: 1 })).toBe(0);
    expect(spinDirection({ spc: 0, spd: 0 })).toBe(0);
    expect(spinDirection({ spe: 1 })).toBe(0);
    expect(spinDirection(null)).toBe(0);
  });
});

describe('the planner legend and the live chips', () => {
  it('names each state, drawn by strength and pattern', () => {
    const html = renderToString(h(PlannerLegend, null));
    for (const t of ['Done', 'Executing', 'In the planner', 'Waiting for the board', 'Not sent']) expect(html).toContain(`>${t}<`);
    expect(html).toContain('stroke-dasharray');
    // In the key only while a job runs.
    expect(renderToString(h(SceneKey, { scene: null, planner: true }))).toContain('data-scene="planner-legend"');
    expect(renderToString(h(SceneKey, { scene: null }))).not.toContain('planner-legend');
  });

  it('shows "Planner starved" only when it lasted, and the spindle badge only under reduced motion', () => {
    const chips = (k: Parameters<typeof liveChips>[0], reduced: boolean): string => liveChips(k, reduced).map((c) => renderToString(c as never)).join('');
    expect(chips({ scene: null, starved: true }, false)).toContain('Planner starved');
    expect(chips({ scene: null, starved: false }, false)).toBe('');
    expect(chips({ scene: null, spin: 1 }, false)).toBe('');
    expect(chips({ scene: null, spin: 1 }, true)).toContain('↻ Spindle on');
    expect(chips({ scene: null, spin: -1 }, true)).toContain('↺ Spindle on');
    expect(chips({ scene: null, spin: 0 }, true)).toBe('');
    expect(chips({ scene: null, starved: true }, false)).not.toMatch(/safe|verified/i);
  });
});
