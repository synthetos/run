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
import type { MachineCoolant, MachineProfile } from '@synthetos/library';
import { projectsState } from '../projects/store.ts';
import { saveSetup } from '../workspace/cloud/setupSync.ts';
import { machineStore, selectedMachineStore, toolStore, updateMachine, type ToolEntry } from '../workspace/library.ts';
import { connected } from '../workspace/model.ts';
import { boardLabel } from '../workspace/status.ts';
import { CATALOGUE, type MachineTemplate } from '../workspace/machineDrawings.ts';
import { boardOwner, draftFromMachine, draftFromTemplate, draftValid, saveDraft, type MachineDraft } from './machineDraft.ts';
import { firmwareGate, firmwareState } from './firmwareStep.ts';
import { closeSetup, finishStep, setupAway, skipStep } from './setupActions.ts';
import { Done, DONE_LEAD, DONE_TITLE } from './steps/Done.ts';
import { Firmware, FIRMWARE_LEAD, FIRMWARE_TITLE, firmwareUpdating, startUpdate } from './steps/Firmware.ts';
import { boardMismatch } from './homingStep.ts';
import { Homing, HOMING_LEAD, HOMING_TITLE } from './steps/Homing.ts';
import { createDemo, createNamed, openExisting, type CreateResult } from './createDemo.ts';
import { CREATE_LABEL, FirstProject, PROJECT_LEAD, PROJECT_TITLE, projectBusy, projectChoice, projectError, projectName, type ProjectChoice } from './steps/FirstProject.ts';
import { newToolSince } from './toolChoice.ts';
import { catalogFrom, closeCatalog, creatingTool, Tools, TOOLS_LEAD, TOOLS_TITLE, toolsBefore } from './steps/Tools.ts';
import { CatalogPage } from './CatalogPage.ts';
import { ToolModal } from '../workspace/views/tools/ToolModal.ts';
import { liveBoardId, Machine, MACHINE_LEAD, MACHINE_TITLE, machineDraft } from './steps/Machine.ts';
import { Welcome, WELCOME_LEAD, WELCOME_TITLE } from './steps/Welcome.ts';
import { WizardFrame } from './WizardFrame.ts';
import { currentStep, NEXT_LABEL, railMarks, STEPS, wizardOpen, type StepId } from './wizardState.ts';

/** Open by R1, unless the person stepped out to Board → Firmware from step 3 (setupActions.ts setupAway). */
export const wizardShowing = computed(() => wizardOpen(pageGate(), setupView.value) && !setupAway.value);

export interface WizardContext {
  readonly model: WorkspaceModel | null;
  readonly onView: (v: string) => void;
}

