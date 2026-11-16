import type { ProjectRecordStore } from './blobStore.ts';

/** Draft-job bytes have their own lifetime, outside project archives and project file ids. */
export class ProjectDraftStore {
  readonly #records: ProjectRecordStore;
  constructor(records: ProjectRecordStore) { this.#records = records; }
  async keepAside(key: string, blob: Blob): Promise<boolean> {
    try { await this.#records.put('blobs', `aside/${key}`, blob); return true; }
    catch { return false; }
  }
  async aside(key: string): Promise<Blob | null> {
    const records = this.#records;
    const value = records.readAside ? await records.readAside(key) : await records.get('blobs', `aside/${key}`);
    return value instanceof Blob ? value : null;
  }
  async forgetAside(key: string): Promise<void> { await this.#records.delete('blobs', `aside/${key}`); }
}
