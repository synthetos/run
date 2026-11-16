import type { StoredFile } from '@synthetos/contracts';
import type { FetchLike } from './live.ts';
import { RecordsError } from './recordsClient.ts';

export class FilesError extends RecordsError {
  readonly reason: string;
  constructor(status: number, reason: string) { super(status); this.reason = reason; }
}
export interface FilesClient {
  put(hash: string, blob: Blob, signal: AbortSignal): Promise<void>;
  get(hash: string, signal: AbortSignal): Promise<Blob>;
  list(signal: AbortSignal): Promise<StoredFile[]>;
  remove(hash: string, signal: AbortSignal): Promise<void>;
}
const validHash = (hash: string): boolean => /^[0-9a-f]{64}$/.test(hash);
/** Same-origin session requests only. Fetch sets Content-Length from the Blob, including zero bytes. */
export function filesClient(fetchFn: FetchLike = (i, o) => fetch(i, o)): FilesClient {
  async function request(hash: string | null, method: string, signal: AbortSignal, blob?: Blob): Promise<Response> {
    if (hash !== null && !validHash(hash)) throw new FilesError(422, 'invalid');
    const response = await fetchFn(`/api/files${hash === null ? '' : `/${hash}`}`, {
      method, signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      ...(method === 'GET' ? {} : { headers: { 'x-synthetos-request': '1', ...(blob === undefined ? {} : { 'content-type': 'application/octet-stream' }) } }),
      ...(blob === undefined ? {} : { body: blob }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { error?: string } | null;
      throw new FilesError(response.status, data?.error ?? 'failed');
    }
    return response;
  }
  return {
    async put(hash, blob, signal) { await request(hash, 'PUT', signal, blob); },
    async get(hash, signal) { return (await request(hash, 'GET', signal)).blob(); },
    async list(signal) {
      const data = await (await request(null, 'GET', signal)).json() as { files?: StoredFile[] };
      if (!Array.isArray(data.files) || !data.files.every(f => validHash(f.sha256) && Number.isSafeInteger(f.size) && f.size >= 0 && Number.isFinite(f.createdAt))) throw new FilesError(502, 'invalid');
      return data.files;
    },
    async remove(hash, signal) {
      try { await request(hash, 'DELETE', signal); }
      catch (error) { if (!(error instanceof FilesError && (error.status === 404 || (error.status === 409 && error.reason === 'in_use')))) throw error; }
    },
  };
}
