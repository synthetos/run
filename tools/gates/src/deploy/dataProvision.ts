/** CI-only staging provisioning. Actual resource calls check access; tests inject fetch. */
export type ApiFetch = (url: string, init: RequestInit) => Promise<Response>;
interface Envelope { success: boolean; result: unknown; result_info?: { total_pages?: number; cursor?: string } }
export async function provisionData(account: string, deployToken: string, d1Token: string, fetcher: ApiFetch = fetch): Promise<string> {
  if (!/^[0-9a-f]{32}$/.test(account)) throw new Error('CLOUDFLARE_ACCOUNT_ID must name the reviewed account');
  async function api(token: string, secret: string, path: string, permission: string, method = 'GET', body?: unknown): Promise<Envelope> {
    const denied = `${secret}: add ${permission} for the configured account`;
    if (!token) throw new Error(denied);
    const response = await fetcher(`https://api.cloudflare.com/client/v4${path}`, { method, redirect: 'error', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status === 401 || response.status === 403) throw new Error(denied);
    if (!response.ok) throw new Error(`${secret}: Cloudflare ${method} failed (${response.status}); no later step ran`);
    const result = await response.json() as Envelope;
    if (!result.success) throw new Error(`${secret}: Cloudflare refused ${method}; no later step ran`);
    return result;
  }
  // R2 is the most likely missing grant. Finish it first; retries reuse any resource already created.
  let bucket = false; let cursor = '';
  do {
    const list = await api(deployToken, 'CLOUDFLARE_API_TOKEN', `/accounts/${account}/r2/buckets?per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, 'Workers R2 Storage: Edit');
    bucket ||= (list.result as { buckets: { name: string }[] }).buckets.some(b => b.name === 'run-files-staging');
    cursor = list.result_info?.cursor ?? '';
  } while (cursor);
  if (!bucket) await api(deployToken, 'CLOUDFLARE_API_TOKEN', `/accounts/${account}/r2/buckets`, 'Workers R2 Storage: Edit', 'POST', { name: 'run-files-staging' });

  let database: string | undefined;
  for (let page = 1; ; page++) {
    const list = await api(d1Token, 'CLOUDFLARE_D1_API_TOKEN', `/accounts/${account}/d1/database?per_page=100&page=${page}`, 'D1: Edit');
    for (const row of list.result as { name: string; uuid: string }[]) if (row.name === 'run-data-staging') database = row.uuid;
    if (page >= (list.result_info?.total_pages ?? 1)) break;
  }
  if (database === undefined) database = ((await api(d1Token, 'CLOUDFLARE_D1_API_TOKEN', `/accounts/${account}/d1/database`, 'D1: Edit', 'POST', { name: 'run-data-staging' })).result as { uuid: string }).uuid;
  if (!/^[0-9a-f-]{36}$/.test(database)) throw new Error('Cloudflare returned an invalid D1 id');
  return database;
}
