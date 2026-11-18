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
import type { AuthConfig, AccountsSession } from './authConfig.ts';
import { readCookie, SESSION_COOKIE } from './authCookies.ts';

export interface RunSessionIdentity {
  readonly provider: 'run-session';
  readonly subject: string;
  readonly display: string;
  readonly canConnect: boolean;
}

/**
 * The validated accounts session behind this request's cookie, or null (no cookie, invalid, revoked, expired, another
 * client, or accounts unreachable). Every check the identity needs happens here, once.
 */
export async function validRunSession(request: Request, config: AuthConfig): Promise<AccountsSession | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token === null) return null;
  try {
    const session = await config.accounts.validateSession(token);
    if (session === null || !Number.isSafeInteger(session.absoluteExpiresAt) || session.absoluteExpiresAt <= Math.floor(Date.now() / 1000) || session.client !== 'run' || typeof session.sub !== 'string' || !session.sub.startsWith('usr_')) return null;
    return session;
  } catch {
    return null;
  }
}

/** The signed-in run session's identity, or null. */
export async function runSessionIdentity(request: Request, config: AuthConfig): Promise<RunSessionIdentity | null> {
  const session = await validRunSession(request, config);
  if (session === null) return null;
  const login = session.identities.find((i) => i.provider === 'github')?.login;
  const display = typeof login === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(login) ? `@${login}` : 'your Synthetos account';
  return { provider: 'run-session', subject: session.sub, display, canConnect: sessionCanConnect(session) };
}

/** The session's GitHub identity id when it is a plain number (the only form avatars.githubusercontent.com takes), else null. */
export function githubIdentityId(session: Pick<AccountsSession, 'identities'>): string | null {
  const id = session.identities.find((i) => i.provider === 'github')?.id;
  return typeof id === 'string' && /^\d{1,20}$/.test(id) ? id : null;
}

/** Accounts owns the role mapping. Missing/malformed capabilities never grant a port, even for an admin role. */
export function sessionCanConnect(session: Pick<AccountsSession, 'capabilities'>): boolean {
  return Array.isArray(session.capabilities) && session.capabilities.every((capability: unknown) => typeof capability === 'string') && session.capabilities.includes('run.connect');
}
