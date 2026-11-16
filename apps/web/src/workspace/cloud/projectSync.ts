import { readProject, type Project } from '@synthetos/library';
import type { FilesClient } from '../../cloud/filesClient.ts';
import { FilesError } from '../../cloud/filesClient.ts';
import { activateProjectStore, makeProjectStore, publishProjects, refreshProjectImages } from '../../projects/browserStore.ts';
import type { ProjectStore } from '../../projects/store.ts';
import type { RecordStore } from '../storage.ts';
import { type CloudCache, type PendingWrite } from './cloudCache.ts';
import type { LibraryRecord } from './libraryRecords.ts';
import { hashProjectImages, uploadProjectFiles, downloadProjectFiles } from './projectFiles.ts';
import { projectRecords } from './projectRecords.ts';
import { accountProjects, projectDownload } from './projectSyncState.ts';
import { downloadKey, fileSignature } from './projectAvailability.ts';
import { refusal } from './recordReaders.ts';
import { visibleRecords } from './syncQueue.ts';

export interface ProjectContext { records: RecordStore; local: ProjectStore; files: FilesClient }
export interface ProjectSyncOptions {
  subject: string; context: ProjectContext; cache: CloudCache; allowed(): boolean;
  persist(): boolean; change(): void; notice(message: string): void;
}
/** Shares the library queue and lifetime. No project listing starts a file download. */
export function startProjectSync(options: ProjectSyncOptions) {
  const { context, cache } = options;
  let live = true;
  let showing = Promise.resolve();
  const downloads = new Set<AbortController>();
  const records = projectRecords({ ...options, records: context.records, active: () => live });
  const store = makeProjectStore(records);
  const access = { records, files: context.files, allowed: options.allowed, active: () => live };
  const local = (): LibraryRecord[] => context.local.list.flatMap(p => {
    const read = readProject(p);
    if (!read.ok) { options.notice(refusal('project', p)!); return []; }
    return [{ kind: 'project', id: p.id, content: read.value }];
  });
  function show(): void {
    if (!live) return;
    showing = showing.then(async () => {
      if (!live) return;
      await store.load();
      if (!live) return;
      const remote: string[] = [];
      for (const r of visibleRecords(cache)) {
        if (r.kind !== 'project') continue;
        const signature = fileSignature(r.content as Project);
        const local = context.local.find(r.id);
        const saved = await context.records.get('projects', downloadKey(options.subject, r.id));
        if (saved !== signature && (local === null || fileSignature(local) !== signature)) remote.push(r.id);
      }
      if (!live) return;
      accountProjects.value = remote;
      activateProjectStore(store);
    }).catch(() => { if (live) options.notice('Projects could not be read from this browser.'); });
  }
  async function prepare(pending: PendingWrite, signal: AbortSignal): Promise<PendingWrite> {
    if (pending.kind !== 'project' || pending.content === null) return pending;
    const project = await hashProjectImages(pending.content as Project, records);
    if (!live || signal.aborted) throw new DOMException('Sync stopped', 'AbortError');
    const next = { ...pending, content: project };
    cache.pending = cache.pending.map(p => p.token === pending.token ? next : p);
    if (!live || !options.persist()) throw new Error('The project queue could not be saved');
    const available = await uploadProjectFiles(project, access, signal);
    if (live && available) await context.records.put('projects', downloadKey(options.subject, project.id), fileSignature(project));
    return next;
  }
  async function cleanup(signal: AbortSignal): Promise<void> {
    while (cache.fileDeletes?.length) {
      if (!live || !options.allowed() || signal.aborted || cache.pending.length > 0) return;
      const hash = cache.fileDeletes[0]!;
      await context.files.remove(hash, signal);
      if (!live || signal.aborted) return;
      cache.fileDeletes.shift();
      if (!options.persist()) throw new Error('The file cleanup queue could not be saved');
    }
  }
  async function open(id: string): Promise<void> {
    const project = store.find(id);
    if (project === null || !live) return;
    const abort = new AbortController(); downloads.add(abort);
    try {
      await downloadProjectFiles(project, access, abort.signal);
      if (!live || abort.signal.aborted) return;
      await context.records.put('projects', downloadKey(options.subject, id), fileSignature(project));
      if (!live || abort.signal.aborted) return;
      accountProjects.value = accountProjects.peek().filter(value => value !== id);
      refreshProjectImages(); publishProjects(store);
    } catch (error) {
      if (live) options.notice(error instanceof FilesError ? `Not downloaded: ${error.reason}` : 'Not downloaded: sync is paused or the connection failed. Open the project to retry.');
      throw error;
    } finally { downloads.delete(abort); }
  }
  projectDownload.open = open;
  return {
    local, show, prepare, cleanup,
    async refreshLocal() { await context.local.load(); },
    wake() { if (!options.allowed()) for (const abort of downloads) abort.abort(); },
    stop() { if (!live) return; live = false; for (const abort of downloads) abort.abort(); projectDownload.open = () => Promise.resolve(); accountProjects.value = []; activateProjectStore(null); },
  };
}
