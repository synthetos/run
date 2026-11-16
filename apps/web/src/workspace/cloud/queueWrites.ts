import type { CloudRecord, RecordKind } from '@synthetos/contracts';
import type { CloudCache, PendingWrite } from './cloudCache.ts';
import { rememberRemovedFiles } from './projectCleanup.ts';
export interface WriteInput { kind: RecordKind; id: string; content: unknown | null; createOnly?: boolean; cleanup?: true }
export function putPending(cache: CloudCache, input: WriteInput): void {
  const { kind, id, content, createOnly, cleanup } = input;
  const old = cache.pending.find(p => p.kind === kind && p.id === id);
  const record = cache.records.find(r => r.kind === kind && r.id === id);
  if (kind === 'project') {
    rememberRemovedFiles(cache, old?.content, content);
    rememberRemovedFiles(cache, record?.content, content);
  }
  cache.pending = cache.pending.filter(p => !(p.kind === kind && p.id === id));
  cache.pending.push({ token: crypto.randomUUID(), kind, id, parent: createOnly ? null : old?.parent ?? record?.rev ?? null, content, ...(cleanup ? { cleanup } : {}) });
}
export function accept(cache: CloudCache, pending: PendingWrite, record: CloudRecord, consume = true): void {
  if (consume && pending.kind === 'project') {
    const previous = cache.records.find(r => r.kind === 'project' && r.id === pending.id);
    const next = record.archivedAt === null ? record.content : null;
    rememberRemovedFiles(cache, previous?.content, next);
    if (record.archivedAt !== null) rememberRemovedFiles(cache, record.content, null);
  }
  cache.records = cache.records.filter(r => r.kind !== record.kind || r.id !== record.id).concat(record);
  cache.pending = cache.pending.filter(p => !consume || p.token !== pending.token).map(p => p.kind === record.kind && p.id === record.id ? { ...p, parent: record.rev } : p);
}
