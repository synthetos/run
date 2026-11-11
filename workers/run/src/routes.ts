/**
 * Routing for the run Worker (ROADMAP P0-04). Kept apart from index.ts
 * because the Workers runtime treats every named export of the main module
 * as an entrypoint.
 *
 * The API is `GET /api/health` and, from P1-05, `GET /api/identity` (the
 * D1 sign-in gate's identity: the run session where sign-in is on, A1-06,
 * then the verified Cloudflare Access identity on staging), and `GET
 * /api/session` (the account panel's read, always 200). `/auth/*` is the
 * sign-in handoff with accounts (authRoutes.ts), a 404 where sign-in is off.
 * Every other `/api/*` path is a 404.
 *
 * `GET /firmware/<owner>/<name>/<tag>/<asset>` (OD-10) serves a listed
 * GitHub release asset through the firmware proxy (firmwareProxy.ts). The
 * Worker runs first for every path (OD-29); production lists no firmware
 * (only `env: 'production'` entries count there), so it answers 404, and
 * its flasher is off.
 */
import type { IdentityBody, SessionBody } from '@synthetos/contracts';
import { accessConfig, type CertsFetcher, fetchAccessCerts, verifyAccessJwt } from './accessIdentity.ts';
import { firmwareAssetPath, firmwareHeaders, NO_CACHE, proxyFirmwareAsset, type FirmwareCache, type FirmwareProxyDeps } from './firmwareProxy.ts';
import { authConfig, type AuthEnv } from './authConfig.ts';
import { authRoute } from './authRoutes.ts';
import { serialSession } from './serialSession.ts';
import { runSessionIdentity } from './authSession.ts';
import { API_CACHE_CONTROL, grantsSerial, HASHED_ASSET_CACHE_CONTROL } from './headers.ts';

export const VERSION = '0.0.0';

/** The deployment environments. Set by `vars.RUN_ENV` in wrangler.jsonc. */
export type RunEnvironment = 'production' | 'staging' | 'development';

const ENVIRONMENTS: readonly RunEnvironment[] = ['production', 'staging', 'development'];

/** The static-assets binding (the subset of Cloudflare's `Fetcher` this Worker uses). */
export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env extends AuthEnv {
  readonly ASSETS: AssetsBinding;
  readonly RUN_ENV?: string;
  /** Staging only: the Access team domain (`<team>.cloudflareaccess.com`). */
  readonly ACCESS_TEAM_DOMAIN?: string;
  /** Staging only: the Access application's AUD tag. */
  readonly ACCESS_AUD?: string;
}

/** Body of `GET /api/health`. The post-deploy smoke test checks `service` and `env`. */
export interface HealthBody {
  readonly status: 'ok' | 'misconfigured';
  readonly service: 'run';
  readonly env: RunEnvironment | null;
  readonly version: string;
}

function isEnvironment(value: unknown): value is RunEnvironment {
  return typeof value === 'string' && (ENVIRONMENTS as readonly string[]).includes(value);
}

/** A JSON API response: never cached, never sniffed (RUN_PLAN §6.4). */
export function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': API_CACHE_CONTROL,
      ...extra,
    },
  });
}

function withoutBody(response: Response): Response {
  return new Response(null, response);
}

/**
 * `GET /api/health`. An unknown or missing `RUN_ENV` is reported as
 * `misconfigured` with status 500, so a deploy with the wrong configuration
 * fails the smoke test instead of passing it.
 */
function health(env: Env): Response {
  const runEnv = isEnvironment(env.RUN_ENV) ? env.RUN_ENV : null;
  const body: HealthBody = {
    status: runEnv === null ? 'misconfigured' : 'ok',
    service: 'run',
    env: runEnv,
    version: VERSION,
  };
  return json(runEnv === null ? 500 : 200, body);
}

/**
 * `GET /api/identity`. First the run session, where sign-in is on (authConfig.ts: production and staging with the
 * accounts binding, database and secrets). Then, on the staging Worker on the staging host only, the verified
 * Access identity. Otherwise no identity, so Connect stays refused. `signIn` says whether this host offers
 * sign-in; accounts decides who is admitted (D37).
 */
async function identity(request: Request, env: Env, fetchCerts: CertsFetcher): Promise<Response> {
  const auth = authConfig(env, new URL(request.url));
  const signIn = auth !== null;
  const none = (reason: NonNullable<IdentityBody['reason']>): Response => json(401, { identity: null, reason, signIn } satisfies IdentityBody);
  if (auth !== null) {
    const session = await runSessionIdentity(request, auth);
    if (session !== null) return json(200, { identity: session, signIn } satisfies IdentityBody);
  }
  // The Access identity counts on the staging Worker on the staging host only (production grants serial too since
  // OD-29, but its only identity is the run session).
  if (env.RUN_ENV !== 'staging' || !grantsSerial(env.RUN_ENV, new URL(request.url))) return none(signIn ? 'not-signed-in' : 'not-available-here');
  const config = accessConfig(env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
  if (config === null) return none(signIn ? 'not-signed-in' : 'not-configured');
  const verified = await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), config, Date.now(), fetchCerts);
  if (verified === null) return none('not-signed-in');
  return json(200, { identity: { provider: 'access', subject: verified.subject }, signIn } satisfies IdentityBody);
}

