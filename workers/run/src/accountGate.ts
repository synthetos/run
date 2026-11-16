/**
 * The checks every account data request passes, in order: a validated run session (401), an allowed method (405),
 * the same origin and, on a mutation, the custom header (403). A missing data binding answers 503 before
 * session checks (production stays off until reviewed resources are deployed). The actor comes from the session alone, never from the body or the URL.
 */
import type { RecordActor, RunDataBinding, RunFilesBinding } from '@synthetos/contracts';
import { authConfig } from './authConfig.ts';
import { runSessionIdentity } from './authSession.ts';
import { json, type Env } from './routes.ts';

/** What a mutation may carry: JSON (or nothing) for record routes; any bytes for the files route. */
export type BodyPolicy = 'json' | 'bytes';

const isJsonType = (type: string | null): boolean => type === null || type.split(';')[0]?.trim().toLowerCase() === 'application/json';

/**
 * The CSRF layers of a mutation (authLogout.ts `sameOriginMutation`, with the body policy as a parameter): the
 * origin and fetch site must be this host, the custom header must be present (a cross-origin page cannot set it
 * without a preflight the Worker never answers), and a record body must be JSON.
 */
function allowedMutation(request: Request, origin: string, body: BodyPolicy): boolean {
  if (request.headers.get('origin') !== origin || request.headers.get('x-synthetos-request') !== '1') return false;
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return false;
  return body === 'bytes' || isJsonType(request.headers.get('content-type'));
}

export type AccountData = RunDataBinding & RunFilesBinding;

/** The signed-in account and the data Worker that holds its records and files. */
export interface Account { readonly actor: RecordActor; readonly data: AccountData }

export type AccountRequest = (Account & { readonly ok: true }) | { readonly ok: false; readonly response: Response };

const refuse = (response: Response): AccountRequest => ({ ok: false, response });

export interface GateRules {
  /** The methods this path answers. */
  readonly allow: readonly string[];
  /** The error name when this host has no data binding. */
  readonly unavailable: string;
  readonly body?: BodyPolicy;
}

export async function accountRequest(request: Request, env: Env, rules: GateRules): Promise<AccountRequest> {
  const { allow, unavailable, body = 'json' } = rules;
  if (env.RUN_DATA === undefined) return refuse(json(503, { error: unavailable }));
  const config = authConfig(env, new URL(request.url));
  const identity = config === null ? null : await runSessionIdentity(request, config);
  if (identity === null || config === null) return refuse(json(401, { error: 'not_signed_in' }));
  if (!allow.includes(request.method)) return refuse(json(405, { error: 'method_not_allowed' }, { allow: allow.join(', ') }));
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  const crossOrigin = (origin !== null && origin !== config.runOrigin) || (site !== null && site !== 'same-origin');
  if (crossOrigin || (request.method !== 'GET' && !allowedMutation(request, config.runOrigin, body))) return refuse(json(403, { error: 'cross_origin' }));
  return { ok: true, actor: { userId: identity.subject, label: identity.display }, data: env.RUN_DATA };
}
