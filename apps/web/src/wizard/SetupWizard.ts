/**
 * The setup wizard's mount (spec §6): decides from the page's gate and the account's setup record whether the
 * wizard shows (wizardState.ts R1), which step is current, and renders that step inside the frame. It is a
 * sibling of the sign-in gate in AppShell, never inside the inert app root; the two never show at once because
 * the wizard needs a signed-in account and the gate is open then.
 */
import { computed } from '@preact/signals';
import { h, type ComponentChild } from 'preact';
import { useEffect } from 'preact/hooks';
import { pageGate } from '../gate/SignInGate.ts';
import { setupView } from '../workspace/cloud/setupSync.ts';
import type { WorkspaceModel } from '../workspace/model.ts';
import { projectsState } from '../projects/store.ts';
import { closeSetup, finishStep, skipStep } from './setupActions.ts';
import { Done, DONE_LEAD, DONE_TITLE } from './steps/Done.ts';
import { Welcome, WELCOME_LEAD, WELCOME_TITLE } from './steps/Welcome.ts';
import { WizardFrame } from './WizardFrame.ts';
import { currentStep, NEXT_LABEL, railMarks, STEPS, wizardOpen, type StepId } from './wizardState.ts';

export const wizardShowing = computed(() => wizardOpen(pageGate(), setupView.value));

export interface WizardContext {
  readonly model: WorkspaceModel | null;
  readonly onView: (v: string) => void;
}

interface StepView { readonly title: string; readonly lead: string; readonly body: ComponentChild; readonly nextDisabled?: boolean; readonly next?: () => void }

/** Step 7's primary: the wizard is over; it never opens again on its own (Preferences brings it back). */
function finishWizard(ctx: WizardContext): void {
  finishStep(7, { dismissed: true });
  ctx.onView('job');
}

/** The step's content; each step module fills its own case. */
function stepView(step: StepId, ctx: WizardContext): StepView {
  switch (step) {
    case 1: return { title: WELCOME_TITLE, lead: WELCOME_LEAD, body: h(Welcome, null) };
    case 7: {
      const id = setupView.value.record?.projectId ?? null;
      const name = id === null ? null : projectsState.value.list.find((p) => p.id === id)?.name ?? null;
      return { title: DONE_TITLE, lead: DONE_LEAD, body: h(Done, { projectName: name, onView: ctx.onView }), next: () => finishWizard(ctx) };
    }
    default: return { title: STEPS[step - 1]?.label ?? '', lead: '', body: null };
  }
}

export function SetupWizard(p: WizardContext): ComponentChild {
  const showing = wizardShowing.value;
  const record = setupView.value.record;
  const step = currentStep(record);
  // Keyboard first: every step starts on its heading.
  useEffect(() => {
    if (showing && typeof document !== 'undefined') document.getElementById('wizard-title')?.focus();
  }, [showing, step]);
  if (!showing) return null;
  const view = stepView(step, p);
  const skippable = STEPS[step - 1]?.skippable === true;
  return h(
    WizardFrame,
    {
      step,
      marks: railMarks(record),
      title: view.title,
      lead: view.lead,
      primary: { label: NEXT_LABEL[step], onClick: view.next ?? (() => finishStep(step)), disabled: view.nextDisabled === true },
      onSkip: skippable ? () => skipStep(step) : null,
      onClose: closeSetup,
    },
    view.body,
  );
}
