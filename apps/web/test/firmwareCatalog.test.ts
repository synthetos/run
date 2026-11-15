import { afterEach, expect, it, vi } from 'vitest';
import { fetchFirmwareCatalog } from '../src/cloud/firmwareCatalog.ts';
afterEach(() => vi.unstubAllGlobals());
it('uses only the same-origin public endpoint and refuses redirects', async () => {
  const fetcher = vi.fn(async () => new Response('{"releases":[]}'));
  vi.stubGlobal('fetch', fetcher);
  expect(await fetchFirmwareCatalog()).toEqual({ releases: [] });
  expect(fetcher).toHaveBeenCalledWith('/api/firmware/releases', { credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
});
it('refuses failed, missing-body, oversized and invalid JSON responses', async () => {
  for (const response of [new Response('', { status: 502 }), new Response(null), new Response(' '.repeat(512001)), new Response('not json')]) {
    vi.stubGlobal('fetch', async () => response);
    await expect(fetchFirmwareCatalog()).rejects.toThrow();
  }
});
