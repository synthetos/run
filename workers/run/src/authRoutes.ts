/**
 * The `/auth/*` routes (ROADMAP A1-06): `GET /auth/login`, `GET /auth/callback` and `POST /auth/logout`.
 *
 * With sign-in off on this host (authConfig.ts: a missing binding, database or secret, a development Worker, another
 * host), every `/auth/*` path stays the JSON 404 it was before A1. Any other `/auth/*` path, or another method, is a
 * 404 or 405. Kept apart from routes.ts so each module stays small.
 */
import { authConfig, type AuthEnv } from './authConfig.ts';
import { callback } from './authCallback.ts';
import { login } from './authLogin.ts';
import { logout } from './authLogout.ts';

function jsonError(status: number, error: string, extra: Record<string, string> = {}): Response {
  return new Response(`${JSON.stringify({ error })}\n`, { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
}

const ROUTES: Readonly<Record<string, { readonly method: 'GET' | 'POST'; readonly handle: typeof login }>> = {
  '/auth/login': { method: 'GET', handle: login },
  '/auth/callback': { method: 'GET', handle: callback },
  '/auth/logout': { method: 'POST', handle: (request, config) => logout(request, config) },
};

/** Routes one `/auth/*` request; `now` is Unix seconds. */
export async function authRoute(request: Request, env: AuthEnv, now: number): Promise<Response> {
  const url = new URL(request.url);
  const config = authConfig(env, url);
  const entry = ROUTES[url.pathname];
  if (config === null || entry === undefined) return jsonError(404, 'not_found');
  if (request.method !== entry.method) return jsonError(405, 'method_not_allowed', { allow: entry.method });
  return entry.handle(request, config, now);
}
