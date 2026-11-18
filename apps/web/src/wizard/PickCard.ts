/**
 * The wizard's radio card (spec §6.3 steps 4 and 6): the radio at the left, level with the title, the title and
 * its description left-aligned beside it, the card at most 440 px wide (wizard.css `.wizard-pick`). Extra content
 * (a field the choice opens) goes under the description in the same column.
 */
import { h, type ComponentChild, type ComponentChildren } from 'preact';

export interface PickCardProps {
  readonly name: string;
  readonly value: string;
  readonly title: string;
  readonly text: string;
  readonly checked: boolean;
  readonly onChange: () => void;
  readonly children?: ComponentChildren;
}

export function PickCard(p: PickCardProps): ComponentChild {
  return h(
    'label',
    { class: 'wizard-pick' },
    h('input', { type: 'radio', class: 'wizard-pick-radio', name: p.name, value: p.value, checked: p.checked, onChange: p.onChange }),
    h('strong', { class: 'wizard-pick-title' }, p.title),
    h('span', { class: 'wizard-pick-text' }, p.text),
    p.children,
  );
}
