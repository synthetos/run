import { readTool, readMaterial, readMachine, readProject, readSetup, type Tool, type Material, type MachineProfile, type Project, type SetupRecord } from '@synthetos/library';
import type { RecordKind } from '@synthetos/contracts';

export type AccountContent = Tool | Material | MachineProfile | Project | SetupRecord;
export const RECORD_READERS = { tool: readTool, material: readMaterial, machine: readMachine, project: readProject, setup: readSetup };
export const RECORD_KINDS = Object.keys(RECORD_READERS) as RecordKind[];
export const isRecordKind = (kind: unknown): kind is RecordKind => typeof kind === 'string' && Object.hasOwn(RECORD_READERS, kind);
export function validContent(kind: RecordKind, value: unknown): value is AccountContent {
  return RECORD_READERS[kind](value).ok;
}
export function refusal(kind: RecordKind, value: unknown): string | null {
  const read = RECORD_READERS[kind](value);
  if (read.ok) return null;
  const name = (value as { name?: string } | null)?.name ?? kind;
  return `Not saved to your account: ${name}: ${read.issues.map(i => `${i.path} ${i.message}`).join('; ')}`;
}
