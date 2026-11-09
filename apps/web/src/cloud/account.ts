/**
 * The account reads and the sign-out request (ROADMAP A1-06, A1-07; RUN_PLAN §3.3).
 *
 * - `fetchAccount()`: `GET /api/session` (always 200), for "Signed in as @login" and for whether this host offers
 *   sign-in.
 * - `postSignOut()`: `POST /auth/logout`, a same-origin fetch with the custom header (RUN_PLAN §3.3: never a form;
 *   run's CSP has `form-action 'none'`).
 *
 * This module fetches and returns data; it decides nothing. The D1 gate (live/authGate.ts) and the account panel
 * decide what to show and allow. Neither request is ever on the machine path: a failure here can refuse a new
 * Connect or Start, never touch a running session (SAFETY §4.10).
 */
import type { SessionBody } from '@synthetos/contracts';
import type { FetchLike } from './live.ts';

export interface AccountRead {
  /** The run session's account, or null (signed out, or the read failed). */
  readonly signedIn: { readonly subject: string; readonly display: string } | null;
  /** This host offers sign-in (`/auth/login`). Who is admitted is accounts' decision (D37). */
  readonly signIn: boolean;
  /** The read itself failed (offline, an error): not the same as "signed out". */
  readonly failed: boolean;
}

const READ: RequestInit = Object.freeze({ cache: 'no-store', credentials: 'same-origin', redirect: 'error' });

export async function fetchAccount(fetchFn: FetchLike = (i, o) => fetch(i, o)): Promise<AccountRead> {
  try {
    const response = await fetchFn('/api/session', READ);
    if (response.status !== 200) return { signedIn: null, signIn: false, failed: true };
    const body = (await response.json()) as Partial<SessionBody> | null;
    const signIn = body?.signIn === true;
    const account = body?.account;
    if (account !== null && typeof account === 'object' && typeof account.subject === 'string' && account.subject.length > 0) {
      return { signedIn: { subject: account.subject, display: typeof account.display === 'string' ? account.display.slice(0, 64) : 'your Synthetos account' }, signIn, failed: false };
    }
    return { signedIn: null, signIn, failed: false };
  } catch {
    return { signedIn: null, signIn: false, failed: true };
  }
}

/** Signs this browser out of run. True when the server answered (the cookie is then gone). */
export async function postSignOut(fetchFn: FetchLike = (i, o) => fetch(i, o)): Promise<boolean> {
  try {
    const response = await fetchFn('/auth/logout', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      headers: { 'x-synthetos-request': '1' },
    });
    return response.status === 204;
  } catch {
    return false;
  }
}
