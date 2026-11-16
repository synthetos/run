import type { Project } from '@synthetos/library';
import { sha256Hex } from './image.ts';
import { contentKey, putProjectBlob, readStoredBlob, type ProjectRecordStore } from './blobStore.ts';
import { copyProject } from './copyProject.ts';
import { readProjectArchive, type ImportOptions } from './zip/import.ts';

export interface ImportTarget { records: ProjectRecordStore; projects: readonly Project[]; newId(): string }
/** A collision changes only project identity; a reused file id may never replace different bytes. */
export async function installProjectZip(zip: Blob, target: ImportTarget, options: ImportOptions = {}): Promise<Project> {
  const archive = await readProjectArchive(zip, options); let project = archive.project;
  const occupied = new Set([...target.projects.map(p => p.id), ...await target.records.keys('projects')]);
  if (occupied.has(project.id)) {
    let id = target.newId();
    while (occupied.has(id)) id = target.newId();
    project = copyProject(project, id, `${project.name.slice(0, 244)} (imported)`);
  }
  const files = [...project.files, ...project.images];
  const current = target.projects.flatMap(p => [...p.files, ...p.images]);
  for (const file of files) {
    if (current.some(other => other.id === file.id && other.hash !== undefined && other.hash !== file.hash)) throw new Error(`${file.name} uses an id already held by a different file in this browser.`);
    const existing = await readStoredBlob(target.records, file.id);
    if (existing && await sha256Hex(await existing.arrayBuffer()) !== file.hash) throw new Error(`${file.name} uses an id already held by a different file in this browser.`);
    if (!existing && current.some(other => other.id === file.id && other.hash === undefined)) throw new Error(`${file.name} uses an existing image id whose missing bytes cannot be verified.`);
  }
  const stored = new Set<string>();
  for (const file of files) {
    options.progress?.(`Importing ${file.name}…`);
    const hash = file.hash!;
    if (!stored.has(hash)) {
      const existing = await target.records.get('blobs', contentKey(hash));
      if (!(existing instanceof Blob) || existing.size !== file.size || await sha256Hex(await existing.arrayBuffer()) !== hash) {
        await target.records.put('blobs', contentKey(hash), archive.blobs.get(file.id)!);
      }
      stored.add(hash);
    }
    await putProjectBlob(target.records, project.id, file.id, { contentHash: hash });
  }
  // This is the only publication: the account adapter queues it after all local bytes are durable.
  await target.records.put('projects', project.id, project);
  return project;
}
