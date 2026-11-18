/**
 * The setup wizard's frame (spec §6.2): one 960 × 520 dialog over the front door's scrim, the rail on the left,
 * the step's heading, lead and body in the content area, and a footer with "Skip for now" (skippable steps only)
 * and the primary action above a rule. The frame never changes size between steps; a body that needs more room
 * scrolls inside `.wizard-body`. Pure: the mount (SetupWizard.ts) decides what goes in.
 */
import { h, type ComponentChild, type ComponentChildren } from 'preact';
import { WizardRail } from './WizardRail.ts';
import type { RailMark, StepId } from './wizardState.ts';

export interface FrameProps {
  readonly step: StepId;
  readonly marks: readonly RailMark[];
  readonly title: string;
  readonly lead: string;
  readonly primary: { readonly label: string; readonly onClick: () => void; readonly disabled?: boolean };
  /** Null for a step that cannot be skipped. */
  readonly onSkip: (() => void) | null;
  readonly onClose: () => void;
  /** A whole-page layer over the frame (the catalog page, the tool editor), inside the wizard's dialog. */
  readonly overlay?: ComponentChild;
  readonly children?: ComponentChildren;
}

export const CLOSE_LABEL = 'Close setup';
export const SKIP_LABEL = 'Skip for now';

export function WizardFrame(p: FrameProps): ComponentChild {
  return h(
    'div',
    null,
    h('div', { class: 'gate-scrim', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'wizard', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wizard-title', 'data-wizard-step': String(p.step) },
      h(
        'div',
        // Not the shared `.dialog`: its `p` and field rules would reach the step content, and a hosted dialog's own
        // `.dialog` rules would be matched by the frame.
        { class: 'wizard-dialog' },
        h(WizardRail, { marks: p.marks, current: p.step }),
        h(
          'section',
          { class: 'wizard-content' },
          h('h2', { id: 'wizard-title', class: 'wizard-title', tabindex: -1 }, p.title),
          p.lead === '' ? null : h('p', { class: 'wizard-lead' }, p.lead),
          h('div', { class: 'wizard-body' }, p.children),
          h(
            'footer',
            { class: 'wizard-foot' },
            p.onSkip === null ? h('span', null) : h('button', { type: 'button', class: 'quiet', 'data-action': 'wizard-skip', onClick: p.onSkip }, SKIP_LABEL),
            h('button', { type: 'button', class: 'primary', 'data-action': 'wizard-next', disabled: p.primary.disabled === true, onClick: p.primary.onClick }, p.primary.label),
          ),
        ),
        h('button', { type: 'button', class: 'small quiet wizard-close', 'data-action': 'wizard-close', 'aria-label': CLOSE_LABEL, onClick: p.onClose }, CLOSE_LABEL),
      ),
      p.overlay ?? null,
    ),
  );
}
