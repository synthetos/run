/**
 * The checks every account data request passes, in order: a validated run session (401), an allowed method (405),
 * the same origin and, on a mutation, the custom header (403), and a data binding on this host (503: staging
 * only until go-live). The actor comes from the session alone, never from the body or the URL.
 */
import type { RecordActor, RunDataBinding, RunFilesBinding } from '@synthetos/contracts';
import { authConfig } from './authConfig.ts';
import { sameOriginMutation } from './authLogout.ts';
import { runSessionIdentity } from './authSession.ts';
import { json, type Env } from './routes.ts';

export type AccountData = RunDataBinding & RunFilesBinding;

/** The signed-in account and the data Worker that holds its records and files. */
export interface Account { readonly actor: RecordActor; readonly data: AccountData }

export type AccountRequest = (Account & { readonly ok: true }) | { readonly ok: false; readonly response: Response };

const refuse = (response: Response): AccountRequest => ({ ok: false, response });

export async function accountRequest(request: Request, env: Env, allow: readonly string[], unavailable: string): Promise<AccountRequest> {
  const config = authConfig(env, new URL(request.url));
  const identity = config === null ? null : await runSessionIdentity(request, config);
  if (identity === null || config === null) return refuse(json(401, { error: 'not_signed_in' }));
  if (!allow.includes(request.method)) return refuse(json(405, { error: 'method_not_allowed' }, { allow: allow.join(', ') }));
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  const crossOrigin = (origin !== null && origin !== config.runOrigin) || (site !== null && site !== 'same-origin');
  if (crossOrigin || (request.method !== 'GET' && !sameOriginMutation(request, config.runOrigin))) return refuse(json(403, { error: 'cross_origin' }));
  if (env.RUN_DATA === undefined || env.RUN_ENV !== 'staging') return refuse(json(503, { error: unavailable }));
  return { ok: true, actor: { userId: identity.subject, label: identity.display }, data: env.RUN_DATA };
}
