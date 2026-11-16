import { toolDisplayName } from '../tools/displayName.ts';
import { builtinMaterial, resolveFork, type LibraryFork, type Material, type Tool, type MachineProfile } from '@synthetos/library';
import type { RecordKind } from '@synthetos/contracts';
import { SEED_TOOLS, type SeedTool } from '../librarySeed.ts';
import { validContent, type AccountContent } from './recordReaders.ts';
export { validContent } from './recordReaders.ts';
import { canonical } from './cloudCache.ts';
export interface LibraryRecord { readonly kind: RecordKind; readonly id: string; readonly content: AccountContent; readonly archived?: true }
export const LIBRARY_NAMES = ['tools.v2', 'materials.v2', 'materials.own.v1', 'machines'] as const;
/** Built-ins ship with Run. Only edits of seed tools, forks and user-created records need an account copy. */
export function toRecords(name: string, value: unknown, includeSeeds = false): LibraryRecord[] {
  if (!Array.isArray(value)) return [];
  if (name === 'machines') return value.filter(v => validContent('machine', v)).map(content => ({ kind: 'machine', id: content.id, content }));
  if (name === 'tools.v2') return (value as SeedTool[]).filter(e => includeSeeds || !SEED_TOOLS.some(seed => seed.number === e.number && canonical(seed.tool) === canonical(e.tool))).map(e => ({ kind: 'tool', id: e.tool.id, content: { ...e.tool, firmwareSlot: { t: e.number, lengthOffset: e.tool.firmwareSlot?.lengthOffset ?? 0 } } }));
  if (name === 'materials.own.v1') return (value as Material[]).map(content => ({ kind: 'material', id: content.id, content }));
  if (name !== 'materials.v2') return [];
  return (value as LibraryFork[]).flatMap(fork => {
    const parent = builtinMaterial(fork.forkOf.id);
    if (parent === undefined || fork.kind !== 'material') return [];
    const full = resolveFork(fork as LibraryFork & { kind: 'material' }, parent);
    return full.ok ? [{ kind: 'material' as const, id: full.value.id, content: full.value }] : [];
  });
}
function materialFork(material: Material): LibraryFork | null {
  const parent = material.forkOf === undefined ? undefined : builtinMaterial(material.forkOf.id);
  if (parent === undefined || parent.version !== material.forkOf?.version) return null;
  const edits = Object.fromEntries(Object.entries(material).filter(([key, value]) => !['id', 'version', 'forkOf'].includes(key) && canonical(value) !== canonical(parent[key as keyof Material])));
  return { kind: 'material', id: material.id, version: material.version, forkOf: material.forkOf, edits };
}
export function fromRecords(name: string, records: readonly LibraryRecord[], local: unknown = []): unknown {
  if (name === 'machines') {
    const machines = records.filter(r => r.kind === 'machine').map(r => r.content as MachineProfile);
    return [...(Array.isArray(local) ? local as MachineProfile[] : []).filter(m => !machines.some(a => a.id === m.id)), ...machines];
  }
  const materials = records.filter(r => r.kind === 'material').map(r => r.content as Material);
  if (name === 'materials.v2') return materials.map(materialFork).filter(fork => fork !== null);
  if (name === 'materials.own.v1') return materials.filter(material => materialFork(material) === null);
  // Store SKU stays browser-only; a later slice can carry it once the record schema allows it.
  const tools = records.filter(r => r.kind === 'tool' && r.archived !== true).map(r => r.content as Tool).sort((a, b) => a.id.localeCompare(b.id));
  const used = new Set<number>();
  return [...tools.map(tool => ({ tool, number: tool.firmwareSlot?.t ?? 0, store: null })), ...SEED_TOOLS.filter(e => !records.some(r => r.kind === 'tool' && r.id === e.tool.id))].map(entry => {
    let number = entry.number;
    if (number < 1 || used.has(number)) { number = 1; while (used.has(number)) number++; }
    used.add(number); return { ...entry, number };
  });
}
export function browserCopy(content: AccountContent, id: string): AccountContent {
  if ('jobs' in content) return { ...content, id, name: `${content.name.slice(0, 100)} (from this browser)`, jobs: content.jobs.map(job => ({ ...job, projectId: id })) };
  return { ...content, id, name: `${('geometry' in content ? toolDisplayName(content) : content.name).slice(0, 100)} (from this browser)` }; }
