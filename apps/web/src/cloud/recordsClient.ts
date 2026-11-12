import type { CloudRecord, RecordKind } from '@synthetos/contracts';
import type { FetchLike } from './live.ts';

export class RecordsError extends Error {
  readonly status: number;
  readonly current: CloudRecord | null;
  constructor(status: number, current: CloudRecord | null = null) { super(`Records request failed (${status})`); this.status = status; this.current = current; }
}
function record(value: unknown, kind: RecordKind): CloudRecord {
  const r = value as Partial<CloudRecord> | null;
  if (r === null || typeof r !== 'object' || r.kind !== kind || typeof r.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(r.id) || !Number.isSafeInteger(r.rev) || (r.rev as number) < 1 || typeof r.sha256 !== 'string' || !(r.archivedAt === null || typeof r.archivedAt === 'number')) throw new RecordsError(502);
  return r as CloudRecord;
}
export interface RecordsClient {
  list(kind: RecordKind, signal: AbortSignal): Promise<CloudRecord[]>;
  put(kind: RecordKind, id: string, parent: number | null, content: unknown, signal: AbortSignal): Promise<CloudRecord>;
  archive(kind: RecordKind, id: string, parent: number, signal: AbortSignal): Promise<CloudRecord>;
}
/** Only same-origin requests, with the session cookie and the mutation CSRF header. */
export function recordsClient(fetchFn: FetchLike = (i, o) => fetch(i, o)): RecordsClient {
  async function request(kind: RecordKind, suffix: string, signal: AbortSignal, method = 'GET', body?: unknown): Promise<Record<string, unknown>> {
    const response = await fetchFn(`/api/records/${kind}${suffix}`, { method, signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error', ...(body === undefined ? {} : { headers: { 'content-type': 'application/json', 'x-synthetos-request': '1' }, body: JSON.stringify(body) }) });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { current?: unknown } | null;
      throw new RecordsError(response.status, error?.current == null ? null : record(error.current, kind));
    }
    const data = await response.json() as Record<string, unknown> | null;
    if (data === null || typeof data !== 'object') throw new RecordsError(502);
    return data;
  }
  async function write(kind: RecordKind, id: string, parent: number | null, signal: AbortSignal, method: string, content?: unknown): Promise<CloudRecord> {
    return record((await request(kind, `/${encodeURIComponent(id)}`, signal, method, { parent_rev: parent, ...(method === 'PUT' ? { content } : {}) }))['record'], kind);
  }
  return {
    async list(kind, signal) {
      const all: CloudRecord[] = []; let after = '';
      for (;;) {
        const page = (await request(kind, `?include_archived=1${after === '' ? '' : `&after=${encodeURIComponent(after)}`}`, signal))['records'];
        if (!Array.isArray(page)) throw new RecordsError(502);
        const rows = page.map(v => record(v, kind));
        for (const row of rows) { if (row.id <= after) throw new RecordsError(502); after = row.id; all.push(row); }
        if (rows.length < 100) return all;
      }
    },
    put: (kind, id, parent, content, signal) => write(kind, id, parent, signal, 'PUT', content),
    archive: (kind, id, parent, signal) => write(kind, id, parent, signal, 'DELETE'),
  };
}
