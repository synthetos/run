/**
 * `POST /auth/logout` (ROADMAP A1-06; RUN_PLAN §3.3 "Logout (run)").
 *
 * A script-driven same-origin POST, refused unless every CSRF layer holds (RUN_PLAN §3.3, run API, T-S45):
 * the exact run Origin, `Sec-Fetch-Site: same-origin` when the browser sends it, the header
 * `X-Synthetos-Request: 1`, and no body other than empty or JSON. No CORS headers, ever.
 *
 * It revokes this browser's run session at accounts (only this one; "sign out everywhere" belongs to accounts) and
 * expires only `__Host-run_sid`. It never sends `Clear-Site-Data`: that would sign the user out of accounts and the
 * forum, and "storage" would wipe `device-safety` (pending restores and facts, SAFETY §4.10 rule 7). The page refuses
 * logout while LIVE (T-S58); a session in progress is never affected by this route either way (D1).
 */
import type { AuthConfig } from './authConfig.ts';
import { clearSessionCookie, readCookie, SESSION_COOKIE } from './authCookies.ts';
import { isToken } from './authCrypto.ts';

/** True when the request passes run's API CSRF layers for `origin`. */
export function sameOriginMutation(request: Request, origin: string): boolean {
  if (request.headers.get('origin') !== origin) return false;
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return false;
  if (request.headers.get('x-synthetos-request') !== '1') return false;
  const type = request.headers.get('content-type');
  return type === null || type.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

export async function logout(request: Request, config: AuthConfig): Promise<Response> {
  if (!sameOriginMutation(request, config.runOrigin)) {
    return new Response(`${JSON.stringify({ error: 'forbidden' })}\n`, { status: 403, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  const token = readCookie(request, SESSION_COOKIE);
  if (token !== null && isToken(token)) {
    try {
      await config.accounts.revokeSession(token);
    } catch {
      // Already revoked or expired at accounts: the cookie is cleared all the same.
    }
  }
  return new Response(null, { status: 204, headers: { 'set-cookie': clearSessionCookie(), 'cache-control': 'no-store' } });
}
