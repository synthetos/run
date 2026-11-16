import type { Project } from '@synthetos/library';
import { FilesError, type FilesClient } from '../../cloud/filesClient.ts';
import { sha256Hex } from '../../projects/image.ts';
import type { RecordStore } from '../storage.ts';

export const projectHashes = (project: Project): string[] => [...new Set([...project.files, ...project.images].flatMap(f => f.hash === undefined ? [] : [f.hash]))];
export interface ProjectFileAccess {
  records: RecordStore; files: FilesClient; allowed(): boolean; active(): boolean;
}
function check(access: ProjectFileAccess, signal: AbortSignal): void {
  if (signal.aborted || !access.active() || !access.allowed()) throw new DOMException('Sync paused', 'AbortError');
}
async function checkedBlob(access: ProjectFileAccess, file: Project['files'][number] | Project['images'][number]): Promise<Blob | null> {
  const blob = await access.records.get('blobs', file.id);
  if (!(blob instanceof Blob) || blob.size !== file.size) return null;
  return file.hash === undefined || await sha256Hex(await blob.arrayBuffer()) === file.hash ? blob : null;
}
/** Hash legacy WebP images from the bytes actually stored, before publishing the record. */
export async function hashProjectImages(project: Project, records: RecordStore): Promise<Project> {
  const images = [];
  for (const image of project.images) {
    if (image.hash !== undefined) { images.push(image); continue; }
    const blob = await records.get('blobs', image.id);
    if (!(blob instanceof Blob)) throw new FilesError(422, `${image.name}: the browser copy is missing`);
    images.push({ ...image, hash: await sha256Hex(await blob.arrayBuffer()) });
  }
  return { ...project, images };
}
/** Upload each referenced blob before the queue publishes this project's record. */
export async function uploadProjectFiles(project: Project, access: ProjectFileAccess, signal: AbortSignal): Promise<boolean> {
  let available = true;
  for (const file of [...project.files, ...project.images]) {
    check(access, signal);
    const blob = await checkedBlob(access, file);
    check(access, signal);
    // A remote, unchanged reference already has bytes in the account. Never download it to re-upload it.
    if (blob === null) {
      const remote = await access.files.list(signal);
      check(access, signal);
      if (remote.some(f => f.sha256 === file.hash && f.size === file.size)) { available = false; continue; }
      throw new FilesError(422, `${file.name}: the browser copy is missing or does not match`);
    }
    try { await access.files.put(file.hash!, blob, signal); }
    catch (error) {
      if (error instanceof FilesError && error.status === 422) throw new FilesError(422, `${file.name}: the account refused these bytes`);
      throw error;
    }
  }
  return available;
}
/** Verify both size and digest before storing an account download in this browser. */
export async function downloadProjectFiles(project: Project, access: ProjectFileAccess, signal: AbortSignal): Promise<void> {
  for (const file of [...project.files, ...project.images]) {
    check(access, signal);
    if (await checkedBlob(access, file) !== null) continue;
    if (file.hash === undefined) throw new FilesError(422, `${file.name}: the account image has no hash`);
    const blob = await access.files.get(file.hash, signal);
    check(access, signal);
    if (blob.size !== file.size || await sha256Hex(await blob.arrayBuffer()) !== file.hash) throw new FilesError(422, `${file.name}: downloaded bytes do not match`);
    check(access, signal);
    await access.records.put('blobs', file.id, blob);
  }
}
