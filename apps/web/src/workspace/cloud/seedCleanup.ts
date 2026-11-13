import type { Tool } from '@synthetos/library';
import { cleanSeedTool } from '../tools/cleanSeedTool.ts';
import type { CloudCache } from './cloudCache.ts';
import { enqueue, visibleRecords } from './syncQueue.ts';

/** Clean cached, downloaded and pending seed tools, preserving existing user edits and tombstones. */
export function queueSeedCleanup(cache: CloudCache): boolean {
  let changed = false;
  for (const record of visibleRecords(cache)) {
    if (record.kind !== 'tool' || record.archived === true) continue;
    const before = record.content as Tool;
    const content = cleanSeedTool(before);
    if (content === before) continue;
    const pending = cache.pending.find(p => p.kind === 'tool' && p.id === record.id);
    enqueue(cache, 'tool', record.id, content);
    // User edits still get the normal conflict-copy behavior. Pure migrations rebase on the latest record.
    if (pending === undefined || pending.cleanup === true) cache.pending[cache.pending.length - 1] = { ...cache.pending.at(-1)!, cleanup: true };
    changed = true;
  }
  return changed;
}
