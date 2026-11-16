import type { DeployEnvironment } from './wranglerConfig.ts';
import { dataNames } from './dataConfig.ts';
/** CI-only data provisioning. Actual resource calls check access; tests inject fetch. */
export type ApiFetch = (url: string, init: RequestInit) => Promise<Response>;
interface Envelope { success: boolean; result: unknown; result_info?: { total_pages?: number; cursor?: string } }
interface Credential { token: string; secret: string; permission: string }
interface RequestOptions { method?: string; body?: unknown }
type Api = (path: string, options?: RequestOptions) => Promise<Envelope>;
export interface DataProvisionOptions { environment?: DeployEnvironment; fetcher?: ApiFetch }
function apiFor(account: string, credential: Credential, fetcher: ApiFetch): Api {
  return async (path, { method = 'GET', body }: RequestOptions = {}) => {
    const { token, secret, permission } = credential;
    const denied = `${secret}: add ${permission} for the configured account`;
    if (!token) throw new Error(denied);
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, { method, redirect: 'error', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status === 401 || response.status === 403) throw new Error(denied);
    if (!response.ok) throw new Error(`${secret}: Cloudflare ${method} failed (${response.status}); no later step ran`);
    const result = await response.json() as Envelope;
    if (!result.success) throw new Error(`${secret}: Cloudflare refused ${method}; no later step ran`);
    return result;
  };
}
async function ensureBucket(api: Api, name: string): Promise<void> {
  let bucket = false; let cursor = '';
  do {
    const list = await api(`r2/buckets?per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    bucket ||= (list.result as { buckets: { name: string }[] }).buckets.some(b => b.name === name);
    cursor = list.result_info?.cursor ?? '';
  } while (cursor);
  if (!bucket) await api('r2/buckets', { method: 'POST', body: { name } });
}
async function ensureDatabase(api: Api, name: string): Promise<string> {
  let database: string | undefined;
  for (let page = 1; ; page++) {
    const list = await api(`d1/database?per_page=100&page=${page}`);
    for (const row of list.result as { name: string; uuid: string }[]) if (row.name === name) database = row.uuid;
    if (page >= (list.result_info?.total_pages ?? 1)) break;
  }
  if (database === undefined) database = ((await api('d1/database', { method: 'POST', body: { name } })).result as { uuid: string }).uuid;
  if (!/^[0-9a-f-]{36}$/.test(database)) throw new Error('Cloudflare returned an invalid D1 id');
  return database;
}
export async function provisionData(account: string, deployToken: string, d1Token: string, options: DataProvisionOptions = {}): Promise<string> {
  const names = dataNames(options.environment ?? 'staging');
  if (!/^[0-9a-f]{32}$/.test(account)) throw new Error('CLOUDFLARE_ACCOUNT_ID must name the reviewed account');
  const fetcher = options.fetcher ?? fetch;
  // Preserve staging order: R2 completes first; retries reuse resources left by a later D1 failure.
  await ensureBucket(apiFor(account, { token: deployToken, secret: 'CLOUDFLARE_API_TOKEN', permission: 'Workers R2 Storage: Edit' }, fetcher), names.bucket);
  return ensureDatabase(apiFor(account, { token: d1Token, secret: 'CLOUDFLARE_D1_API_TOKEN', permission: 'D1: Edit' }, fetcher), names.database);
}
