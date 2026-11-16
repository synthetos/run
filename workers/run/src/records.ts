import type { RecordKind, RecordResult } from '@synthetos/contracts';
import { RECORD_KINDS, recordMaxBytes } from './limits.ts';
import { accountRequest, type Account } from './accountGate.ts';
import { json, type Env } from './routes.ts';

/** Room for the revision envelope around a record's content. */
const ENVELOPE_BYTES = 6 * 1024;
const PATH = new RegExp(`^/api/records/(${RECORD_KINDS.join('|')})(?:/([a-z0-9][a-z0-9._-]{0,63}))?$`);

/** Bound the streamed request, including the revision envelope, before parsing JSON. */
async function body(request: Request, limit: number): Promise<Record<string, unknown> | null> {
  const reader = request.body?.getReader(); if (reader === undefined) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > limit) { await reader.cancel(); return null; } chunks.push(next.value); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; }
}

function response(result: RecordResult): Response {
  return json(result.ok ? 200 : ({ invalid: 400, not_found: 404, conflict: 409, quota: 413 } as const)[result.error], result);
}

async function read(url: URL, { actor, data }: Account, kind: RecordKind, id: string | undefined): Promise<Response> {
  const keys = [...url.searchParams.keys()];
  if (keys.some((k) => k !== 'after' && k !== 'include_archived') || (id !== undefined && url.search !== '')) return json(400, { error: 'invalid' });
  if (url.searchParams.has('include_archived') && url.searchParams.get('include_archived') !== '1') return json(400, { error: 'invalid' });
  if (id !== undefined) return response(await data.get(actor, kind, id));
  return json(200, { records: await data.list(actor, kind, url.searchParams.get('after') ?? '', url.searchParams.get('include_archived') === '1') });
}

async function write(request: Request, { actor, data }: Account, kind: RecordKind, id: string): Promise<Response> {
  const input = await body(request, recordMaxBytes(kind) + ENVELOPE_BYTES);
  const allowed = ['parent_rev', ...(request.method === 'PUT' ? ['content'] : [])];
  if (input === null || Object.keys(input).some((k) => !allowed.includes(k))) return json(400, { error: 'invalid' });
  const parent = input['parent_rev'];
  if (parent !== null && (typeof parent !== 'number' || !Number.isSafeInteger(parent) || parent < 1)) return json(400, { error: 'invalid' });
  if (request.method === 'DELETE') return parent === null ? json(400, { error: 'invalid' }) : response(await data.archive(actor, kind, id, parent as number));
  return response(await data.put(actor, kind, id, parent as number | null, input['content']));
}

/** `/api/records/<kind>[/<id>]`: the account's records of one kind, read and written with the revision envelope. */
export async function recordsRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const match = PATH.exec(url.pathname);
  if (match === null) return json(404, { error: 'not_found' });
  const kind = match[1] as RecordKind; const id = match[2];
  const gate = await accountRequest(request, env, { allow: id === undefined ? ['GET'] : ['GET', 'PUT', 'DELETE'], unavailable: 'records_unavailable' });
  if (!gate.ok) return gate.response;
  if (request.method === 'GET') return read(url, gate, kind, id);
  if (url.search !== '') return json(400, { error: 'invalid' });
  return write(request, gate, kind, id!);
}
