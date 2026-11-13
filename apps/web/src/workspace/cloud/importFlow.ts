import type { Tool } from '@synthetos/library';
import { cleanSeedTool } from '../tools/cleanSeedTool.ts';
import { canonical, contentHash, type CloudCache } from './cloudCache.ts';
import { browserCopy, validContent, type LibraryRecord } from './libraryRecords.ts';
import { enqueue } from './syncQueue.ts';
/** Called only after Copy. Persist id/hash decisions before the queue may make a request. */
export async function prepareImport(cache: CloudCache, records: readonly LibraryRecord[], persist: () => boolean): Promise<boolean> {
  cache.importSource ??= [...records];
  cache.consent = true;
  if (!persist()) return false;
  for (const local of cache.importSource) {
    if (!validContent(local.kind, local.content)) return false;
    // Keep the original hash for resumed-import checkpoints; clean only the content being copied.
    const content = local.kind === 'tool' ? cleanSeedTool(local.content as Tool) : local.content;
    const hash = await contentHash(local.content);
    const key = `${local.kind}:${local.id}:${hash}`;
    if (Object.hasOwn(cache.imports, key)) continue;
    const existing = cache.records.find(r => r.kind === local.kind && r.id === local.id);
    if (existing !== undefined && existing.archivedAt === null && canonical(existing.kind === 'tool' ? cleanSeedTool(existing.content as Tool) : existing.content) === canonical(content)) cache.imports[key] = local.id;
    else {
      const id = existing === undefined ? local.id : `import-${hash.slice(0, 48)}`;
      cache.imports[key] = id;
      enqueue(cache, local.kind, id, existing === undefined ? content : browserCopy(content, id), true);
    }
    if (!persist()) return false;
  }
  delete cache.importSource;
  return persist();
}
