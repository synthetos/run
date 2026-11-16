import { SEED_TOOLS } from '../librarySeed.ts';
import type { RecordKind } from '@synthetos/contracts';
import { RecordsError, type RecordsClient } from '../../cloud/recordsClient.ts';
import { FilesError } from '../../cloud/filesClient.ts';
import type { CloudCache, PendingWrite } from './cloudCache.ts';
import { validContent, type LibraryRecord } from './libraryRecords.ts';
import { accept, putPending } from './queueWrites.ts';
import { resolveConflict } from './queueConflict.ts';
export type SyncStatus = 'saved' | 'saving' | 'retry' | 'quota' | 'refused';
export interface QueueHooks { persist(): boolean; change(): void; notice(message: string): void; prepare?(pending: PendingWrite, signal: AbortSignal): Promise<PendingWrite> }
export function visibleRecords(cache: CloudCache): LibraryRecord[] {
  const result = new Map<string, LibraryRecord>();
  for (const r of cache.records) if (validContent(r.kind, r.content) && (r.archivedAt === null || (r.kind === 'tool' && SEED_TOOLS.some(e => e.tool.id === r.id)))) result.set(`${r.kind}:${r.id}`, { kind: r.kind, id: r.id, content: r.content, ...(r.archivedAt === null ? {} : { archived: true as const }) });
  for (const p of cache.pending) {
    const key = `${p.kind}:${p.id}`;
    if (p.content === null) {
      const seed = p.kind === 'tool' ? SEED_TOOLS.find(e => e.tool.id === p.id) : undefined;
      if (seed === undefined) result.delete(key);
      else result.set(key, { kind: 'tool', id: p.id, content: seed.tool, archived: true });
    }
    else if (validContent(p.kind, p.content)) result.set(key, { kind: p.kind, id: p.id, content: p.content });
  }
  return [...result.values()];
}

export function enqueue(cache: CloudCache, kind: RecordKind, id: string, content: unknown | null, createOnly = false): void {
  putPending(cache, { kind, id, content, createOnly });
}
interface QueueRun { cache: CloudCache; client: RecordsClient; allowed(): boolean; signal: AbortSignal; hooks: QueueHooks }
async function writeOne(run: QueueRun, pending: PendingWrite): Promise<void> {
  const { cache, client, signal, hooks } = run;
  const seed = pending.kind === 'tool' ? SEED_TOOLS.find(e => e.tool.id === pending.id) : undefined;
  if (pending.content === null && pending.parent === null) {
    if (seed === undefined) { cache.pending.shift(); return; }
    const record = await client.put('tool', pending.id, null, seed.tool, signal);
    if (!signal.aborted) accept(cache, pending, record, false);
    return;
  }
  const next = hooks.prepare ? await hooks.prepare(pending, signal) : pending;
  if (!run.allowed() || signal.aborted || !cache.pending.some(p => p.token === next.token)) return;
  const record = next.content === null
    ? await client.archive(next.kind, next.id, next.parent!, signal)
    : await client.put(next.kind, next.id, next.parent, next.content, signal);
  if (!signal.aborted) accept(cache, next, record);
}
async function failure(error: unknown, run: QueueRun, pending: PendingWrite): Promise<SyncStatus | null> {
  if (run.signal.aborted) return 'saving';
  if (!(error instanceof RecordsError)) return 'retry';
  if (error.status === 401 || error.status === 503) throw error;
  if (error.status === 413) return 'quota';
  if (error instanceof FilesError) {
    if (error.status !== 422) return 'retry';
    run.hooks.notice(`Not saved to your account: ${error.reason}`); return 'refused';
  }
  if (error.status !== 409) return 'retry';
  if (await resolveConflict(run.cache, pending, error.current)) run.hooks.notice('The account version was kept. Your edit is a copy named “(from this browser)”.');
  return null;
}
/** One request at a time. Every iteration rechecks the safety gate; cancellation keeps pending edits. */
export async function drainQueue(cache: CloudCache, client: RecordsClient, allowed: () => boolean, signal: AbortSignal, hooks: QueueHooks): Promise<SyncStatus> {
  const run = { cache, client, allowed, signal, hooks };
  while (cache.pending.length > 0) {
    if (!allowed() || signal.aborted) return 'saving';
    if (!hooks.persist()) return 'retry';
    const pending = cache.pending[0]!;
    try { await writeOne(run, pending); }
    catch (error) { const status = await failure(error, run, pending); if (status !== null) return status; }
    if (signal.aborted || !allowed()) return 'saving';
    if (!hooks.persist()) return 'retry';
    hooks.change();
  }
  return 'saved';
}
export const retryDelay = (attempt: number): number => Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6));