interface StepView {
  readonly title: string; readonly lead: string; readonly body: ComponentChild;
  readonly nextDisabled?: boolean; readonly next?: () => void; readonly nextLabel?: string | undefined;
  /** Overrides the step definition (the firmware step is not skippable while an update is needed). */
  readonly skippable?: boolean;
  /** A whole-page layer over the frame (step 5's catalog page or tool editor). */
  readonly overlay?: ComponentChild;
  /** The overlay covers the frame (the catalog page): the frame is inert under it. */
  readonly inertFrame?: boolean;
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

/** Step 3: the offer decides; `needed` and `updating` hide Skip and hold Next; another board than the machine's refuses. */
function firmwareStepView(ctx: WizardContext): StepView {
  const view = ctx.model?.live.value ?? null;
  const state = firmwareState(view, firmwareUpdating.value);
  const gate = firmwareGate(state);
  const machine = machineStore.value.value.find((m) => m.id === setupView.value.record?.machineId) ?? null;
  const mismatch = boardMismatch(liveBoardId(ctx.model), machine);
  const body = h(Firmware, { model: ctx.model, state, updating: firmwareUpdating.value, onUpdate: () => startUpdate(state), board: view !== null && connected(view) ? boardLabel(view) : null, mismatch });
  return { title: FIRMWARE_TITLE, lead: FIRMWARE_LEAD, body, nextDisabled: !gate.nextEnabled || mismatch !== null, skippable: gate.skippable };
}

/**
 * Step 4: the homing choice is written as it is made (R3); the step refuses another board than the machine's. The
 * coolant answer goes on the step-2 machine record (owner 152), so the Job page's toggle is named by it.
 */
function homingStepView(ctx: WizardContext): StepView {
  const record = setupView.value.record;
  const machine = machineStore.value.value.find((m) => m.id === record?.machineId) ?? null;
  const coolant = { coolant: machine?.coolant ?? null, onCoolant: machine === null ? null : (c: MachineCoolant) => { updateMachine(machine.id, { coolant: c }); } };
  const body = h(Homing, { model: ctx.model, choice: record?.homing ?? null, onChoice: (c) => saveSetup({ homing: c }), mismatch: boardMismatch(liveBoardId(ctx.model), machine), ...coolant });
  return { title: HOMING_TITLE, lead: HOMING_LEAD, body, nextDisabled: (record?.homing ?? null) === null };
}

/** The tool added since step 5 opened, or null (the mount writes it to the record from an effect, never in render). */
export function addedTool(): ToolEntry | null {
  const tools = toolStore.value.value;
  return newToolSince(toolsBefore.value ?? tools, tools);
}

/**
 * Step 5's effect: a wizard that resumed on step 5 (no Next pressed) captures the tool list it opened with; the
 * tool added since becomes the record's choice; a tool added from the catalog page closes it (owner 147).
 */
function syncToolChoice(onStep5: boolean, tools: readonly ToolEntry[]): void {
  if (!onStep5) return;
  if (toolsBefore.peek() === null) toolsBefore.value = tools;
  const added = addedTool();
  if (added !== null && setupView.peek().record?.toolId !== added.tool.id) saveSetup({ toolId: added.tool.id });
  const from = catalogFrom.peek();
  if (from !== null && newToolSince(from, tools) !== null) closeCatalog();
}

/** Step 5's layer over the frame: the catalog page, or the tool editor (both above the frame, never cut to it). */
function toolsOverlay(): ComponentChild {
  if (catalogFrom.value !== null) return h(CatalogPage, { onBack: closeCatalog });
  return creatingTool.value ? h(ToolModal, { entry: null, onClose: () => { creatingTool.value = false; } }) : null;
}

/** Step 5 (OD-42: tools only): the tool added while the step is open, or the record's. */
function toolsStepView(): StepView {
  const record = setupView.value.record;
  const tools = toolStore.value.value;
  const added = addedTool();
  const tool = tools.find((e) => e.tool.id === (added?.tool.id ?? record?.toolId)) ?? null;
  const body = h(Tools, { tool, onCatalog: () => { catalogFrom.value = toolStore.value.peek(); }, onCreate: () => { creatingTool.value = true; } });
  return { title: TOOLS_TITLE, lead: TOOLS_LEAD, body, overlay: toolsOverlay(), inertFrame: catalogFrom.value !== null };
}

/** The demo (with its own built-in stock), or the project a refused earlier press already made (never a second one). */
function makeProject(choice: ProjectChoice): Promise<CreateResult> {
  const record = setupView.peek().record;
  if (choice === 'new') return createNamed(projectName.peek());
  return record?.projectId == null ? createDemo() : openExisting(record.projectId);
}

/** Step 6: "Open project" makes the demo or an empty named project, then moves on. */
function projectStepView(): StepView {
  const choice = projectChoice.value;
  const create = async (): Promise<void> => {
    if (projectBusy.peek()) return;
    projectBusy.value = true; projectError.value = null;
    try {
      const made = await makeProject(choice);
      if (made.ok) finishStep(6, { projectId: made.projectId });
      else {
        // The project exists even when its file could not open: remember it so a retry opens it instead.
        if (made.projectId !== null) saveSetup({ projectId: made.projectId });
        projectError.value = made.reason;
      }
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
    case 5: return toolsStepView();
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

/**
 * A step's own state starts fresh when the step is left (Next, Skip, Close), synchronously in the handler: an
 * effect on the step change ran after paint and could reset a draft the person had already started editing.
 * `entering` captures the tool list for step 5's "added since" check; leaving the wizard clears it.
 */
function resetStepState(entering: boolean): void {
  machineDraft.value = null;
  firmwareUpdating.value = false;
  catalogFrom.value = null; creatingTool.value = false;
  projectError.value = null; projectBusy.value = false;
  toolsBefore.value = entering ? toolStore.value.peek() : null;
}

export function SetupWizard(p: WizardContext): ComponentChild {
  const showing = wizardShowing.value;
  const record = setupView.value.record;
  const step = currentStep(record);
  // Keyboard first: every step starts on its heading.
  useEffect(() => {
    if (showing && typeof document !== 'undefined') document.getElementById('wizard-title')?.focus();
  }, [showing, step]);
  // Step 5: the tool added while the step is open becomes the choice, written outside render.
  const tools = toolStore.value.value;
  useEffect(() => { syncToolChoice(step === 5 && showing, tools); }, [tools, step, showing]);
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
      primary: { label: view.nextLabel ?? NEXT_LABEL[step], onClick: () => { const go = view.next ?? (() => finishStep(step)); resetStepState(true); go(); }, disabled: view.nextDisabled === true },
      onSkip: skippable ? () => { resetStepState(true); skipStep(step); } : null,
      onClose: () => { resetStepState(false); closeSetup(); },
      overlay: view.overlay,
      inertFrame: view.inertFrame === true,
    },
    view.body,
  );
}
