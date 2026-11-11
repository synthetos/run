/**
 * run's two `__Host-` cookies (RUN_PLAN §3.3, accounts docs/RP_CONTRACT.md "Run binding"):
 *
 * - `__Host-run_oauth`: the pre-auth nonce that binds a sign-in to this browser. Lax (it must survive the redirect
 *   back from accounts), ten minutes.
 * - `__Host-run_sid`: the run session. Lax (top-level links must carry it). Its Max-Age never passes the session's absolute expiry; a
 *   shared-computer session has no Max-Age (it ends with the browser).
 *
 * Both are host-only (no Domain), Secure, HttpOnly, Path=/. A request carrying the same cookie twice is read as no
 * cookie (fail closed).
 */
import { isToken } from './authCrypto.ts';

export const PREAUTH_COOKIE = '__Host-run_oauth';
export const SESSION_COOKIE = '__Host-run_sid';
/** Seconds the pre-auth cookie and the stored request live. */
export const PREAUTH_SECONDS = 600;

/** The cookie's canonical token value, or null when absent, repeated or not a token. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (header === null) return null;
  const values = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  if (values.length !== 1) return null;
  const value = values[0] as string;
  return isToken(value) ? value : null;
}

function cookie(name: string, value: string, sameSite: 'Strict' | 'Lax', maxAge: number | null): string {
  const parts = [`${name}=${value}`, 'Path=/', 'Secure', 'HttpOnly', `SameSite=${sameSite}`];
  if (maxAge !== null) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  return parts.join('; ');
}

export function preauthCookie(nonce: string): string {
  return cookie(PREAUTH_COOKIE, nonce, 'Lax', PREAUTH_SECONDS);
}

export function clearPreauthCookie(): string {
  return cookie(PREAUTH_COOKIE, '', 'Lax', 0);
}

/** The session cookie: until `absoluteExpiresAt` (Unix seconds), or a browser-session cookie on a shared computer. */
export function sessionCookie(token: string, absoluteExpiresAt: number, now: number, sharedComputer: boolean): string {
  return cookie(SESSION_COOKIE, token, 'Lax', sharedComputer ? null : absoluteExpiresAt - now);
}

export function clearSessionCookie(): string {
  return cookie(SESSION_COOKIE, '', 'Lax', 0);
}
