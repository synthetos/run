import { computed, signal } from '@preact/signals';
import { currentFile, type OpenFile } from './fileBridge.ts';
import { material, selectedMachine, toolStore } from './library.ts';
import { advisorCheck, advisorFile, advisorMachine, advisorRow, type AdvisorFields } from './advisorModel.ts';
import { activeJob, SEED_JOB } from './jobModel.ts';
import { isObject, stored } from './storage.ts';

const validFields = (v: unknown): v is Record<string, AdvisorFields> => isObject(v) && Object.values(v).every((f) => isObject(f) && Object.values(f).every((s) => typeof s === 'string'));
/** Supplements only: existing profile axis limits always take precedence. */
export const advisorProfiles = stored<Record<string, AdvisorFields>>('advisor.profiles.v1', {}, validFields);
export const advisorEngine = signal<'rules' | 'mock-ai'>('rules');
const operationInputs = signal<{ file: OpenFile | null; fields: Record<string, AdvisorFields> }>({ file: null, fields: {} });
export const advisorOperations = computed(() => {
  const preview = currentFile.value?.preview;
  return preview === undefined ? { operations: [], problem: null } : advisorFile(preview);
});
/** The active job's stock material (the Job record owns the setup; the seed draft before any job exists). */
export const advisorStock = computed(() => material((activeJob.value ?? SEED_JOB).setup.stock.materialRef.id));
export const machineFields = computed(() => advisorProfiles.value.value[selectedMachine.value?.id ?? ''] ?? {});
export const machineInput = computed(() => advisorMachine(selectedMachine.value, machineFields.value));
export function operationFields(id: string): AdvisorFields {
  return operationInputs.value.file === currentFile.value ? operationInputs.value.fields[id] ?? {} : {};
}
export function setOperationField(id: string, key: string, value: string): void {
  const fields = operationInputs.value.file === currentFile.value ? operationInputs.value.fields : {};
  operationInputs.value = { file: currentFile.value, fields: { ...fields, [id]: { ...fields[id], [key]: value } } };
}
export function setMachineField(key: string, value: string): void {
  const id = selectedMachine.value?.id;
  if (id === undefined) return;
  advisorProfiles.set({ ...advisorProfiles.value.value, [id]: { ...machineFields.value, [key]: value } });
}
export const advisorRows = computed(() => {
  const file = advisorOperations.value;
  const input = machineInput.value;
  return file.operations.map((o) => advisorRow(o, operationFields(o.id), input.machine, advisorStock.value, toolStore.value.value, file.problem, input.problem));
});
export const advisorSummary = computed(() => advisorOperations.value.problem === null ? advisorCheck(advisorRows.value) : 'Feeds: resolve the file findings in Job');

/**
 * The tool the user said is already in the spindle (Analyze, "Tool already in the spindle") for the open file's
 * cuts before its first tool change, or null: one T number when every such choice agrees, null when none is made
 * or two disagree. The 3D preview carves the lines before the first tool change with it (preview/carveTools.ts):
 * the user's own statement, never a guess. Display only.
 */
export const spindleToolChoice = computed<number | null>(() => {
  const preview = currentFile.value?.preview;
  if (preview === undefined) return null;
  const firstChange = preview.tools.lines[0] ?? Infinity;
  const picks = new Set<number>();
  for (const o of advisorOperations.value.operations) {
    if (o.tool !== null || o.line >= firstChange) continue;
    const t = Number(operationFields(o.id)['tool']);
    if (Number.isInteger(t) && t > 0) picks.add(t);
  }
  return picks.size === 1 ? ([...picks][0] ?? null) : null;
});

