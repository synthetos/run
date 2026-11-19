/**
 * Library → Machines, editing a machine: what is wired to the coolant output (owner, 2026-11-18, picture 152), the
 * same choice as Board → the coolant pin and the setup wizard's step 4, saved on the machine record.
 */
import { h, type ComponentChild } from 'preact';
import type { MachineCoolant, MachineProfile } from '@synthetos/library';
import { COOLANT_WIRING } from '../coolant.ts';

const isCoolant = (v: string): v is MachineCoolant => COOLANT_WIRING.some(([k]) => k === v);

export function MachineCoolantField({ machine, update }: { readonly machine: MachineProfile; readonly update: (patch: Partial<MachineProfile>) => void }): ComponentChild {
  const p = { value: machine.coolant ?? null, onChange: (coolant: MachineCoolant): void => update({ coolant }) };
  return h(
    'label',
    { class: 'field' },
    h('span', null, 'Coolant output'),
    h(
      'span',
      { class: 'select-wrap' },
      h(
        'select',
        { 'aria-label': 'What is wired to the coolant output', 'data-machine-field': 'coolant', value: p.value ?? '', onChange: (e: Event) => { const v = (e.currentTarget as HTMLSelectElement).value; if (isCoolant(v)) p.onChange(v); } },
        p.value === null ? h('option', { value: '' }, 'Not set') : null,
        COOLANT_WIRING.map(([value, label]) => h('option', { key: value, value }, label)),
      ),
    ),
  );
}
