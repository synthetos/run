/**
 * The tool drawn to scale (Library → Tools → Details): the outline is gcode-view's profile, the dimensions are the
 * typed numbers, and numbers that cannot be right are flagged as typed.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import renderToString from 'preact-render-to-string';
import type { Tool, ToolGeometry, ToolType } from '@synthetos/library';
import { ISSUE_TEXT, fluteHatch, niceStep, toolDrawingModel } from '../src/workspace/toolDrawing/model.ts';
import { ToolDrawing, dimOfField } from '../src/workspace/toolDrawing/ToolDrawing.ts';
import { draftGeometry } from '../src/workspace/toolDrawing/ToolDrawingEditor.ts';
import { TOOL_FIELD_MEANING } from '../src/workspace/toolDrawing/meanings.ts';

const END_MILL: ToolGeometry = { diameter: 6, shank: 6, flutes: 2, fluteLength: 22, overallLength: 50, stickout: 30 };
const tool = (type: ToolType, geometry: Partial<ToolGeometry> = {}): Pick<Tool, 'type' | 'geometry'> => ({ type, geometry: { ...END_MILL, ...geometry } });

describe('toolDrawingModel', () => {
  it('an end mill: square tip, flutes to 22, shank to 50, the holder face at the stickout', () => {
    const m = toolDrawingModel(tool('flat'));
    expect(m.outline[0]).toEqual([0, 0]);
    expect(m.outline).toContainEqual([3, 0]);
    expect(m.outline).toContainEqual([3, 50]);
    expect(m.outline).toContainEqual([-3, 50]);
    expect(m).toMatchObject({ radius: 3, shankRadius: 3, tipTop: 0, fluteTop: 22, top: 50, holder: 30, flutes: 2, issues: [] });
    expect(m.dims.map((d) => [d.key, d.value, d.label])).toEqual([
      ['diameter', 6, 'Ø6'],
      ['shank', 6, 'Ø6'],
      ['fluteLength', 22, 'Flutes 22'],
      ['overallLength', 50, 'Overall 50'],
      ['stickout', 30, 'Stickout: out of the holder 30'],
    ]);
  });

  it('the tip by type, from the same profile as the 3D bit: ball R, V angle, drill point', () => {
    expect(toolDrawingModel(tool('ball')).tipTop).toBeCloseTo(3, 6);
    expect(toolDrawingModel(tool('v-bit', { vAngle: 90 })).tipTop).toBeCloseTo(3, 6);
    expect(toolDrawingModel(tool('v-bit', { vAngle: 60 })).tipTop).toBeCloseTo(3 / Math.tan((30 * Math.PI) / 180), 6);
    expect(toolDrawingModel(tool('drill', { pointAngle: 118 })).tipTop).toBeCloseTo(3 / Math.tan((59 * Math.PI) / 180), 6);
    expect(toolDrawingModel(tool('bull-nose', { cornerRadius: 1 })).tipTop).toBeCloseTo(1, 6);
    expect(toolDrawingModel(tool('o-flute')).tipTop).toBe(0);
    // A reduced shank steps in at the top of the flutes.
    const v = toolDrawingModel(tool('v-bit', { vAngle: 90, diameter: 12, shank: 6, fluteLength: 8 }));
    expect(v.outline).toContainEqual([6, 8]);
    expect(v.outline).toContainEqual([3, 8]);
    expect(v.issues).toEqual([]);
  });

  it('no stickout: no holder face and no stickout dimension', () => {
    const { stickout: _s, ...g } = END_MILL;
    const m = toolDrawingModel({ type: 'flat', geometry: g });
    expect(m.holder).toBeNull();
    expect(m.dims.map((d) => d.key)).not.toContain('stickout');
  });

  it('impossible numbers are kept as typed and flagged', () => {
    expect(toolDrawingModel(tool('flat', { fluteLength: 35 })).issues).toEqual([{ key: 'fluteLength', text: ISSUE_TEXT.flutesInCollet }]);
    expect(toolDrawingModel(tool('flat', { stickout: 60 })).issues).toEqual([{ key: 'stickout', text: ISSUE_TEXT.stickoutTooLong }]);
    const long = toolDrawingModel(tool('flat', { fluteLength: 55, stickout: 60 }));
    expect(long.issues.map((i) => i.text)).toEqual([ISSUE_TEXT.stickoutTooLong, ISSUE_TEXT.flutesTooLong]);
    expect(toolDrawingModel(tool('flat', { fluteLength: 55, stickout: 40 })).issues.map((i) => i.text)).toEqual([ISSUE_TEXT.flutesInCollet, ISSUE_TEXT.flutesTooLong]);
    expect(long.top).toBe(55);
    expect(toolDrawingModel(tool('flat', { shank: 4 })).issues).toEqual([{ key: 'shank', text: ISSUE_TEXT.thinShank }]);
    expect(toolDrawingModel(tool('surfacing', { diameter: 25, shank: 6.35 })).issues).toEqual([]);
  });

  it('numbers that cannot be drawn still give a drawing', () => {
    const m = toolDrawingModel({ type: 'flat', geometry: { diameter: 0, shank: Number.NaN, flutes: 0, fluteLength: -1, overallLength: 0 } });
    expect(m.radius).toBe(0.5);
    expect(m.shankRadius).toBe(0.5);
    expect(m.top).toBeGreaterThan(0);
    expect(m.flutes).toBe(1);
    expect(toolDrawingModel(tool('flat', { stickout: Number.NaN })).holder).toBeNull();
  });
});

describe('the grid, the hatch, the fields', () => {
  it('niceStep picks 1, 2 or 5 times a power of ten near the target spacing', () => {
    expect(niceStep(4)).toBe(10);
    expect(niceStep(10)).toBe(5);
    expect(niceStep(20)).toBe(2);
    expect(niceStep(40)).toBe(1);
    expect(niceStep(3, 32)).toBe(20);
  });

  it('more flutes, more hatch lines; none without a fluted part', () => {
    expect(fluteHatch(toolDrawingModel(tool('flat', { flutes: 2 })))).toHaveLength(7);
    expect(fluteHatch(toolDrawingModel(tool('flat', { flutes: 4 })))).toHaveLength(13);
    expect(fluteHatch(toolDrawingModel(tool('flat', { fluteLength: 0 })))).toEqual([]);
  });

  it('each field highlights its dimension and has one line of meaning', () => {
    expect(dimOfField('stickout')).toBe('stickout');
    expect(dimOfField('flutes')).toBe('fluteLength');
    expect(dimOfField('vAngle')).toBe('diameter');
    expect(dimOfField('name')).toBeNull();
    expect(dimOfField(null)).toBeNull();
    expect(TOOL_FIELD_MEANING['stickout']).toBe('Stickout: how far the tool sticks out of the collet. Shorter is stiffer.');
  });

  it('typed values not yet saved are drawn; a cleared stickout is no stickout', () => {
    expect(draftGeometry(END_MILL, { stickout: 40, diameter: 8 })).toMatchObject({ stickout: 40, diameter: 8 });
    expect(draftGeometry(END_MILL, { stickout: null }).stickout).toBeUndefined();
  });
});

describe('ToolDrawing', () => {
  it('draws the dimensions, the holder and the scale bar; the thumbnail draws only the tool', () => {
    const full = renderToString(h(ToolDrawing, { tool: tool('flat'), active: 'stickout' }));
    for (const key of ['diameter', 'shank', 'fluteLength', 'overallLength', 'stickout']) expect(full).toContain(`data-dim="${key}"`);
    expect(full).toContain('class="tf-dim active"');
    expect(full).toContain('Stickout: out of the holder 30');
    expect(full).toContain('data-holder');
    expect(full).toMatch(/\d+ mm<\/text>/);
    const warn = renderToString(h(ToolDrawing, { tool: tool('flat', { fluteLength: 35 }) }));
    expect(warn).toContain('tf-warn-zone');
    expect(warn).toContain('class="tf-dim warn"');
    const thumb = renderToString(h(ToolDrawing, { tool: tool('ball'), thumb: true }));
    expect(thumb).toContain('tool-thumb');
    expect(thumb).not.toContain('data-dim');
  });
});

it('inch drawing labels, accessible dimensions and round scale follow units without changing geometry', () => {
  const t = tool('flat', { diameter: 3.175, shank: 3.175, overallLength: 38, fluteLength: 12, stickout: 20 });
  const metric = toolDrawingModel(t);
  const imperial = toolDrawingModel(t, 'in');
  expect(imperial.outline).toEqual(metric.outline);
  expect(imperial.dims.map(({ label: _label, ...d }) => d)).toEqual(metric.dims.map(({ label: _label, ...d }) => d));
  const svg = renderToString(h(ToolDrawing, { tool: t, unit: 'in' }));
  expect(svg).toContain('Ø0.125');
  expect(svg).toContain('Overall 1.4961');
  expect(svg).toContain('Flutes 0.4724');
  expect(svg).toContain('0.5 in</text>');
  expect(svg).toContain('0.125 in. Edit it');
  expect(svg).not.toContain(' mm');
});
