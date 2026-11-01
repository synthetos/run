/**
 * Routing for the run Worker (ROADMAP P0-04). Kept apart from index.ts
 * because the Workers runtime treats every named export of the main module
 * as an entrypoint.
 *
 * In Phase 0 the API is a single route, `GET /api/health`. Every other
 * `/api/*` and `/auth/*` path is a 404 until A1 adds sign-in.
 */
import { API_CACHE_CONTROL } from './headers.ts';

export const VERSION = '0.0.0';

/** The deployment environments. Set by `vars.RUN_ENV` in wrangler.jsonc. */
export type RunEnvironment = 'production' | 'staging' | 'development';

const ENVIRONMENTS: readonly RunEnvironment[] = ['production', 'staging', 'development'];

/** The static-assets binding (the subset of Cloudflare's `Fetcher` this Worker uses). */
export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  readonly ASSETS: AssetsBinding;
  readonly RUN_ENV?: string;
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

function notFound(): Response {
  return json(404, { error: 'not_found' });
}

/** True for `/api`, `/api/...` (and likewise `/auth`), never for `/apis` or `/api-docs`. */
function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Routes one request. Exported for the tests; production goes through `fetch` below. */
export async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (under(pathname, '/api')) {
    if (pathname !== '/api/health') return notFound();
    if (request.method === 'GET') return health(env);
    if (request.method === 'HEAD') return withoutBody(health(env));
    return json(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' });
  }
  if (under(pathname, '/auth')) {
    // Sign-in arrives with A1 (accounts.synthetos.com). Until then there is
    // no auth route at all.
    return notFound();
  }
  // Not normally reached (only /api/* and /auth/* run the Worker first), but
  // if it is, the asset layer answers and the headers are still applied.
  return env.ASSETS.fetch(request);
}
