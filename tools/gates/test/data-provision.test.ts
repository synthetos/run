import { expect, it } from 'vitest';
import { provisionData, type ApiFetch } from '../src/deploy/dataProvision.ts';
import { dataDeployConfig } from '../src/deploy/dataConfig.ts';
const account = 'a'.repeat(32);
const uuid = '11111111-1111-1111-1111-111111111111';
function fake(exists = false) {
  const calls: string[] = [];
  let bucket = exists; let database = exists;
  const fetcher: ApiFetch = async (url, init) => {
    const path = new URL(url).pathname;
    const resource = path.endsWith('/r2/buckets') ? 'R2' : path.endsWith('/d1/database') ? 'D1' : 'unexpected';
    expect(resource).not.toBe('unexpected'); // No token introspection endpoints.
    expect(init.headers).toMatchObject({ authorization: resource === 'R2' ? 'Bearer deploy' : 'Bearer d1' });
    expect(init.redirect).toBe('error');
    calls.push(`${init.method} ${resource}`);
    let result: unknown;
    if (init.method === 'POST') {
      expect(JSON.parse(init.body as string)).toEqual({ name: resource === 'R2' ? 'run-files-staging' : 'run-data-staging' });
      if (resource === 'R2') bucket = true; else database = true;
      result = { uuid };
    } else result = resource === 'R2' ? { buckets: bucket ? [{ name: 'run-files-staging' }] : [] } : database ? [{ name: 'run-data-staging', uuid }] : [];
    return Response.json({ success: true, result });
  };
  return { fetcher, calls };
}

it('finishes R2 before D1, creates missing resources and reuses them on retry', async () => {
  const api = fake();
  expect(await provisionData(account, 'deploy', 'd1', api.fetcher)).toBe(uuid);
  expect(api.calls).toEqual(['GET R2', 'POST R2', 'GET D1', 'POST D1']);
  api.calls.length = 0;
  expect(await provisionData(account, 'deploy', 'd1', api.fetcher)).toBe(uuid);
  expect(api.calls).toEqual(['GET R2', 'GET D1']);
  const c = dataDeployConfig(account, uuid);
  expect(c).toMatchObject({ workers_dev: false, preview_urls: false, routes: [], name: 'run-data-staging' });
  expect(c).not.toHaveProperty('build');
});

for (const status of [401, 403]) {
  for (const resource of ['R2', 'D1']) {
    it.each(['GET', 'POST'])(`${status} from ${resource} %s names the exact token and dashboard permission`, async method => {
      const api = fake(); let denied = false;
      const fetcher: ApiFetch = async (url, init) => {
        expect(denied, 'no call after refusal').toBe(false);
        if (url.includes(resource === 'R2' ? '/r2/buckets' : '/d1/database') && init.method === method) {
          denied = true;
          return new Response('sensitive response body', { status });
        }
        return api.fetcher(url, init);
      };
      const message = resource === 'R2' ? 'CLOUDFLARE_API_TOKEN: add Workers R2 Storage: Edit for the configured account' : 'CLOUDFLARE_D1_API_TOKEN: add D1: Edit for the configured account';
      await expect(provisionData(account, 'deploy', 'd1', fetcher)).rejects.toThrow(message);
      expect(denied).toBe(true);
      if (resource === 'R2') expect(api.calls.some(c => c.includes('D1'))).toBe(false);
    });
  }
}

it('reuses an R2 bucket left behind when the later D1 grant fails', async () => {
  const api = fake();
  const failD1: ApiFetch = (url, init) => url.includes('/d1/') ? Promise.resolve(new Response('', { status: 403 })) : api.fetcher(url, init);
  await expect(provisionData(account, 'deploy', 'd1', failD1)).rejects.toThrow('D1: Edit');
  expect(api.calls).toEqual(['GET R2', 'POST R2']);
  api.calls.length = 0;
  expect(await provisionData(account, 'deploy', 'd1', api.fetcher)).toBe(uuid);
  expect(api.calls).toEqual(['GET R2', 'GET D1', 'POST D1']);
});

it('finds existing resources across R2 cursors and D1 pages without creating', async () => {
  const calls: string[] = [];
  const fetcher: ApiFetch = async (url, init) => {
    expect(init.method).toBe('GET'); calls.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith('/r2/buckets')) return Response.json({ success: true, result: { buckets: u.searchParams.has('cursor') ? [{ name: 'run-files-staging' }] : [] }, result_info: u.searchParams.has('cursor') ? {} : { cursor: 'next page' } });
    return Response.json({ success: true, result: u.searchParams.get('page') === '2' ? [{ name: 'run-data-staging', uuid }] : [], result_info: { total_pages: 2 } });
  };
  expect(await provisionData(account, 'deploy', 'd1', fetcher)).toBe(uuid);
  expect(calls).toHaveLength(4);
  expect(calls[1]).toContain('cursor=next%20page');
  expect(calls[3]).toContain('page=2');
});

it('fails closed on other service errors without printing response bodies', async () => {
  await expect(provisionData(account, 'deploy', 'd1', async () => new Response('secret', { status: 500 }))).rejects.toThrow('CLOUDFLARE_API_TOKEN: Cloudflare GET failed (500); no later step ran');
});
