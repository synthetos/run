import type { RecordStore } from '../workspace/storage.ts';

/** Project adapters choose blob ownership using the project, before bytes are written. */
export interface ProjectRecordStore extends RecordStore {
  putBlob?(projectId: string, blobId: string, blob: Blob | BlobLink): Promise<void>;
  readAside?(key: string): Promise<unknown>;
}
export function putProjectBlob(records: ProjectRecordStore, projectId: string, blobId: string, blob: Blob | BlobLink): Promise<void> {
  return records.putBlob ? records.putBlob(projectId, blobId, blob) : records.put('blobs', blobId, blob);
}
export interface BlobLink { contentHash: string }
export const contentKey = (hash: string): string => `content/${hash}`;
export function blobLink(value: unknown): value is BlobLink {
  return typeof value === 'object' && value !== null && 'contentHash' in value && typeof value.contentHash === 'string' && /^[a-f0-9]{64}$/.test(value.contentHash);
}
export async function readStoredBlob(records: RecordStore, id: string): Promise<Blob | null> {
  const value = await records.get('blobs', id);
  const blob = blobLink(value) ? await records.get('blobs', contentKey(value.contentHash)) : value;
  return blob instanceof Blob ? blob : null;
}
