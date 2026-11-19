/**
 * Step 4's coolant question (owner, 2026-11-18, picture 152: "a step in the wizard to ask if the board using the
 * coolant feature and if yes flood or mist"): what is wired to the board's coolant output, saved on the machine
 * step 2 created (MachineProfile.coolant). No board is needed: it is a fact about the machine, not a TinyG setting.
 * Four compact radio cards (PickCard.ts, the homing cards' layout) in two columns, at most 440 px wide.
 */
import { h, type ComponentChild } from 'preact';
import type { MachineCoolant } from '@synthetos/library';
import { COOLANT_WIRING } from '../workspace/coolant.ts';
import { PickCard } from './PickCard.ts';

export const COOLANT_QUESTION = 'What is wired to the coolant output?';
export const COOLANT_NEEDS_MACHINE = 'Save your machine in step 2 to record what is wired to its coolant output.';

export interface CoolantQuestionProps {
  readonly coolant: MachineCoolant | null;
  /** Null when there is no machine to save it on (step 2 was skipped). */
  readonly onCoolant: ((c: MachineCoolant) => void) | null;
}

export function CoolantQuestion(p: CoolantQuestionProps): ComponentChild {
  if (p.onCoolant === null) return h('p', { class: 'wizard-line', 'data-wizard': 'coolant-needs-machine' }, COOLANT_NEEDS_MACHINE);
  const choose = p.onCoolant;
  return h(
    'fieldset',
    { class: 'wizard-coolant', 'data-wizard': 'coolant' },
    h('legend', { class: 'wizard-question' }, COOLANT_QUESTION),
    h('div', { class: 'wizard-coolant-cards' }, COOLANT_WIRING.map(([value, label]) => h(PickCard, { key: value, name: 'wizard-coolant', value, title: label, checked: p.coolant === value, onChange: () => choose(value) }))),
  );
}
