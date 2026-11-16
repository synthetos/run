import { BedGridForm } from './BedGridForm.ts';
/**
 * The Machines view: start from a machine like yours, make a copy, and make
 * it yours (WORKSPACE_TENETS 6). Profiles are kept in this browser through
 * the library adapter; cloud sync comes later. A copy pins the template and
 * copies no board settings, homing or safety facts.
 *
 * The TinyG settings section makes the tie between the profile and the board
 * explicit: each profile field names the TinyG key it maps to, beside the
 * board's current value and a difference badge. Where the two differ the
 * profile value can be added to the Board view's pending changes (never
 * written from here; SAFETY §4.10 rule 4: a profile is never applied
 * automatically, and applying goes through C5 and the write path).
 */
import { h, type ComponentChild } from 'preact';
import { useState } from 'preact/hooks';
import { ContextHelp } from '../../shell/ContextHelp.ts';
import { uiLevel } from '../jobWorkflow.ts';
import { bedIsPlaceholder, bedOf, saveMachineBed, type MachineProfile } from '../library.ts';
import { CATALOGUE } from '../machineDrawings.ts';
import { BED_TOP_PURPOSE, bedTag } from '../revisionWords.ts';

export function BedSection({ machine }: { readonly machine: MachineProfile }): ComponentChild {
  const bed = bedOf(machine);
  const [note, setNote] = useState<string | null>(null);
  const save = (patch: Partial<Pick<typeof bed, 'width' | 'depth' | 'thickness'>> & { readonly z?: number }): void => {
    const { z, ...dims } = patch;
    const saved = saveMachineBed(machine.id, { ...bed, ...dims, toMachine: z === undefined ? bed.toMachine : { ...bed.toMachine, z }, source: { kind: 'measured', note: 'Entered in Machines.', at: new Date().toISOString() } });
    if (saved !== null) setNote(uiLevel.value.value === 'advanced' ? `Saved · bed revision ${saved.revision}` : 'Saved');
  };
  const numField = (label: string, value: number, onChange: (n: number) => void, limits: readonly [number, number?]): ComponentChild =>
    h('label', { class: 'field', key: label }, h('span', null, label), h('span', { class: 'unit-input' }, h('input', { type: 'number', min: limits[0], step: limits[1] ?? 1, value, 'aria-label': `${label}, bed`, onChange: (e: Event) => { const n = Number.parseFloat((e.currentTarget as HTMLInputElement).value); if (Number.isFinite(n) && n >= limits[0]) onChange(n); } }), h('i', null, 'mm')));
  const placeholder = bedIsPlaceholder(bed);
  return h(
    'div',
    { class: 'machine-bed', 'data-machine': 'bed', 'data-bed': placeholder ? 'placeholder' : bed.source.kind, 'data-bed-revision': String(bed.revision) },
    h('div', { class: 'bed-head' }, h('h3', null, 'Bed'), h('span', { class: `tag${placeholder ? '' : ' ok'}`, 'data-machine': 'bed-tag' }, bedTag(bed, CATALOGUE.find((t) => t.id === machine.templateId)?.name ?? machine.name)), uiLevel.value.value === 'advanced' ? h('span', { class: 'fine' }, bed.revision === 0 ? 'no revision saved yet' : `revision ${bed.revision}`) : null),
    // What the bed top's height is for, said plainly (owner, 2026-11-09).
    h('p', { class: 'fine', 'data-machine': 'bed-purpose' }, BED_TOP_PURPOSE),
    h('div', { class: 'machine-bed-fields' }, numField('Width', bed.width, (width) => save({ width }), [1]), numField('Depth', bed.depth, (depth) => save({ depth }), [1]), numField('Thickness', bed.thickness, (thickness) => save({ thickness }), [0.1, 0.5]), numField('Bed top, machine Z', bed.toMachine.z, (z) => save({ z }), [-100000, 0.1])),
    h(ContextHelp, { id: 'machine-bed-help', label: 'About this bed' },
      bed.source.kind === 'placeholder' ? bed.source.note : bed.source.kind === 'measured' ? `${bed.source.note} ${dateText(bed.source.at)}` : `From ${bed.source.file}, ${bed.source.units}, ${dateText(bed.source.at)}.`,
      ' Bed coordinates start at the front-left corner of the bed’s top. Bed top is its machine Z position. Import a bed drawing from Projects → Use in Job. Saved jobs keep their pinned bed revision until you update them.'),
    h(BedGridForm, { key: machine.id, machine }),
    note === null ? null : h('p', { class: 'fine', role: 'status', 'data-machine': 'bed-note' }, note),
  );
}

function dateText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

