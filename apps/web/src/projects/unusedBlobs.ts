import type { Project } from '@synthetos/library';
import { contentKey, type ProjectRecordStore } from './blobStore.ts';

/** Imported copies can share ids and content; removing one reference must not break another project. */
export async function removeUnusedBlob(records: ProjectRecordStore, removed: { id: string; hash?: string }, remaining: readonly Project[]): Promise<void> {
  const files = remaining.flatMap(p => [...p.files, ...p.images]);
  if (files.some(file => file.id === removed.id)) return;
  await records.delete('blobs', removed.id);
  if (removed.hash && !files.some(file => file.hash === removed.hash)) await records.delete('blobs', contentKey(removed.hash));
}
