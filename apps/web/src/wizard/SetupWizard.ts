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
import { machineStore, selectedMachineStore, toolStore } from '../workspace/library.ts';
import { CATALOGUE, type MachineTemplate } from '../workspace/machineDrawings.ts';
import { boardOwner, draftFromMachine, draftFromTemplate, draftValid, saveDraft, type MachineDraft } from './machineDraft.ts';
import { firmwareGate, firmwareState } from './firmwareStep.ts';
import { closeSetup, finishStep, skipStep } from './setupActions.ts';
import { Done, DONE_LEAD, DONE_TITLE } from './steps/Done.ts';
import { Firmware, FIRMWARE_LEAD, FIRMWARE_TITLE, firmwareUpdating, startUpdate } from './steps/Firmware.ts';
import { boardMismatch } from './homingStep.ts';
import { Homing, HOMING_LEAD, HOMING_TITLE } from './steps/Homing.ts';
import { createDemo, createNamed } from './createDemo.ts';
import { CREATE_LABEL, FirstProject, PROJECT_LEAD, PROJECT_TITLE, projectBusy, projectChoice, projectError, projectName } from './steps/FirstProject.ts';
import { fieldsFromStock, newToolSince, stockFromFields } from './stockFields.ts';
import { catalogOpen, creatingTool, stockFields, ToolsStock, TOOLS_LEAD, TOOLS_TITLE, toolsBefore } from './steps/ToolsStock.ts';
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
  readonly nextDisabled?: boolean; readonly next?: () => void; readonly nextLabel?: string | undefined;
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

/** Step 4: the choice is written as it is made (R3); the step refuses another board than the machine's. */
function homingStepView(ctx: WizardContext): StepView {
  const record = setupView.value.record;
  const machine = machineStore.value.value.find((m) => m.id === record?.machineId) ?? null;
  const body = h(Homing, { model: ctx.model, choice: record?.homing ?? null, onChoice: (c) => saveSetup({ homing: c }), mismatch: boardMismatch(liveBoardId(ctx.model), machine) });
  return { title: HOMING_TITLE, lead: HOMING_LEAD, body, nextDisabled: (record?.homing ?? null) === null };
}

/** Step 5: the tool added while the step is open and the stock saved to the record; both written as they happen. */
function toolsStockStepView(): StepView {
  const record = setupView.value.record;
  const tools = toolStore.value.value;
  const before = toolsBefore.value ?? tools;
  const added = newToolSince(before, tools);
  if (added !== null && record?.toolId !== added.tool.id) saveSetup({ toolId: added.tool.id });
  const tool = tools.find((e) => e.tool.id === (added?.tool.id ?? record?.toolId)) ?? null;
  const fields = stockFields.value ?? fieldsFromStock(record?.stock ?? null);
  const body = h(ToolsStock, {
    tool, stock: record?.stock ?? null, fields, onFields: (f) => { stockFields.value = f; },
    onAddStock: () => { const stock = stockFromFields(fields); if (stock !== null) saveSetup({ stock }); },
    onCatalog: () => { catalogOpen.value = true; }, onCreate: () => { creatingTool.value = true; },
    catalogOpen: catalogOpen.value, creating: creatingTool.value, onCloseModal: () => { catalogOpen.value = false; creatingTool.value = false; },
  });
  return { title: TOOLS_TITLE, lead: TOOLS_LEAD, body };
}

/** Step 6: "Open project" makes the demo (with the stock from step 5) or an empty named project, then moves on. */
function projectStepView(): StepView {
  const choice = projectChoice.value;
  const create = async (): Promise<void> => {
    if (projectBusy.peek()) return;
    projectBusy.value = true; projectError.value = null;
    try {
      const made = choice === 'demo' ? await createDemo(undefined, setupView.peek().record?.stock ?? null) : await createNamed(projectName.peek());
      if (made.ok) finishStep(6, { projectId: made.projectId });
      else projectError.value = made.reason;
    } catch (error) {
      projectError.value = error instanceof Error ? error.message : 'The project could not be created.';
    } finally { projectBusy.value = false; }
  };
  const body = h(FirstProject, { choice, onChoice: (c) => { projectChoice.value = c; }, name: projectName.value, onName: (n) => { projectName.value = n; }, error: projectError.value });
  return { title: PROJECT_TITLE, lead: PROJECT_LEAD, body, nextLabel: choice === 'new' ? CREATE_LABEL : undefined, nextDisabled: projectBusy.value, next: () => { void create(); } };
}

/** The step's content; each step module fills its own case. */
function stepView(step: StepId, ctx: WizardContext): StepView {
  switch (step) {
    case 1: return { title: WELCOME_TITLE, lead: WELCOME_LEAD, body: h(Welcome, null) };
    case 2: return machineStep(ctx);
    case 3: return firmwareStepView(ctx);
    case 4: return homingStepView(ctx);
    case 5: return toolsStockStepView();
    case 6: return projectStepView();
    default: return doneStepView(ctx);
  }
}

/** Step 7: the project the wizard made, by the record's id. */
function doneStepView(ctx: WizardContext): StepView {
  const id = setupView.value.record?.projectId ?? null;
  const made = id === null ? null : projectsState.value.list.find((p) => p.id === id) ?? null;
  const body = h(Done, { projectName: made?.name ?? null, hasFile: (made?.files.length ?? 0) > 0, onView: ctx.onView });
  return { title: DONE_TITLE, lead: DONE_LEAD, body, next: () => finishWizard(ctx) };
}

export function SetupWizard(p: WizardContext): ComponentChild {
  const showing = wizardShowing.value;
  const record = setupView.value.record;
  const step = currentStep(record);
  // Keyboard first: every step starts on its heading. A step's own draft starts fresh each time it opens.
  useEffect(() => {
    machineDraft.value = null;
    firmwareUpdating.value = false;
    stockFields.value = null; catalogOpen.value = false; creatingTool.value = false;
    projectError.value = null; projectBusy.value = false;
    toolsBefore.value = step === 5 ? toolStore.value.peek() : null;
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
      primary: { label: view.nextLabel ?? NEXT_LABEL[step], onClick: view.next ?? (() => finishStep(step)), disabled: view.nextDisabled === true },
      onSkip: skippable ? () => skipStep(step) : null,
      onClose: closeSetup,
    },
    view.body,
  );
}
