import type { Project } from '@synthetos/library';
import type { CloudCache } from './cloudCache.ts';
import { validContent } from './recordReaders.ts';
import { projectHashes } from './projectFiles.ts';

/** Candidates survive edits, retries and reloads; only the worker decides whether a hash is still in use. */
export function rememberRemovedFiles(cache: CloudCache, before: unknown, after: unknown): void {
  if (!validContent('project', before)) return;
  const kept = new Set(validContent('project', after) ? projectHashes(after as Project) : []);
  const removed = projectHashes(before as Project).filter(hash => !kept.has(hash));
  if (removed.length) cache.fileDeletes = [...new Set([...(cache.fileDeletes ?? []), ...removed])];
}
