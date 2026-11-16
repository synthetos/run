import { readProject, type Project } from '@synthetos/library';
import type { RecordStore } from '../storage.ts';
import type { CloudCache } from './cloudCache.ts';
import { enqueue, visibleRecords } from './syncQueue.ts';
import { downloadKey, fileSignature } from './projectAvailability.ts';
import { refusal } from './recordReaders.ts';

export interface ProjectRecordsOptions {
  subject: string; records: RecordStore; cache: CloudCache;
  active(): boolean; change(): void; notice(message: string): void; persist(): boolean;
}
/** Account metadata lives in its cache; account bytes and refused drafts are isolated by subject in IndexedDB. */
export function projectRecords(options: ProjectRecordsOptions): RecordStore {
  const { records, cache } = options;
  const prefix = `account/${encodeURIComponent(options.subject)}/`;
  const active = () => { if (!options.active()) throw new Error('This account session has ended.'); };
  const accountIds = () => new Set([...cache.records, ...cache.pending].filter(r => r.kind === 'project').map(r => r.id));
  async function projects(): Promise<Map<string, Project>> {
    const result = new Map<string, Project>();
    const known = accountIds();
    for (const id of await records.keys('projects')) {
      if (id.includes('/')) continue;
      const value = await records.get('projects', id);
      if (!known.has(id)) result.set(id, value as Project);
    }
    for (const r of visibleRecords(cache)) if (r.kind === 'project') result.set(r.id, r.content as Project);
    for (const key of await records.keys('projects')) if (key.startsWith(prefix)) {
      const value = await records.get('projects', key) as Project;
      result.set(value.id, value);
    }
    return result;
  }
  async function putProject(id: string, value: unknown): Promise<void> {
    const read = readProject(value);
    const localOnly = !cache.consent && !accountIds().has(id) && await records.get('projects', id) !== undefined;
    if (localOnly) await records.put('projects', id, value);
    else if (!read.ok) await records.put('projects', prefix + id, value);
    else {
      enqueue(cache, 'project', id, read.value);
      await records.put('projects', downloadKey(options.subject, id), fileSignature(read.value));
      // Preserve a refused edit until a valid replacement is durably queued.
      if (options.persist()) await records.delete('projects', prefix + id);
      else await records.put('projects', prefix + id, value);
    }
    if (!read.ok) options.notice(refusal('project', value)!);
    options.change();
  }
  return {
    get persistent() { return records.persistent; },
    async keys(kind) { active(); return kind === 'projects' ? [...(await projects()).keys()] : records.keys(kind); },
    async get(kind, id) {
      active();
      if (kind === 'projects') return (await projects()).get(id);
      return await records.get('blobs', prefix + id) ?? await records.get('blobs', id);
    },
    async put(kind, id, value) {
      active();
      if (kind === 'projects') await putProject(id, value);
      else await records.put(kind, prefix + id, value);
    },
    async delete(kind, id) {
      active();
      // Blobs can be shared by the local original and a conflict copy. Account GC runs after archive.
      if (kind === 'blobs') return;
      if (accountIds().has(id)) { enqueue(cache, 'project', id, null); options.persist(); }
      else await records.delete('projects', id);
      await records.delete('projects', prefix + id);
      options.change();
    },
  };
}
