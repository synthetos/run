import { describe, expect, it } from 'vitest';
import { FILE_MAX_BYTES } from '@synthetos/contracts';
import { route } from '../src/routes.ts';
import { SESSION_COOKIE, accountEnv } from './accountHarness.ts';

const HASH = 'ab'.repeat(32);
function requestFor(origin: string) {
  return function request(path: string, method = 'GET', body?: Uint8Array, extra: Record<string, string> = {}): Request {
    const headers: Record<string, string> = { cookie: SESSION_COOKIE, origin, 'sec-fetch-site': 'same-origin', 'x-synthetos-request': '1', ...extra };
    if (body !== undefined && !('content-length' in extra)) headers['content-length'] = String(body.byteLength);
    return new Request(`${origin}/api/files${path}`, { method, headers, ...(body === undefined ? {} : { body: body.slice().buffer }) });
  };
}
describe.each(['staging', 'production'] as const)('%s files', environment => {
  const ORIGIN = accountEnv(environment).origin;
  const request = requestFor(ORIGIN);
  const bytes = new TextEncoder().encode('G21\nM30\n');
  const stream = (b: Uint8Array) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(b); c.close(); } });

  it('needs the run session, a known path and a same-origin mutation; nothing reaches the data Worker otherwise', async () => {
    const { env, actors } = accountEnv(environment);
    env.ACCOUNTS!.validateSession = async () => null;
    expect((await route(request(''), env)).status).toBe(401);
    const signed = accountEnv(environment);
    expect((await route(request('/abc'), signed.env)).status).toBe(404);
    expect((await route(request(`/${HASH}`, 'POST', bytes), signed.env)).status).toBe(405);
    expect((await route(request('', 'PUT', bytes), signed.env)).status).toBe(405);
    expect((await route(request(`/${HASH}`, 'PUT', bytes, { origin: 'https://evil.example' }), signed.env)).status).toBe(403);
    expect((await route(request(`/${HASH}`, 'DELETE', undefined, { 'x-synthetos-request': '' }), signed.env)).status).toBe(403);
    expect((await route(request(`/${HASH}?x=1`), signed.env)).status).toBe(400);
    expect(actors).toEqual([]); expect(signed.actors).toEqual([]);
    const { RUN_DATA: _unbound, ...unbound } = accountEnv(environment).env;
    expect((await route(request(''), unbound)).status).toBe(503);
    expect(await (await route(request(''), unbound)).json()).toEqual({ error: 'files_unavailable' });
  });

  it('lists, uploads with the declared size, and reports each outcome with its own status', async () => {
    const { env, data, actors } = accountEnv(environment);
    const calls: unknown[] = [];
    data.putFile = async (actor, sha256, size, body) => { actors.push(actor); calls.push([sha256, size, new TextDecoder().decode((await body.getReader().read()).value)]); return { ok: true, existed: false, file: { sha256, size, createdAt: 1 } }; };
    expect((await route(request(''), env)).status).toBe(200);
    expect(await (await route(request(''), env)).json()).toEqual({ files: [] });
    const created = await route(request(`/${HASH}`, 'PUT', bytes), env);
    expect(created.status).toBe(201);
    expect(calls).toEqual([[HASH, bytes.byteLength, 'G21\nM30\n']]);
    expect(actors.every((a) => a.userId === 'usr_alice' && a.label === '@alice')).toBe(true);
    data.putFile = async (_a, sha256, size) => ({ ok: true, existed: true, file: { sha256, size, createdAt: 1 } });
    expect((await route(request(`/${HASH}`, 'PUT', bytes), env)).status).toBe(200);
    for (const [error, status] of [['quota', 413], ['mismatch', 422], ['failed', 502], ['invalid', 400]] as const) {
      data.putFile = async () => ({ ok: false, error });
      expect((await route(request(`/${HASH}`, 'PUT', bytes), env)).status).toBe(status);
    }
  });

  it('refuses an upload without a usable declared size before calling the data Worker', async () => {
    const { env, actors } = accountEnv(environment);
    expect((await route(request(`/${HASH}`, 'PUT', bytes, { 'content-length': '-1' }), env)).status).toBe(400);
    expect((await route(request(`/${HASH}`, 'PUT', bytes, { 'content-length': String(FILE_MAX_BYTES + 1) }), env)).status).toBe(400);
    expect((await route(request(`/${HASH}`, 'PUT', bytes, { 'content-length': 'many' }), env)).status).toBe(400);
    expect((await route(request(`/${HASH}`, 'PUT'), env)).status).toBe(400);
    expect(actors).toEqual([]);
  });

  it('streams a file back as a download and deletes with the store’s answer', async () => {
    const { env, data } = accountEnv(environment);
    data.getFile = async (_a, sha256) => ({ ok: true, file: { sha256, size: bytes.byteLength, createdAt: 1 }, body: stream(bytes) });
    const got = await route(request(`/${HASH}`), env);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('application/octet-stream');
    expect(got.headers.get('content-disposition')).toBe(`attachment; filename="${HASH}"`);
    expect(got.headers.get('content-length')).toBe(String(bytes.byteLength));
    expect(got.headers.get('cache-control')).toContain('no-store');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
    data.getFile = async () => ({ ok: false, error: 'failed' });
    expect((await route(request(`/${HASH}`), env)).status).toBe(502);
    expect((await route(request(`/${HASH}`, 'DELETE'), env)).status).toBe(404);
    data.deleteFile = async () => ({ ok: false, error: 'in_use' });
    expect((await route(request(`/${HASH}`, 'DELETE'), env)).status).toBe(409);
    data.deleteFile = async (_a, sha256) => ({ ok: true, existed: true, file: { sha256, size: 1, createdAt: 1 } });
    expect((await route(request(`/${HASH}`, 'DELETE'), env)).status).toBe(200);
  });
  it('passes a zero-byte upload to the data Worker with an empty stream', async () => {
    const { env, data } = accountEnv(environment);
    let seen: number | null = null;
    data.putFile = async (_a, sha256, size, body) => { seen = size; await body.cancel(); return { ok: true, existed: false, file: { sha256, size, createdAt: 1 } }; };
    expect((await route(request(`/${HASH}`, 'PUT', new Uint8Array(0)), env)).status).toBe(201);
    expect(seen).toBe(0);
  });

});

it.each(['staging', 'production'] as const)('%s permits typed binary files but refuses a non-JSON record body', async environment => {
  const ORIGIN = accountEnv(environment).origin;
  const request = requestFor(ORIGIN);
  const bytes = new TextEncoder().encode('G21\nM30\n');
    const { env, data, actors } = accountEnv(environment);
    data.putFile = async (actor, sha256, size) => { actors.push(actor); return { ok: true, existed: false, file: { sha256, size, createdAt: 1 } }; };
    expect((await route(request(`/${HASH}`, 'PUT', bytes, { 'content-type': 'application/octet-stream' }), env)).status).toBe(201);
    expect((await route(request(`/${HASH}`, 'PUT', bytes, { 'content-type': 'image/png' }), env)).status).toBe(201);
    expect(actors).toHaveLength(2);
    const record = new Request(`${ORIGIN}/api/records/tool/mine.t1`, { method: 'PUT', headers: { cookie: SESSION_COOKIE, origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-synthetos-request': '1', 'content-type': 'application/octet-stream' }, body: '{}' });
    expect((await route(record, env)).status).toBe(403);
    data.deleteFile = async () => ({ ok: false, error: 'busy' });
    expect((await route(request(`/${HASH}`, 'DELETE'), env)).status).toBe(409);
  });
