/**
 * Board → the coolant pin: what is wired to the output (owner, 2026-11-18, picture 152: "go to board and set this as
 * flood or mist? this way the ui would auto set the button to the right text"). TinyG has no such setting, so the
 * choice is saved with the machine chosen on the Job page (the account record), never written to the board, and so
 * it is not gated by settings writes. The Job page's coolant toggle takes its name from it (coolant.ts).
 */
import { h, type ComponentChild } from 'preact';
import type { MachineCoolant, MachineProfile } from '@synthetos/library';
import { COOLANT_WIRING } from '../../coolant.ts';
import { selectedMachine, updateMachine } from '../../library.ts';

export const WIRED_TO = 'Wired to';
export const CHOOSE_MACHINE_FIRST = 'Choose a machine on the Job page first.';

export function CoolantWiring(p: { readonly machine: MachineProfile | null; readonly onChoose: (c: MachineCoolant) => void }): ComponentChild {
  if (p.machine === null) return h('p', { class: 'fine', 'data-coolant-wiring': 'no-machine' }, CHOOSE_MACHINE_FIRST);
  const current = p.machine.coolant ?? null;
  return h(
    'fieldset',
    { class: 'coolant-wiring', 'data-coolant-wiring': current ?? 'unset' },
    h('legend', null, WIRED_TO),
    COOLANT_WIRING.map(([value, label]) =>
      h('label', { key: value, class: 'coolant-choice' }, h('input', { type: 'radio', name: 'coolant-wiring', value, checked: current === value, onChange: () => p.onChoose(value) }), h('span', null, label)),
    ),
    h('p', { class: 'fine' }, `Saved with the machine ${p.machine.name}. TinyG does not know what is wired to its output.`),
  );
}

/** The panel on the Board's coolant pin: the chosen machine, and the write to its record. */
export function CoolantWiringPanel(): ComponentChild {
  const machine = selectedMachine.value;
  return h(CoolantWiring, { machine, onChoose: (coolant) => { if (machine !== null) updateMachine(machine.id, { coolant }); } });
}
