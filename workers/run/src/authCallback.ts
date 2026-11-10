/**
 * `GET /auth/callback` (ROADMAP A1-06; RUN_PLAN §3.3 "Login from run", step 3; accounts docs/RP_CONTRACT.md).
 *
 * In this order, and refusing at the first failure:
 * 1. `state` and the `__Host-run_oauth` cookie are present and well formed (T-S79: no cookie, no sign-in);
 * 2. the pending sign-in is consumed once, only for this browser's nonce, only before it expires (authStore.ts);
 *    this happens BEFORE any code is exchanged;
 * 3. the PKCE verifier is decrypted (bound to the state hash);
 * 4. a device row is created, then the code is exchanged over the `ACCOUNTS` binding with the exact redirect URI,
 *    the device id and the shared-computer choice;
 * 5. the result must be a `run` session for that device, and the ID token's nonce must be this sign-in's;
 * 6. the device row is bound to the session's `sub`.
 * A failure after the exchange, checked or thrown, revokes the new session (the RP contract's device-bind rule). Only
 * after all six does the response set `__Host-run_sid`: cookie creation is the last step, never the default. A new
 * sign-in revokes the browser's previous run session.
 *
 * An `error` from accounts (cancelled, nothing to sign in to) consumes the sign-in and shows a plain sentence. The page
 * never echoes the code, the state or any upstream text. Logs: this Worker writes none.
 */
import type { AccountsBinding, AuthConfig, ExchangeResult } from './authConfig.ts';
import { clearPreauthCookie, PREAUTH_COOKIE, readCookie, SESSION_COOKIE, sessionCookie } from './authCookies.ts';
import { fromBase64url, isToken, randomToken, sha256Hex, unseal } from './authCrypto.ts';
import { authProblem } from './authPages.ts';
import { AuthStore } from './authStore.ts';

const FAILED = 'Sign-in did not complete. Go back to Run and try again.';

/** A single query value: present once, at most 2048 characters, no spaces or control characters. */
function single(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  if (values.length !== 1) return null;
  const value = values[0] as string;
  return value.length > 0 && value.length <= 2048 && !/[\x00-\x20\x7f]/.test(value) ? value : null;
}

/** A coarse browser and system label for the device row ("Chrome on macOS"); never the full user agent. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  const system = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'another system';
  return `${browser} on ${system}`;
}

/**
 * The `nonce` claim of an ID token's payload. Read without checking the signature on purpose: the token arrives in
 * the return value of `exchangeCode` over the `ACCOUNTS` service binding (an in-account RPC to accounts' named
 * `RunEntrypoint`), never from the browser or the network, so there is nothing to forge on that path. The nonce
 * check only confirms that the code accounts redeemed is this sign-in's. PKCE and the browser-bound state are the
 * main bindings; this is a cross-check.
 */
export function idTokenNonce(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const payload = fromBase64url(parts[1] as string);
  if (payload === null) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(payload)) as { nonce?: unknown };
    return typeof claims.nonce === 'string' ? claims.nonce : null;
  } catch {
    return null;
  }
}

/** True when the exchange produced the run session this sign-in asked for. */
export function acceptable(result: ExchangeResult, deviceId: string, nonce: string, now: number, sharedComputer: boolean): boolean {
  const s = result.session as Partial<ExchangeResult['session']> | null | undefined;
  if (s === null || typeof s !== 'object') return false;
  return (
    isToken(result.sessionToken) &&
    s.client === 'run' &&
    typeof s.sub === 'string' &&
    /^usr_[0-9A-Za-z]{1,60}$/.test(s.sub) &&
    s.deviceRecordId === deviceId &&
    typeof s.absoluteExpiresAt === 'number' &&
    Number.isSafeInteger(s.absoluteExpiresAt) &&
    s.absoluteExpiresAt > now &&
    s.absoluteExpiresAt <= now + 7 * 86400 &&
    s.sharedComputer === sharedComputer &&
    idTokenNonce(result.idToken) === nonce
  );
}

async function revokeQuietly(accounts: AccountsBinding, token: unknown): Promise<void> {
  if (typeof token !== 'string') return;
  try {
    await accounts.revokeSession(token);
  } catch {
    // The session may already be gone; nothing more can be done here, and the cookie is never set.
  }
}

async function dropQuietly(store: AuthStore, deviceId: string): Promise<void> {
  try {
    await store.dropDevice(deviceId);
  } catch {
    // An unbound row is pruned later (authStore.ts prune).
  }
}

/** The refusal page. It clears the pre-auth cookie only when it matched a pending sign-in (that sign-in is spent). */
function refused(clearPreauth: boolean): Response {
  const response = authProblem(400, FAILED);
  if (clearPreauth) response.headers.append('set-cookie', clearPreauthCookie());
  return response;
}

export async function callback(request: Request, config: AuthConfig, now: number): Promise<Response> {
  const url = new URL(request.url);
  const state = single(url, 'state');
  const browserNonce = readCookie(request, PREAUTH_COOKIE);
  if (state === null || browserNonce === null) return refused(false);
  const store = new AuthStore(config.db);
  const stateHash = await sha256Hex(state);
  const pending = await store.consumeSignIn(stateHash, await sha256Hex(browserNonce), now);
  // Another flow's cookie, a replay or an expired state: this browser's own pending sign-in (if any) stays usable.
  if (pending === null) return refused(false);
  if (url.searchParams.has('error')) return refused(true);
  const code = single(url, 'code');
  const verifier = await unseal(config.stateKey, pending.verifierSealed, stateHash);
  if (code === null || verifier === null) return refused(true);

  const deviceId = `dev_${randomToken()}`;
  await store.createDevice(deviceId, deviceLabel(request.headers.get('user-agent')), now);
  let result: ExchangeResult;
  try {
    result = await config.accounts.exchangeCode(code, verifier, { redirectUri: config.redirectUri, deviceRecordId: deviceId, sharedComputer: pending.sharedComputer });
  } catch {
    await dropQuietly(store, deviceId);
    return refused(true);
  }
  // Every step after exchange, including response construction, shares the revoke-on-failure path.
  try {
    if (!acceptable(result, deviceId, pending.nonce, now, pending.sharedComputer) || !(await store.bindDevice(deviceId, result.session.sub, now))) {
      throw new Error('sign_in_refused');
    }
    // Build the complete response before replacing the previous browser session.
    const headers = new Headers({ location: pending.returnTo, 'cache-control': 'no-store' });
    headers.append('set-cookie', sessionCookie(result.sessionToken, result.session.absoluteExpiresAt, now, pending.sharedComputer));
    headers.append('set-cookie', clearPreauthCookie());
    const response = new Response(null, { status: 303, headers });
    const previous = readCookie(request, SESSION_COOKIE);
    if (previous !== null && previous !== result.sessionToken) await revokeQuietly(config.accounts, previous);
    return response;
  } catch {
    await revokeQuietly(config.accounts, (result as Partial<ExchangeResult> | null)?.sessionToken);
    await dropQuietly(store, deviceId);
    return refused(true);
  }
}
