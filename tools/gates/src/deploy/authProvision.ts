// CI-only D1 provisioning. Never migrates or deploys; only the public database id is printed.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function provisionDatabase(account: string, token: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!/^[0-9a-f]{32}$/.test(account)) throw new Error('CLOUDFLARE_ACCOUNT_ID is invalid');
  if (!token) throw new Error('CLOUDFLARE_D1_API_TOKEN needs D1: Edit');
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database`;
  async function api(suffix: string, method = 'GET', body?: unknown) {
    const response = await fetcher(base + suffix, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status === 401 || response.status === 403) throw new Error('CLOUDFLARE_D1_API_TOKEN needs D1: Edit');
    if (!response.ok) throw new Error(`D1 provisioning failed (${response.status})`);
    const answer = await response.json() as { success?: boolean; result?: { name?: string; uuid?: string }[] | { uuid?: string }; result_info?: { total_pages?: number } };
    if (answer?.success !== true) throw new Error('D1 provisioning refused');
    return answer;
  }
  let id;
  for (let page = 1; ; page++) {
    const answer = await api(`?per_page=100&page=${page}`);
    if (!Array.isArray(answer.result)) throw new Error('Invalid D1 list');
    const matches = answer.result.filter(row => row.name === 'run-auth');
    if (matches.length > 1 || (matches.length > 0 && id !== undefined)) throw new Error('Ambiguous D1 database name');
    if (matches.length === 1) {
      const found = matches[0]?.uuid;
      if (typeof found !== 'string' || !UUID.test(found)) throw new Error('Invalid D1 database id');
      id = found;
    }
    const pages = answer.result_info?.total_pages ?? 1;
    if (!Number.isInteger(pages) || pages < 1 || pages > 10000) throw new Error('Invalid D1 pagination');
    if (page >= pages) break;
  }
  if (id === undefined) id = ((await api('', 'POST', { name: 'run-auth' })).result as { uuid?: string } | undefined)?.uuid;
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error('Invalid D1 database id');
  return id;
}
