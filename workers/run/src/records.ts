import type { RecordKind, RecordResult, RunDataBinding } from '@synthetos/contracts';
import { authConfig } from './authConfig.ts';
import { runSessionIdentity } from './authSession.ts';
import { sameOriginMutation } from './authLogout.ts';
import { json, type Env } from './routes.ts';
/** Bound the streamed request, including the revision envelope, before parsing JSON. */
async function body(request: Request): Promise<Record<string, unknown> | null> {
  const reader = request.body?.getReader(); if (reader === undefined) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 71_680) { await reader.cancel(); return null; } chunks.push(next.value); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
  try { const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; }
}
function response(result: RecordResult): Response {
  return json(result.ok ? 200 : ({ invalid: 400, not_found: 404, conflict: 409, quota: 413 } as const)[result.error], result);
}
export async function recordsRoute(request: Request, env: Env & { readonly RUN_DATA?: RunDataBinding }): Promise<Response> {
  const config = authConfig(env, new URL(request.url));
  const identity = config === null ? null : await runSessionIdentity(request, config);
  if (identity === null || config === null) return json(401, { error: 'not_signed_in' });
  const url = new URL(request.url);
  const match = /^\/api\/records\/(tool|material)(?:\/([a-z0-9][a-z0-9._-]{0,63}))?$/.exec(url.pathname);
  if (match === null) return json(404, { error: 'not_found' });
  const kind = match[1] as RecordKind; const id = match[2];
  if (!['GET','PUT','DELETE'].includes(request.method) || (id === undefined && request.method !== 'GET')) return json(405, { error: 'method_not_allowed' }, { allow: id === undefined ? 'GET' : 'GET, PUT, DELETE' });
  const origin = request.headers.get('origin'); const site = request.headers.get('sec-fetch-site');
  if ((origin !== null && origin !== config.runOrigin) || (site !== null && site !== 'same-origin') || (request.method !== 'GET' && !sameOriginMutation(request, config.runOrigin))) return json(403, { error: 'cross_origin' });
  if (env.RUN_DATA === undefined || env.RUN_ENV !== 'staging') return json(503, { error: 'records_unavailable' });
  // The account and actor label come exclusively from the validated session, never body or URL.
  const actor = { userId: identity.subject, label: identity.display };
  if (request.method === 'GET') {
    if ([...url.searchParams.keys()].some(k => k !== 'after') || (id !== undefined && url.search !== '')) return json(400, { error: 'invalid' });
    return id === undefined ? json(200, { records: await env.RUN_DATA.list(actor, kind, url.searchParams.get('after') ?? '') }) : response(await env.RUN_DATA.get(actor, kind, id));
  }
  if (url.search !== '') return json(400, { error: 'invalid' });
  const input = await body(request);
  if (input === null || Object.keys(input).some(k => !['parent_rev', ...(request.method === 'PUT' ? ['content'] : [])].includes(k))) return json(400, { error: 'invalid' });
  const parent = input['parent_rev'];
  if (parent !== null && (typeof parent !== 'number' || !Number.isSafeInteger(parent) || parent < 1)) return json(400, { error: 'invalid' });
  if (request.method === 'DELETE') return parent === null ? json(400, { error: 'invalid' }) : response(await env.RUN_DATA.archive(actor, kind, id!, parent as number));
  return response(await env.RUN_DATA.put(actor, kind, id!, parent as number | null, input['content']));
}
