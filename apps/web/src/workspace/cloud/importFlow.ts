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
    const hash = await contentHash(local.content);
    const key = `${local.kind}:${local.id}:${hash}`;
    if (Object.hasOwn(cache.imports, key)) continue;
    const existing = cache.records.find(r => r.kind === local.kind && r.id === local.id);
    if (existing !== undefined && existing.archivedAt === null && canonical(existing.content) === canonical(local.content)) cache.imports[key] = local.id;
    else {
      const id = existing === undefined ? local.id : `import-${hash.slice(0, 48)}`;
      cache.imports[key] = id;
      enqueue(cache, local.kind, id, existing === undefined ? local.content : browserCopy(local.content, id), true);
    }
    if (!persist()) return false;
  }
  delete cache.importSource;
  return persist();
}
