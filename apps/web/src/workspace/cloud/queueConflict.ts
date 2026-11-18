import type { CloudRecord } from '@synthetos/contracts';
import type { Tool } from '@synthetos/library';
import { cleanSeedTool } from '../tools/cleanSeedTool.ts';
import { SEED_TOOLS } from '../librarySeed.ts';
import { canonical, contentHash, type CloudCache, type PendingWrite } from './cloudCache.ts';
import { browserCopy, validContent } from './libraryRecords.ts';
import { accept, putPending } from './queueWrites.ts';

function rebaseCleanup(cache: CloudCache, pending: PendingWrite, current: CloudRecord | null): void {
  cache.pending = cache.pending.filter(p => p.token !== pending.token);
  cache.records = cache.records.filter(r => r.kind !== pending.kind || r.id !== pending.id);
  if (current === null) return;
  cache.records.push(current);
  if (current.archivedAt !== null || !validContent('tool', current.content)) return;
  const content = cleanSeedTool(current.content as Tool);
  if (content !== current.content) putPending(cache, { kind: 'tool', id: current.id, content, cleanup: true });
}
function priorResponse(cache: CloudCache, pending: PendingWrite, current: CloudRecord | null): boolean {
  if (current === null) return false;
  if (pending.kind === 'project' && pending.content === null && current.archivedAt !== null) {
    accept(cache, pending, current); return true;
  }
  const seed = pending.kind === 'tool' ? SEED_TOOLS.find(e => e.tool.id === pending.id) : undefined;
  if (pending.content === null && pending.parent === null && seed !== undefined && (current.archivedAt !== null || canonical(current.content) === canonical(seed.tool))) {
    accept(cache, pending, current, current.archivedAt !== null); return true;
  }
  if (pending.content !== null && canonical(current.content) === canonical(pending.content) && current.archivedAt === null) {
    accept(cache, pending, current); return true;
  }
  return false;
}
/** A conflict keeps the account head and gives the latest local edit a stable copy id. */
export async function resolveConflict(cache: CloudCache, pending: PendingWrite, current: CloudRecord | null): Promise<boolean> {
  if (pending.cleanup === true && cache.pending.find(p => p.kind === pending.kind && p.id === pending.id)?.token === pending.token) {
    rebaseCleanup(cache, pending, current); return false;
  }
  if (priorResponse(cache, pending, current)) return false;
  const latest = cache.pending.find(p => p.kind === pending.kind && p.id === pending.id) ?? pending;
  cache.pending = cache.pending.filter(p => p.kind !== pending.kind || p.id !== pending.id);
  if (current !== null) cache.records = cache.records.filter(r => r.kind !== current.kind || r.id !== current.id).concat(current);
  // One setup document per account: another browser's progress wins; the next wizard action saves on top of it.
  if (pending.kind === 'setup') return false;
  if (latest.content !== null && validContent(latest.kind, latest.content)) {
    const id = `copy-${(await contentHash(latest.content)).slice(0, 48)}`;
    for (const [key, target] of Object.entries(cache.imports)) if (target === latest.id) cache.imports[key] = id;
    putPending(cache, { kind: latest.kind, id, content: browserCopy(latest.content, id), createOnly: true });
  }
  return true;
}
