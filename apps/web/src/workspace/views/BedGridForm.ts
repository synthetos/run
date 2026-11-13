/** A local bed revision, never a controller setting. Drawing imports replace this grid and vice versa. */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { gridHoles, holeGridMm, XCARVE_HOLE_GRID, type BedHoleGrid } from '../bedHoleGrid.ts';
import { bedOf, saveMachineBed, type MachineProfile } from '../library.ts';

export function BedGridForm({ machine }: { readonly machine: MachineProfile }): ComponentChild {
  const bed = bedOf(machine);
  const [grid, setGrid] = useState<BedHoleGrid>(bed.holeGrid?.description ?? (machine.templateId === 'xcarve' ? XCARVE_HOLE_GRID : { ...XCARVE_HOLE_GRID, columns: 1, rows: 1 }));
  const [units, setUnits] = useState<'mm' | 'in'>('mm');
  const [note, setNote] = useState('');
  const field = (key: Exclude<keyof BedHoleGrid, 'offsetMeasured'>, label: string, count = false): ComponentChild => h('label', { class: 'field' },
    h('span', null, label), h('input', { type: 'number', value: grid[key], step: count ? 1 : 'any', min: key === 'firstX' || key === 'firstY' ? 0 : count ? 1 : 0.001,
      'aria-label': `${label}, hole grid${count ? '' : `, ${units}`}`, onInput: (e: Event) => setGrid({ ...grid, [key]: Number.parseFloat((e.currentTarget as HTMLInputElement).value) }) }));
  return h('details', { class: 'bed-grid', 'data-bed': 'hole-grid' }, h('summary', null, 'Threaded insert hole grid'),
    h('p', { class: 'fine' }, 'Display only: holes are not used for clearance checks, travel limits or commands sent to the machine. Saving replaces any drawing’s holes; importing a drawing replaces this grid.'),
    machine.templateId === 'xcarve' ? h('p', { class: 'fine' }, 'X-Carve owner measurements: 750 × 750 mm grid, 75 mm centres, 11 × 11 holes, 6.5 mm diameter. This is not an Inventables drawing.') : null,
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Hole grid units' }, (['mm', 'in'] as const).map(u => h('button', { type: 'button', class: units === u ? 'selected' : undefined, 'aria-pressed': units === u, 'data-action': `bed-grid-${u}`, onClick: () => {
      if (units === u) return;
      const scale = u === 'in' ? 1 / 25.4 : 25.4;
      setGrid({ ...grid, pitchX: grid.pitchX * scale, pitchY: grid.pitchY * scale, diameter: grid.diameter * scale, firstX: grid.firstX * scale, firstY: grid.firstY * scale }); setUnits(u);
    } }, u))),
    h('div', { class: 'field-grid' }, field('pitchX', 'Pitch X'), field('pitchY', 'Pitch Y'), field('columns', 'Holes per row (X)', true), field('rows', 'Rows (Y)', true), field('diameter', 'Hole diameter'), field('firstX', 'First hole X'), field('firstY', 'First hole Y')),
    h('p', { class: 'fine' }, 'First hole: measure from the bed’s front-left corner. ', grid.offsetMeasured ? 'Offset measured by you.' : 'Not measured: 0, 0 is only a placeholder. Measure this before relying on the drawing.'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: grid.offsetMeasured, 'data-action': 'bed-grid-measured', onChange: (e: Event) => setGrid({ ...grid, offsetMeasured: (e.currentTarget as HTMLInputElement).checked }) }), ' I measured the first-hole offset'),
    h('button', { type: 'button', class: 'small', 'data-action': 'bed-grid-save', disabled: holeGridMm(grid, units) === null, onClick: () => {
      const description = holeGridMm(grid, units);
      if (description === null) return;
      const saved = saveMachineBed(machine.id, { ...bed, holes: gridHoles(description), holeGrid: { description, source: 'Measured by the owner', at: new Date().toISOString() } });
      if (saved !== null) setNote(`Saved ${saved.holes.length} holes as bed revision ${saved.revision}. Any previous holes were replaced. Jobs keep their pinned bed until you choose the new revision.`);
    } }, 'Save hole grid'),
    note === '' ? null : h('p', { class: 'fine', role: 'status' }, note));
}
