import type { FileError, FileResult, RecordActor } from '@synthetos/contracts';
import { FILE_MAX_BYTES } from './limits.ts';
import { accountRequest, type AccountData } from './accountGate.ts';
import { API_CACHE_CONTROL } from './headers.ts';
import { json, type Env } from './routes.ts';

const PATH = /^\/api\/files(?:\/([0-9a-f]{64}))?$/;
const STATUS: Readonly<Record<FileError, number>> = { invalid: 400, not_found: 404, in_use: 409, busy: 409, quota: 413, mismatch: 422, failed: 502 };
const answer = (result: FileResult): Response => json(result.ok ? (result.existed ? 200 : 201) : STATUS[result.error], result);

/** The declared size (an empty file is a file), which the store reserves before the bytes move; a body without one is refused. */
function declaredSize(request: Request): number | null {
  const header = request.headers.get('content-length');
  if (header === null || !/^[0-9]{1,12}$/.test(header)) return null;
  const size = Number(header);
  return size <= FILE_MAX_BYTES ? size : null;
}

async function put(request: Request, actor: RecordActor, data: AccountData, sha256: string): Promise<Response> {
  const size = declaredSize(request);
  const body = request.body ?? (size === 0 ? new ReadableStream<Uint8Array>({ start(c) { c.close(); } }) : null);
  if (size === null || body === null) return json(400, { error: 'invalid' });
  return answer(await data.putFile(actor, sha256, size, body));
}

/** The bytes as a download: never rendered, never sniffed, never cached. */
async function get(actor: RecordActor, data: AccountData, sha256: string): Promise<Response> {
  const result = await data.getFile(actor, sha256);
  if (!result.ok) return json(STATUS[result.error], { ok: false, error: result.error });
  return new Response(result.body, {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(result.file.size),
      'content-disposition': `attachment; filename="${sha256}"`,
      'cache-control': API_CACHE_CONTROL,
    },
  });
}

/** `/api/files[/<sha256>]`: the account's files by content. PUT streams the bytes in, GET streams them out. */
export async function filesRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const match = PATH.exec(url.pathname);
  if (match === null) return json(404, { error: 'not_found' });
  const sha256 = match[1];
  const gate = await accountRequest(request, env, { allow: sha256 === undefined ? ['GET'] : ['GET', 'PUT', 'DELETE'], unavailable: 'files_unavailable', body: 'bytes' });
  if (!gate.ok) return gate.response;
  if (url.search !== '') return json(400, { error: 'invalid' });
  const { actor, data } = gate;
  if (sha256 === undefined) return json(200, { files: await data.listFiles(actor) });
  if (request.method === 'PUT') return put(request, actor, data, sha256);
  if (request.method === 'DELETE') return answer(await data.deleteFile(actor, sha256));
  return get(actor, data, sha256);
}
