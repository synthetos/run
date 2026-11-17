import type { StoredBinding } from '../storage.ts';
import { canonical, type CloudCache } from './cloudCache.ts';
import { fromRecords, toRecords } from './libraryRecords.ts';
import { refusal, validContent } from './recordReaders.ts';
import { enqueue, visibleRecords } from './syncQueue.ts';

export interface BindingHooks { persist(): boolean; change(): void; notice(message: string): void }
function machineLocals(binding: StoredBinding, cache: CloudCache): unknown[] {
  const local = binding.local();
  if (!Array.isArray(local)) return [];
  const known = new Set([...cache.records, ...cache.pending].filter(r => r.kind === 'machine').map(r => r.id));
  return local.filter((m: { id: string }) => !known.has(m.id) || !validContent('machine', m));
}
export function showBindings(bindings: readonly StoredBinding[], cache: CloudCache): void {
  for (const b of bindings) b.show(fromRecords(b.name, visibleRecords(cache), b.name === 'machines' ? machineLocals(b, cache) : []));
}
function retainMachines(binding: StoredBinding, next: unknown, cache: CloudCache, hooks: BindingHooks): Set<string> {
  const kept = new Set<string>();
  if (binding.name !== 'machines' || !Array.isArray(next)) return kept;
  const existing = new Set([...cache.records, ...cache.pending].filter(r => r.kind === 'machine').map(r => r.id));
  const previous = binding.local();
  const localIds = new Set(Array.isArray(previous) ? previous.map((m: { id: string }) => m.id) : []);
  const retained = next.filter((m: { id: string }) => {
    const issue = refusal('machine', m);
    if (issue !== null) hooks.notice(issue);
    if (issue === null && (existing.has(m.id) || !localIds.has(m.id))) return false;
    kept.add(m.id); return true;
  });
  const originals = Array.isArray(previous) ? previous.filter((m: { id: string }) => existing.has(m.id) && !kept.has(m.id)) : [];
  binding.keepLocal([...originals, ...retained]);
  return kept;
}
export function connectBindings(bindings: readonly StoredBinding[], cache: CloudCache, hooks: BindingHooks): void {
  for (const binding of bindings) binding.connect((next, previous) => {
    const retained = retainMachines(binding, next, cache, hooks);
    const before = toRecords(binding.name, previous, true);
    const after = toRecords(binding.name, next, true);
    for (const record of after) if (!retained.has(record.id) && !before.some(old => old.id === record.id && canonical(old.content) === canonical(record.content))) enqueue(cache, record.kind, record.id, record.content);
    for (const record of before) if (!retained.has(record.id) && !after.some(r => r.id === record.id)) enqueue(cache, record.kind, record.id, null);
    const saved = hooks.persist(); hooks.change(); return saved;
  });
}
