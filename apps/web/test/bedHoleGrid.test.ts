import { outsideBedHoleNote, visibleBedHoles } from '../src/workspace/bedHoles.ts';
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { gridHoles, holeGridMm, XCARVE_HOLE_GRID } from '../src/workspace/bedHoleGrid.ts';
import { BedGridForm } from '../src/workspace/views/BedGridForm.ts';
import { bedOf, bedIsPlaceholder, machineStore, saveMachineBed, type MachineProfile } from '../src/workspace/library.ts';

const machine: MachineProfile = { id: 'test-grid', name: 'My X-Carve', templateId: 'xcarve', travel: { x: 790, y: 790, z: 65 }, drive: 'belt', spindle: 'Router', createdAt: '2026-11-13' };

describe('display-only bed hole grid', () => {
  it('generates the owner’s 12 by 13 grid, including both endpoints and the measured offset', () => {
    const grid = { ...XCARVE_HOLE_GRID, firstX: 20, firstY: 35, offsetMeasured: true };
    const holes = gridHoles(grid);
    expect(holes).toHaveLength(156);
    expect(holes[0]).toEqual([20, 35, 3.25]);
    expect(holes[1]).toEqual([95, 35, 3.25]);
    expect(holes[12]).toEqual([20, 110, 3.25]);
    expect(holes[155]).toEqual([845, 935, 3.25]);
    expect(XCARVE_HOLE_GRID.offsetMeasured).toBe(false);
  });
  it('converts inch lengths, not counts, to mm', () => {
    const grid = { pitchX: 2, pitchY: 3, columns: 2, rows: 3, diameter: 0.25, firstX: 1, firstY: 0.5, offsetMeasured: true };
    expect(gridHoles(grid, 'in')).toEqual(gridHoles(holeGridMm(grid, 'in')!));
    expect(gridHoles(grid, 'in')[0]).toEqual([25.4, 12.7, 3.175]);
    expect(gridHoles(grid, 'in')).toHaveLength(6);
  });
  it.each([{ pitchX: 0 }, { pitchY: -1 }, { diameter: NaN }, { firstX: -1 }, { firstY: Infinity }, { columns: 1.5 }, { rows: 0 }, { columns: 3000 }, { pitchX: 1e308 }])('rejects invalid or excessive grids: %j', patch => {
    expect(holeGridMm({ ...XCARVE_HOLE_GRID, ...patch }, 'mm')).toBeNull();
    expect(gridHoles({ ...XCARVE_HOLE_GRID, ...patch })).toEqual([]);
  });
  it('saves a new revision without promoting unmeasured dimensions, and a drawing replaces all grid holes', () => {
    const before = machineStore.value.value;
    machineStore.set([machine]);
    const bed = bedOf(machine);
    try {
      const grid = saveMachineBed(machine.id, { ...bed, holes: gridHoles(XCARVE_HOLE_GRID), holeGrid: { description: XCARVE_HOLE_GRID, source: 'Measured by the owner', at: '2026-11-13' } })!;
      expect(grid.revision).toBe(bed.revision + 1);
      expect(grid.source).toEqual(bed.source);
      expect(bedIsPlaceholder(grid)).toBe(bedIsPlaceholder(bed));
      const { holeGrid: measuredGrid, ...drawing } = grid;
      expect(measuredGrid?.source).toBe('Measured by the owner');
      const imported = saveMachineBed(machine.id, { ...drawing, holes: [[10, 20, 3]], source: { kind: 'drawing', file: 'bed.svg', hash: 'hash', units: 'mm', scale: 1, at: '2026-11-13' } })!;
      expect(imported.holeGrid).toBeUndefined();
      expect(imported.holes).toEqual([[10, 20, 3]]);
      expect(imported.revision).toBe(grid.revision + 1);
    } finally { machineStore.set(before); }
  });
  it('identifies default offsets as unmeasured and explains replacement and display-only use', () => {
    const html = renderToString(h(BedGridForm, { machine }));
    expect(html).toContain('Not measured');
    expect(html).toContain('Display only');
    expect(html).toContain('importing a drawing replaces this grid');
    expect(html).toContain('value="12"');
    expect(html).toContain('value="13"');
    expect(html).toContain('approximate, for placing stock and clamps');
  });
});

it('does not draw out-of-bed hole centres or discard them from the saved pattern', () => {
  const holes = gridHoles(XCARVE_HOLE_GRID);
  const bed = { width: 750, depth: 750, holes };
  expect(visibleBedHoles(bed)).toHaveLength(121);
  expect(outsideBedHoleNote(bed)).toBe("35 holes fall outside the bed size. Check the bed's width and depth.");
  expect(holes).toHaveLength(156);
  expect(outsideBedHoleNote({ ...bed, width: 825, depth: 900 })).toBeNull();
  expect(visibleBedHoles({ ...bed, holes: [[-1, 0, 3], [0, -1, 3], [0, 0, 3], [750, 750, 3]] })).toEqual([[0, 0, 3], [750, 750, 3]]);
});