/** `GET /api/session`: the account panel's read. Always 200; never the D1 gate (that is `/api/identity`). */
async function session(request: Request, env: Env): Promise<Response> {
  const auth = authConfig(env, new URL(request.url));
  const found = auth === null ? null : await runSessionIdentity(request, auth);
  const body: SessionBody = { account: found === null ? null : { subject: found.subject, display: found.display }, signIn: auth !== null };
  return json(200, body);
}

function notFound(): Response {
  return json(404, { error: 'not_found' });
}

/** True for `/api`, `/api/...` (and likewise `/auth`), never for `/apis` or `/api-docs`. */
function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The Cache API as the firmware proxy's store, keyed by hash under this
 * request's origin. Absent or failing, nothing is cached (the proxy still
 * verifies every body it serves).
 */
function workerFirmwareCache(origin: string): FirmwareCache {
  const store = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (store === undefined) return NO_CACHE;
  const key = (sha256: string): string => `${origin}/firmware/.sha256/${sha256}`;
  return {
    async get(sha256) {
      const hit = await store.match(key(sha256));
      return hit === undefined ? undefined : new Uint8Array(await hit.arrayBuffer());
    },
    async put(sha256, bytes) {
      await store.put(key(sha256), new Response(bytes.slice(), { headers: { 'cache-control': 'public, max-age=31536000, immutable' } }));
    },
  };
}

function liveFirmwareDeps(origin: string): FirmwareProxyDeps {
  return { fetch: (url, init) => fetch(url, init), cache: workerFirmwareCache(origin) };
}

/** `GET`/`HEAD /firmware/<owner>/<name>/<tag>/<asset>`: a listed asset, verified, or a 404 (a 502 when GitHub fails). */
async function firmware(request: Request, env: Env, pathname: string, deps: FirmwareProxyDeps): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' });
  const result = await proxyFirmwareAsset(pathname, env.RUN_ENV, deps);
  if (!result.ok) return result.reason === 'upstream' ? json(502, { error: 'upstream_unavailable' }) : notFound();
  return new Response(request.method === 'HEAD' ? null : result.bytes, { status: 200, headers: firmwareHeaders(result.bytes) });
}

/** Routes one request. Exported for the tests; production goes through `fetch` below. */
export async function route(
  request: Request,
  env: Env,
  fetchCerts: CertsFetcher = fetchAccessCerts,
  firmwareDeps?: FirmwareProxyDeps,
  now: () => number = () => Math.floor(Date.now() / 1000),
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (under(pathname, '/api')) {
    if (pathname === '/api/identity') {
      if (request.method === 'GET') return identity(request, env, fetchCerts);
      return json(405, { error: 'method_not_allowed' }, { allow: 'GET' });
    }
    if (pathname === '/api/session') {
      if (request.method === 'GET') return session(request, env);
      return json(405, { error: 'method_not_allowed' }, { allow: 'GET' });
    }
    if (pathname !== '/api/health') return notFound();
    if (request.method === 'GET') return health(env);
    if (request.method === 'HEAD') return withoutBody(health(env));
    return json(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' });
  }
  if (under(pathname, '/auth')) return authRoute(request, env, now());
  if (firmwareAssetPath(pathname) !== null) return firmware(request, env, pathname, firmwareDeps ?? liveFirmwareDeps(url.origin));
  // Every other request (the Worker runs first for all of them: P1-00 on
  // staging, OD-29 in production). The asset layer answers; the caller
  // applies the headers.
  // `_headers` does not apply to responses the Worker returns, so the
  // immutable cache policy of hashed assets is set here.
  // Hash asset names need no encoding. Refuse encoded aliases rather than let the asset service normalize
  // a spelling around the protected serial directory.
  if (pathname.includes('%') && decodeURIComponent(pathname).startsWith('/assets/')) return notFound();
  if (under(pathname, '/assets/serial')) {
    const allowed = (env.RUN_ENV === 'staging' && grantsSerial(env.RUN_ENV, url)) || await serialSession(request, env);
    const res = allowed ? await env.ASSETS.fetch(request) : json(403, { error: 'sign_in_required' });
    const privateAsset = new Response(res.body, res);
    privateAsset.headers.set('cache-control', 'private, no-store');
    privateAsset.headers.append('vary', 'Cookie');
    return privateAsset;
  }
  const asset = await env.ASSETS.fetch(request);
  if (!under(pathname, '/assets') || asset.status !== 200) return asset;
  const cached = new Response(asset.body, asset);
  cached.headers.set('cache-control', HASHED_ASSET_CACHE_CONTROL);
  return cached;
}
