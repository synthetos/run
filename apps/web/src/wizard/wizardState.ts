/**
 * The setup wizard's rules (docs/superpowers/specs/2026-11-16-first-run-design.md §6.1, §6.2), pure: when it
 * opens, which step is current, what finishing or skipping a step writes, and how the rail marks the seven steps.
 * The record itself lives in the account (workspace/cloud/setupSync.ts); nothing here reads a signal.
 */
import type { SetupRecord } from '@synthetos/library';
import type { GateKind } from '../gate/gateState.ts';
import type { SetupView } from '../workspace/cloud/setupSync.ts';

export type StepId = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface StepDef { readonly id: StepId; readonly label: string; readonly skippable: boolean }

export const STEPS: readonly StepDef[] = Object.freeze([
  { id: 1, label: 'Welcome', skippable: false },
  { id: 2, label: 'Machine', skippable: true },
  { id: 3, label: 'Firmware', skippable: true },
  { id: 4, label: 'Homing', skippable: true },
  { id: 5, label: 'Tools & stock', skippable: true },
  { id: 6, label: 'Project', skippable: true },
  { id: 7, label: 'Done', skippable: false },
]);

export const NEXT_LABEL: Readonly<Record<StepId, string>> = Object.freeze({
  1: 'Set up my machine', 2: 'Next: firmware', 3: 'Next: homing', 4: 'Next: tools & stock', 5: 'Next: project', 6: 'Open project', 7: 'Go to the Job page',
});

/**
 * R1: signed in (the gate is open), the account read once, the wizard not dismissed, and either no machine record
 * yet or a wizard already under way (step 2 saves the machine; the record past step 1 keeps it open, on any browser).
 */
export function wizardOpen(gate: GateKind, view: SetupView): boolean {
  if (gate !== 'open' || !view.account || !view.refreshed || view.record?.dismissed === true) return false;
  return view.machines === 0 || (view.record?.step ?? 1) > 1;
}

export function currentStep(record: SetupRecord | null): StepId {
  const step = record?.step ?? 1;
  return Math.min(7, Math.max(1, Math.round(step))) as StepId;
}

export function markDone(record: SetupRecord, step: StepId): Pick<SetupRecord, 'step' | 'done'> {
  const done = record.done.includes(step) ? record.done : [...record.done, step];
  return { step: Math.min(7, step + 1), done };
}

export function skip(record: SetupRecord, step: StepId): Pick<SetupRecord, 'step'> {
  void record;
  return { step: Math.min(7, step + 1) };
}

export type RailMark = 'done' | 'current' | 'later';

export function railMarks(record: SetupRecord | null): readonly RailMark[] {
  const current = currentStep(record);
  return STEPS.map((s) => (s.id === current ? 'current' : record?.done.includes(s.id) === true ? 'done' : 'later'));
}
