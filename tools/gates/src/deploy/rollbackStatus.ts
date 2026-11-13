import type { DeployEnvironment } from './wranglerConfig.ts';
export type WorkerPresence = 'present' | 'absent' | 'unknown';
/** Read-only check with the existing Workers Scripts credential; never infer absence from an auth/network error. */
export async function workerPresence(environment: DeployEnvironment, account: string | undefined, token: string | undefined, fetcher: typeof fetch = fetch): Promise<WorkerPresence> {
  if (account === undefined || !/^[a-f0-9]{32}$/.test(account) || !token) return 'unknown';
  const name = environment === 'staging' ? 'run-staging' : 'run';
  try {
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/services/${name}`, { headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (response.status === 404) return 'absent';
    if (!response.ok) return 'unknown';
    const body = await response.json() as { success?: boolean };
    return body.success === true ? 'present' : 'unknown';
  } catch { return 'unknown'; }
}
export function rollbackFailure(environment: DeployEnvironment, presence: WorkerPresence): string {
  if (presence === 'absent') return `${environment} Worker ${environment === 'staging' ? 'deleted' : 'absent'}; cleanup step failed: wrangler returned an error`;
  if (presence === 'present') return `${environment} Worker STILL LIVE; wrangler returned an error; deployed version not verified; act now`;
  return `${environment} Worker state UNKNOWN; wrangler returned an error and existence could not be checked; act now`;
}
