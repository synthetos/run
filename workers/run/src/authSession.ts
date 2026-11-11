/**
 * The run session behind `GET /api/identity` (ROADMAP A1-06; RUN_PLAN §2.2, §3.3; DECISIONS D1).
 *
 * The `__Host-run_sid` cookie is checked with accounts on every request (`validateSession`, one primary D1 read
 * there): never cached here, so a revoked or expired session stops counting on the next request. An outage or an
 * error is "no session": the page's D1 gate then refuses a new Connect or Start, and nothing on the machine path
 * ever asks (SAFETY §4.10).
 *
 * The identity names the account by `sub`; `display` is the GitHub login, for "Signed in as @login" only. It is
 * display-only and never used to decide anything (accounts docs/RP_CONTRACT.md "Identity and signing").
 */
import type { AuthConfig } from './authConfig.ts';
import { readCookie, SESSION_COOKIE } from './authCookies.ts';

export interface RunSessionIdentity {
  readonly provider: 'run-session';
  readonly subject: string;
  readonly display: string;
}

/** The signed-in run session's identity, or null (no cookie, invalid, revoked, expired, or accounts unreachable). */
export async function runSessionIdentity(request: Request, config: AuthConfig): Promise<RunSessionIdentity | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token === null) return null;
  try {
    const session = await config.accounts.validateSession(token);
    if (session === null || !Number.isSafeInteger(session.absoluteExpiresAt) || session.absoluteExpiresAt <= Math.floor(Date.now() / 1000) || session.client !== 'run' || typeof session.sub !== 'string' || !session.sub.startsWith('usr_')) return null;
    const login = session.identities.find((i) => i.provider === 'github')?.login;
    const display = typeof login === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(login) ? `@${login}` : 'your Synthetos account';
    return { provider: 'run-session', subject: session.sub, display };
  } catch {
    return null;
  }
}
