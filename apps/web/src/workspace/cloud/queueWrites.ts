import type { CloudRecord, RecordKind } from '@synthetos/contracts';
import type { Project } from '@synthetos/library';
import type { CloudCache, PendingWrite } from './cloudCache.ts';
import { validContent } from './recordReaders.ts';
import { projectHashes } from './projectFiles.ts';
export interface WriteInput { kind: RecordKind; id: string; content: unknown | null; createOnly?: boolean; cleanup?: true }
export function putPending(cache: CloudCache, input: WriteInput): void {
  const { kind, id, content, createOnly, cleanup } = input;
  const old = cache.pending.find(p => p.kind === kind && p.id === id);
  const record = cache.records.find(r => r.kind === kind && r.id === id);
  if (kind === 'project' && content === null && old?.content && validContent('project', old.content)) {
    cache.fileDeletes = [...new Set([...(cache.fileDeletes ?? []), ...projectHashes(old.content as Project)])];
  }
  cache.pending = cache.pending.filter(p => !(p.kind === kind && p.id === id));
  cache.pending.push({ token: crypto.randomUUID(), kind, id, parent: createOnly ? null : old?.parent ?? record?.rev ?? null, content, ...(cleanup ? { cleanup } : {}) });
}
export function accept(cache: CloudCache, pending: PendingWrite, record: CloudRecord, consume = true): void {
  if (consume && pending.kind === 'project' && pending.content === null && record.archivedAt !== null) {
    const previous = cache.records.find(r => r.kind === 'project' && r.id === pending.id);
    if (previous && validContent('project', previous.content)) cache.fileDeletes = [...new Set([...(cache.fileDeletes ?? []), ...projectHashes(previous.content as Project)])];
  }
  cache.records = cache.records.filter(r => r.kind !== record.kind || r.id !== record.id).concat(record);
  cache.pending = cache.pending.filter(p => !consume || p.token !== pending.token).map(p => p.kind === record.kind && p.id === record.id ? { ...p, parent: record.rev } : p);
}
