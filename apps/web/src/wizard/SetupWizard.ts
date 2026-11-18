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
import type { MachineProfile } from '@synthetos/library';
import { projectsState } from '../projects/store.ts';
import { saveSetup } from '../workspace/cloud/setupSync.ts';
import { machineStore, selectedMachineStore } from '../workspace/library.ts';
import { CATALOGUE, type MachineTemplate } from '../workspace/machineDrawings.ts';
import { boardOwner, draftFromMachine, draftFromTemplate, draftValid, saveDraft, type MachineDraft } from './machineDraft.ts';
import { firmwareGate, firmwareState } from './firmwareStep.ts';
import { closeSetup, finishStep, skipStep } from './setupActions.ts';
import { Done, DONE_LEAD, DONE_TITLE } from './steps/Done.ts';
import { Firmware, FIRMWARE_LEAD, FIRMWARE_TITLE, firmwareUpdating, startUpdate } from './steps/Firmware.ts';
import { liveBoardId, Machine, MACHINE_LEAD, MACHINE_TITLE, machineDraft } from './steps/Machine.ts';
import { Welcome, WELCOME_LEAD, WELCOME_TITLE } from './steps/Welcome.ts';
import { WizardFrame } from './WizardFrame.ts';
import { currentStep, NEXT_LABEL, railMarks, STEPS, wizardOpen, type StepId } from './wizardState.ts';

export const wizardShowing = computed(() => wizardOpen(pageGate(), setupView.value));

export interface WizardContext {
  readonly model: WorkspaceModel | null;
  readonly onView: (v: string) => void;
}

interface StepView {
  readonly title: string; readonly lead: string; readonly body: ComponentChild;
  readonly nextDisabled?: boolean; readonly next?: () => void;
  /** Overrides the step definition (the firmware step is not skippable while an update is needed). */
  readonly skippable?: boolean;
}

/** Step 7's primary: the wizard is over; it never opens again on its own (Preferences brings it back). */
function finishWizard(ctx: WizardContext): void {
  finishStep(7, { dismissed: true });
  ctx.onView('job');
}

/** Step 2: the draft from the record's machine (resume) or the first template; Next saves and binds the board. */
function machineStep(ctx: WizardContext): StepView {
  const record = setupView.value.record;
  const machines = machineStore.value.value;
  const draft = machineDraft.value ?? draftFor(record?.machineId ?? null, machines);
  const boardId = liveBoardId(ctx.model);
  const owner = boardOwner(boardId, machines);
  const body = h(Machine, {
    model: ctx.model, draft, onDraft: (d) => { machineDraft.value = d; },
    owner: owner !== null && owner.id !== record?.machineId ? owner : null,
    onUseOwner: (m) => { machineDraft.value = draftFromMachine(m); selectedMachineStore.set(m.id); saveSetup({ machineId: m.id }); },
  });
  return { title: MACHINE_TITLE, lead: MACHINE_LEAD, body, nextDisabled: !draftValid(draft), next: () => { const id = saveDraft(draft, record?.machineId ?? null, boardId); finishStep(2, { machineId: id }); } };
}

function draftFor(machineId: string | null, machines: readonly MachineProfile[]): MachineDraft {
  const mine = machines.find((m) => m.id === machineId);
  return mine === undefined ? draftFromTemplate(CATALOGUE[0] as MachineTemplate) : draftFromMachine(mine);
}

/** Step 3: the offer decides; `needed` hides Skip and holds Next (the frame reads `skippable` from here). */
function firmwareStepView(ctx: WizardContext): StepView {
  const state = firmwareState(ctx.model?.live.value ?? null);
  const gate = firmwareGate(state);
  const body = h(Firmware, { model: ctx.model, state, updating: firmwareUpdating.value, onUpdate: () => startUpdate(state) });
  return { title: FIRMWARE_TITLE, lead: FIRMWARE_LEAD, body, nextDisabled: !gate.nextEnabled, skippable: gate.skippable };
}

/** The step's content; each step module fills its own case. */
function stepView(step: StepId, ctx: WizardContext): StepView {
  switch (step) {
    case 1: return { title: WELCOME_TITLE, lead: WELCOME_LEAD, body: h(Welcome, null) };
    case 2: return machineStep(ctx);
    case 3: return firmwareStepView(ctx);
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
  // Keyboard first: every step starts on its heading. A step's own draft starts fresh each time it opens.
  useEffect(() => {
    machineDraft.value = null;
    firmwareUpdating.value = false;
    if (showing && typeof document !== 'undefined') document.getElementById('wizard-title')?.focus();
  }, [showing, step]);
  if (!showing) return null;
  const view = stepView(step, p);
  const skippable = view.skippable ?? STEPS[step - 1]?.skippable === true;
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
