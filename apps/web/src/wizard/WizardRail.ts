/**
 * The wizard's left rail (spec §6.2): the run wordmark at 26 px and the seven steps as a numbered list. A done
 * step shows a green check, the current step a filled blue number, a later step a hollow number. Below 1024 px
 * the CSS collapses the list to seven dots and shows the current step's name (`.wizard-dot-name`).
 */
import { h, type ComponentChild } from 'preact';
import { RunWordmark } from '../brand/RunWordmark.ts';
import { Icon } from '../workspace/icons.ts';
import { STEPS, type RailMark, type StepId } from './wizardState.ts';

export function WizardRail(p: { readonly marks: readonly RailMark[]; readonly current: StepId }): ComponentChild {
  return h(
    'nav',
    { class: 'wizard-rail', 'aria-label': 'Setup steps' },
    h(RunWordmark, { height: 26, label: 'run' }),
    h(
      'ol',
      { class: 'wizard-steps' },
      STEPS.map((s, i) => {
        const mark = p.marks[i] ?? 'later';
        return h(
          'li',
          { key: s.id, 'data-mark': mark, 'aria-current': mark === 'current' ? 'step' : undefined },
          h('span', { class: 'wizard-step-mark', 'aria-hidden': 'true' }, mark === 'done' ? Icon('check', 12) : String(s.id)),
          h('span', { class: 'wizard-step-label' }, s.label),
        );
      }),
    ),
    h('p', { class: 'wizard-dot-name' }, STEPS.find((s) => s.id === p.current)?.label ?? ''),
  );
}
