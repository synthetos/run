import { expect, it } from 'vitest';
import worker from '../src/index.ts';
import { catalogRoute } from '../src/catalogRoute.ts';
import { CATALOG_VERSION } from '../src/catalogData.ts';
it.each(['staging', 'production'])('serves public catalog without session/bindings on %s', async env => {
  const response = await worker.fetch(new Request('https://run.example/api/catalog/tools', { headers: { origin: 'https://run.example', 'sec-fetch-site': 'same-origin' } }), { RUN_ENV: env, ASSETS: { fetch: async () => { throw Error('not an asset'); } } });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(await response.json()).toMatchObject({ version: CATALOG_VERSION, tools: expect.any(Array) });
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
});
it('allows GET only, refuses cross-origin reads, and supports conditional caching', async () => {
  const url = 'https://run.example/api/catalog/tools';
  const first = catalogRoute(new Request(url)); expect(first.status).toBe(200);
  expect((await first.json() as {tools: unknown[]}).tools).toHaveLength(30);
  expect(catalogRoute(new Request(url, { headers: { 'if-none-match': first.headers.get('etag')! } })).status).toBe(304);
  expect(catalogRoute(new Request(url, { headers: { 'if-none-match': 'old' } })).status).toBe(200);
  for (const method of ['POST','PUT','DELETE','HEAD','OPTIONS']) expect(catalogRoute(new Request(url, {method})).status).toBe(405);
  for (const headers of [{origin:'https://other.example'}, {'sec-fetch-site':'cross-site'}, {'sec-fetch-site':'same-site'}]) expect(catalogRoute(new Request(url,{headers})).status).toBe(403);
});
