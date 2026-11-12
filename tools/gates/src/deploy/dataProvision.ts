/** CI-only provisioning. Reads both token policies before any write; tests inject fetch. */
export type ApiFetch = (url: string, init: RequestInit) => Promise<Response>;
interface Envelope { success: boolean; result: unknown; result_info?: { total_pages?: number; cursor?: string } }
interface Policy { effect: string; resources: Record<string,unknown>; permission_groups: { name: string }[] }
export async function provisionData(account: string, deployToken: string, d1Token: string, fetcher: ApiFetch = fetch): Promise<string> {
  if (!/^[0-9a-f]{32}$/.test(account)) throw new Error('CLOUDFLARE_ACCOUNT_ID must name the reviewed account');
  async function api(token: string, secret: string, path: string, permission: string, method = 'GET', body?: unknown): Promise<Envelope> {
    const response = await fetcher(`https://api.cloudflare.com/client/v4${path}`, { method, redirect:'error', headers:{authorization:`Bearer ${token}`,'content-type':'application/json'}, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
    if (response.status === 401 || response.status === 403) throw new Error(`${secret}: add ${permission} for the configured account`);
    if (!response.ok) throw new Error(`${secret}: Cloudflare ${method} failed (${response.status}); no later step ran`);
    const result = await response.json() as Envelope;
    if (!result.success) throw new Error(`${secret}: Cloudflare refused ${method}; no later step ran`);
    return result;
  }
  async function check(token: string, secret: string, needed: string[]): Promise<void> {
    if (!token) throw new Error(`${secret}: add ${needed.join(' and ')} for the configured account`);
    let base='/user/tokens'; let readPermission='API Tokens Read';
    let verified: {id?:string;status?:string};
    try { verified=(await api(token,secret,`${base}/verify`,readPermission)).result as typeof verified; }
    catch {
      base=`/accounts/${account}/tokens`; readPermission='Account API Tokens Read';
      verified=(await api(token,secret,`${base}/verify`,readPermission)).result as typeof verified;
    }
    if (verified.status !== 'active' || !/^[a-zA-Z0-9_-]+$/.test(verified.id ?? '')) throw new Error(`${secret}: token is not active`);
    const details = (await api(token,secret,`${base}/${verified.id}`,readPermission)).result as {policies?:Policy[]};
    const applicable = (details.policies ?? []).filter(p => p.resources[`com.cloudflare.api.account.${account}`] === '*' || p.resources['com.cloudflare.api.account.*'] === '*');
    if (applicable.some(p => p.effect !== 'allow')) throw new Error(`${secret}: remove conflicting deny policies for the configured account`);
    for (const permission of needed) if (!applicable.some(p => p.permission_groups.some(g => g.name === permission || g.name === permission.replace(/ Write$/, ' Edit')))) throw new Error(`${secret}: add ${permission} for the configured account`);
  }
  await check(deployToken,'CLOUDFLARE_API_TOKEN',['Workers Scripts Write','Workers R2 Storage Write']);
  await check(d1Token,'CLOUDFLARE_D1_API_TOKEN',['D1 Write']);
  let database: string | undefined;
  for (let page=1; ; page++) {
    const list=await api(d1Token,'CLOUDFLARE_D1_API_TOKEN',`/accounts/${account}/d1/database?per_page=100&page=${page}`,'D1 Write');
    for (const row of list.result as {name:string;uuid:string}[]) if (row.name==='run-data-staging') database=row.uuid;
    if (page >= (list.result_info?.total_pages ?? 1)) break;
  }
  let bucket=false; let cursor='';
  do {
    const list=await api(deployToken,'CLOUDFLARE_API_TOKEN',`/accounts/${account}/r2/buckets?per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,'Workers R2 Storage Write');
    bucket ||= (list.result as {buckets:{name:string}[]}).buckets.some(b=>b.name==='run-files-staging');
    cursor=list.result_info?.cursor ?? '';
  } while(cursor);
  // All permissions and read access have been checked before either create.
  if (database === undefined) database=((await api(d1Token,'CLOUDFLARE_D1_API_TOKEN',`/accounts/${account}/d1/database`,'D1 Write','POST',{name:'run-data-staging'})).result as {uuid:string}).uuid;
  if (!bucket) await api(deployToken,'CLOUDFLARE_API_TOKEN',`/accounts/${account}/r2/buckets`,'Workers R2 Storage Write','POST',{name:'run-files-staging'});
  if (!/^[0-9a-f-]{36}$/.test(database)) throw new Error('Cloudflare returned an invalid D1 id');
  return database;
}
