import { describe, expect, it, vi } from 'vitest';
import { latestGithubReleases, MAX_GITHUB_HEX_BYTES } from '../src/githubReleaseData.ts';
import { githubReleaseLoader, RELEASE_CACHE_MS, TINYG_RELEASES_API } from '../src/githubReleases.ts';
const asset = (name = 'tinyg-450.05.hex') => ({ name, size: 123, digest: `sha256:${'a'.repeat(64)}`, browser_download_url: 'https://attacker.invalid/ignored' });
const release = (n: number) => ({ draft: false, tag_name: `450.0${n}`, published_at: `2026-11-0${n}T00:00:00Z`, prerelease: true, body: '<script>plain notes</script>', assets: [asset(`tinyg-450.0${n}.hex`)] });
describe('TinyG release selection', () => {
  it('takes newest five, includes labelled prereleases, ignores drafts and ambiguous/no hex assets', () => {
    const list = latestGithubReleases([release(1), release(3), release(6), release(4), release(2), release(5), { ...release(7), draft: true }, { ...release(8), assets: [asset(), asset('tinyg-other.hex')] }, { ...release(9), assets: [] }]);
    expect(list.map(r => r.tag)).toEqual(['450.06', '450.05', '450.04', '450.03', '450.02']);
    expect(list[0]).toMatchObject({ repo: 'synthetos/TinyG', prerelease: true, notes: '<script>plain notes</script>', unavailable: null });
    expect(list[0]).not.toHaveProperty('browser_download_url');
  });
  it('keeps a missing digest or bad size visible with a refusal reason, not as flashable data', () => {
    for (const digest of [undefined, 'sha256:abc', `md5:${'a'.repeat(64)}`]) expect(latestGithubReleases([{ ...release(1), assets: [{ ...asset(), digest }] }])[0]).toMatchObject({ sha256: null, unavailable: expect.stringContaining('SHA-256') });
    for (const size of [0, -1, 1.5, MAX_GITHUB_HEX_BYTES + 1]) expect(latestGithubReleases([{ ...release(1), assets: [{ ...asset(), size }] }])[0]).toMatchObject({ size: 0, unavailable: expect.stringContaining('size') });
  });
  it('refuses malformed lists and unsafe tag paths', () => {
    expect(() => latestGithubReleases({})).toThrow();
    expect(latestGithubReleases([{ ...release(1), tag_name: '../other' }, null])).toEqual([]);
  });
});
it('fetches only the fixed API, coalesces refresh and expires after ten minutes', async () => {
  let now = 0;
  const fetcher = vi.fn(async () => new Response(JSON.stringify([release(1)])));
  const load = githubReleaseLoader(fetcher, () => now);
  await Promise.all([load(), load()]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toEqual([TINYG_RELEASES_API, expect.objectContaining({ method: 'GET', redirect: 'error' })]);
  now = RELEASE_CACHE_MS - 1; await load(); expect(fetcher).toHaveBeenCalledTimes(1);
  now++; await load(); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('never serves expired data after a failed refresh and retries the next request', async () => {
  let now = 0;
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([release(1)]))).mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('[]'));
  const load = githubReleaseLoader(fetcher, () => now);
  await load(); now = RELEASE_CACHE_MS;
  await expect(load()).rejects.toThrow('could not load');
  expect(await load()).toEqual([]);
});
it('caps the API response before decoding it', async () => {
  const load = githubReleaseLoader(async () => new Response(' '.repeat(2 * 1024 * 1024 + 1)));
  await expect(load()).rejects.toThrow('size limit');
});
