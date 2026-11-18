/**
 * Step 2's draft (spec §6.3 step 2): a machine template, a name and the bed's three sizes, turned into a machine
 * record the account accepts, bound to the connected board's id when there is one. Pure except `saveDraft`, which
 * writes through the library adapter (the same store the Machines view uses, synced to the account by the bindings).
 */
import type { MachineProfile } from '@synthetos/library';
import { machineStore, placeholderBed, selectedMachineStore } from '../workspace/library.ts';
import { CATALOGUE, type MachineTemplate } from '../workspace/machineDrawings.ts';

export interface MachineDraft {
  readonly templateId: string;
  readonly name: string;
  readonly width: number;
  readonly depth: number;
  readonly thickness: number;
}

const BED_THICKNESS = 19;
const BED_NOTE = 'From setup: measure the bed and where its top sits below home.';

export function draftFromTemplate(t: MachineTemplate): MachineDraft {
  return { templateId: t.id, name: t.id === 'custom' ? 'My machine' : `My ${t.name}`, width: t.travel.x, depth: t.travel.y, thickness: BED_THICKNESS };
}

export function draftFromMachine(m: MachineProfile): MachineDraft {
  const bed = m.bed ?? placeholderBed(m);
  return { templateId: m.templateId, name: m.name, width: bed.width, depth: bed.depth, thickness: bed.thickness };
}

const positive = (n: number): boolean => Number.isFinite(n) && n > 0;

export function draftValid(d: MachineDraft): boolean {
  return d.name.trim() !== '' && positive(d.width) && positive(d.depth) && positive(d.thickness);
}

function templateOf(id: string): MachineTemplate {
  return CATALOGUE.find((t) => t.id === id) ?? (CATALOGUE[CATALOGUE.length - 1] as MachineTemplate);
}

/** The record for a draft: a new one, or `base` revised; `boardId` binds it to the connected board (R4). */
export function machineFromDraft(d: MachineDraft, base: MachineProfile | null, boardId: string | null, at: string): MachineProfile {
  const t = templateOf(d.templateId);
  const travel = base?.travel ?? t.travel;
  const bed = { ...placeholderBed({ travel }), ...(base?.bed ?? {}), width: d.width, depth: d.depth, thickness: d.thickness, revision: (base?.bed?.revision ?? 0) + 1, source: { kind: 'placeholder' as const, note: BED_NOTE }, savedAt: at };
  const head: MachineProfile = base ?? { id: `m-${t.id}-${Date.parse(at).toString(36)}`, name: d.name, templateId: t.id, drive: t.drive, travel, spindle: 'Trim router', createdAt: at, revision: 0, homeFrame: 'front-left-top' };
  const { boardId: oldBoard, ...rest } = head;
  const bound = boardId ?? oldBoard;
  return { ...rest, name: d.name.trim(), templateId: d.templateId, bed, revision: (head.revision ?? 1) + 1, ...(bound === undefined ? {} : { boardId: bound }) };
}

export function boardOwner(boardId: string | null, machines: readonly MachineProfile[]): MachineProfile | null {
  return boardId === null ? null : machines.find((m) => m.boardId === boardId) ?? null;
}

/** Creates the machine, or updates the one `setupMachineId` names (Review Focus 2); selects it; returns its id. */
export function saveDraft(d: MachineDraft, setupMachineId: string | null, boardId: string | null, at = new Date().toISOString()): string {
  const list = machineStore.value.value;
  const base = list.find((m) => m.id === setupMachineId) ?? null;
  const next = machineFromDraft(d, base, boardId, at);
  machineStore.set(base === null ? [...list, next] : list.map((m) => (m.id === base.id ? next : m)));
  selectedMachineStore.set(next.id);
  return next.id;
}
