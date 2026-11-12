import type { CloudRecord, RecordKind } from '@synthetos/contracts';
import { RecordsError, type RecordsClient } from '../../cloud/recordsClient.ts';
import { canonical, contentHash, type CloudCache, type PendingWrite } from './cloudCache.ts';
import { browserCopy, validContent, type LibraryRecord } from './libraryRecords.ts';
export type SyncStatus = 'saved' | 'saving' | 'retry' | 'quota';
export interface QueueHooks { persist(): boolean; change(): void; notice(message: string): void }
export function visibleRecords(cache: CloudCache): LibraryRecord[] {
  const result = new Map<string, LibraryRecord>();
  for (const r of cache.records) if (r.archivedAt === null && validContent(r.kind, r.content)) result.set(`${r.kind}:${r.id}`, { kind: r.kind, id: r.id, content: r.content });
  for (const p of cache.pending) {
    const key = `${p.kind}:${p.id}`;
    if (p.content === null) result.delete(key);
    else if (validContent(p.kind, p.content)) result.set(key, { kind: p.kind, id: p.id, content: p.content });
  }
  return [...result.values()];
}
export function enqueue(cache: CloudCache, kind: RecordKind, id: string, content: unknown | null, createOnly = false): void {
  const old = cache.pending.find(p => p.kind === kind && p.id === id);
  const record = cache.records.find(r => r.kind === kind && r.id === id);
  cache.pending = cache.pending.filter(p => !(p.kind === kind && p.id === id));
  cache.pending.push({ token: crypto.randomUUID(), kind, id, parent: createOnly ? null : old?.parent ?? record?.rev ?? null, content });
}
function accept(cache: CloudCache, pending: PendingWrite, record: CloudRecord): void {
  cache.records = cache.records.filter(r => r.kind !== record.kind || r.id !== record.id).concat(record);
  cache.pending = cache.pending.filter(p => p.token !== pending.token).map(p => p.kind === record.kind && p.id === record.id ? { ...p, parent: record.rev } : p);
}
/** One request at a time. Every iteration rechecks the safety gate; cancellation never discards a pending edit. */
export async function drainQueue(cache: CloudCache, client: RecordsClient, allowed: () => boolean, signal: AbortSignal, hooks: QueueHooks): Promise<SyncStatus> {
  while (cache.pending.length > 0) {
    if (!allowed() || signal.aborted) return 'saving';
    if (!hooks.persist()) return 'retry';
    const pending = cache.pending[0]!;
    // A new record removed before its PUT started needs no server write. If PUT was in flight,
    // accept() supplies its acknowledged revision so this tombstone archives it instead.
    if (pending.content === null && pending.parent === null) { cache.pending.shift(); if (!hooks.persist()) return 'retry'; hooks.change(); continue; }
    try {
      const record = pending.content === null
        ? await client.archive(pending.kind, pending.id, pending.parent!, signal)
        : await client.put(pending.kind, pending.id, pending.parent, pending.content, signal);
      if (signal.aborted) return 'saving';
      accept(cache, pending, record);
    } catch (error) {
      if (signal.aborted) return 'saving';
      if (!(error instanceof RecordsError)) return 'retry';
      if (error.status === 401 || error.status === 503) throw error;
      if (error.status === 413) return 'quota';
      if (error.status !== 409) return 'retry';
      const current = error.current;
      if (current !== null && pending.content !== null && canonical(current.content) === canonical(pending.content) && current.archivedAt === null) accept(cache, pending, current); // prior response lost
      else {
        const latest = cache.pending.find(p => p.kind === pending.kind && p.id === pending.id) ?? pending;
        cache.pending = cache.pending.filter(p => p.kind !== pending.kind || p.id !== pending.id);
        if (current !== null) cache.records = cache.records.filter(r => r.kind !== current.kind || r.id !== current.id).concat(current);
        if (latest.content !== null && validContent(latest.kind, latest.content)) {
          const id = `copy-${(await contentHash(latest.content)).slice(0, 48)}`;
          const copy = browserCopy(latest.content, id);
          for (const [key, target] of Object.entries(cache.imports)) if (target === latest.id) cache.imports[key] = id;
          enqueue(cache, latest.kind, id, copy, true);
        }
        hooks.notice('The account version was kept. Your edit is a copy named “(from this browser)”.');
      }
    }
    if (!hooks.persist()) return 'retry';
    hooks.change();
  }
  return 'saved';
}
export const retryDelay = (attempt: number): number => Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6));
