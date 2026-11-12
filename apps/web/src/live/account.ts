/**
 * The page's account state (ROADMAP A1-06, A1-07): who is signed in, whether this host offers sign-in, the sign-in
 * link and sign-out.
 *
 * - Signing in is a plain link to `/auth/login` (run's CSP has `form-action 'none'`), with the current page as the
 *   return path when it is one the Worker accepts.
 * - Signing out is refused while LIVE (T-S58, RUN_PLAN §3.3 "Logout and account switching are refused while LIVE").
 *   It clears only the session cookie, never `device-safety` (T-S46).
 * - None of this is the D1 gate: authGate.ts asks the Worker again at every gated request. A stale state here can only
 *   show the wrong words, never let a request through.
 */
import { signal } from '@preact/signals';
import { fetchAccount, postSignOut, type AccountRead } from '../cloud/account.ts';

export interface AccountState {
  readonly status: 'checking' | 'signed-in' | 'signed-out' | 'unavailable';
  /** "@login" when signed in. Display only. */
  readonly display: string | null;
  /** This host offers sign-in. */
  readonly signIn: boolean;
  /** The last sign-out refusal or failure, in plain words. */
  readonly message: string | null;
}

export const CHECKING: AccountState = Object.freeze({ status: 'checking', display: null, signIn: false, message: null });

export const accountIdentity = signal<AccountRead['signedIn']>(null);

export const accountState = signal<AccountState>(CHECKING);

export function stateFrom(read: AccountRead): AccountState {
  if (read.signedIn !== null) return { status: 'signed-in', display: read.signedIn.display, signIn: read.signIn, message: null };
  return { status: read.failed ? 'unavailable' : 'signed-out', display: null, signIn: read.signIn, message: null };
}

export async function refreshAccount(read: () => Promise<AccountRead> = () => fetchAccount()): Promise<AccountState> {
  const result = await read();
  accountIdentity.value = result.signedIn;
  const next = stateFrom(result);
  accountState.value = next;
  return next;
}

/** The Worker's return-path rule (workers/run/src/authLogin.ts `safeReturnPath`). */
const RETURN_PATH = /^\/(?![/\\])[a-z0-9/_-]*$/;

/** The sign-in link, coming back to `path` when the Worker would accept it (else to `/`). */
export function signInHref(path: string): string {
  return RETURN_PATH.test(path) && path !== '/' ? `/auth/login?return_to=${encodeURIComponent(path)}` : '/auth/login';
}

export const SIGN_OUT_WHILE_LIVE = 'Disconnect the machine first. Signing out is refused while connected.';
export const SIGN_OUT_FAILED = 'Signing out did not complete. Check the connection and try again.';

/** Signs out, unless a machine is connected. */
export async function signOut(isLive: () => boolean, post: () => Promise<boolean> = () => postSignOut()): Promise<boolean> {
  if (isLive()) {
    accountState.value = { ...accountState.value, message: SIGN_OUT_WHILE_LIVE };
    return false;
  }
  const ok = await post();
  if (ok) accountIdentity.value = null;
  accountState.value = ok ? { status: 'signed-out', display: null, signIn: accountState.value.signIn, message: null } : { ...accountState.value, message: SIGN_OUT_FAILED };
  return ok;
}
