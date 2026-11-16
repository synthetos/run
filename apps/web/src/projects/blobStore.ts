import type { RecordStore } from '../workspace/storage.ts';

/** Project adapters choose blob ownership using the project, before bytes are written. */
export interface ProjectRecordStore extends RecordStore {
  putBlob?(projectId: string, blobId: string, blob: Blob): Promise<void>;
  readAside?(key: string): Promise<unknown>;
}
export function putProjectBlob(records: ProjectRecordStore, projectId: string, blobId: string, blob: Blob): Promise<void> {
  return records.putBlob ? records.putBlob(projectId, blobId, blob) : records.put('blobs', blobId, blob);
}
