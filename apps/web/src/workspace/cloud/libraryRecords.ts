import { builtinMaterial, readMaterial, readTool, resolveFork, type LibraryFork, type Material, type Tool } from '@synthetos/library';
import type { RecordKind } from '@synthetos/contracts';
import { SEED_TOOLS, type SeedTool } from '../librarySeed.ts';
import { canonical } from './cloudCache.ts';
export interface LibraryRecord { readonly kind: RecordKind; readonly id: string; readonly content: Tool | Material }
export const LIBRARY_NAMES = ['tools.v2', 'materials.v2', 'materials.own.v1'] as const;
export function validContent(kind: RecordKind, value: unknown): value is Tool | Material { return (kind === 'tool' ? readTool(value) : readMaterial(value)).ok; }
/** Built-ins ship with Run. Only edits of seed tools, forks and user-created records need an account copy. */
export function toRecords(name: string, value: unknown): LibraryRecord[] {
  if (!Array.isArray(value)) return [];
  if (name === 'tools.v2') return (value as SeedTool[]).filter(e => !SEED_TOOLS.some(seed => canonical(seed.tool) === canonical(e.tool))).map(e => ({ kind: 'tool', id: e.tool.id, content: { ...e.tool, firmwareSlot: { t: e.number, lengthOffset: e.tool.firmwareSlot?.lengthOffset ?? 0 } } }));
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
export function fromRecords(name: string, records: readonly LibraryRecord[]): unknown {
  const materials = records.filter(r => r.kind === 'material').map(r => r.content as Material);
  if (name === 'materials.v2') return materials.map(materialFork).filter(fork => fork !== null);
  if (name === 'materials.own.v1') return materials.filter(material => materialFork(material) === null);
  const tools = records.filter(r => r.kind === 'tool').map(r => r.content as Tool).sort((a, b) => a.id.localeCompare(b.id));
  const used = new Set<number>();
  return [...tools.map(tool => ({ tool, number: tool.firmwareSlot?.t ?? 0, store: null })), ...SEED_TOOLS.filter(e => !tools.some(t => t.id === e.tool.id))].map(entry => {
    let number = entry.number;
    if (number < 1 || used.has(number)) { number = 1; while (used.has(number)) number++; }
    used.add(number); return { ...entry, number };
  });
}
export function browserCopy(content: Tool | Material, id: string): Tool | Material { return { ...content, id, name: `${content.name.slice(0, 100)} (from this browser)` }; }
