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
 * A failure after the exchange revokes the new session (the RP contract's device-bind rule). Only after all six does
 * the response set `__Host-run_sid`: cookie creation is the last step, never the default.
 *
 * An `error` from accounts (cancelled, nothing to sign in to) consumes the sign-in and shows a plain sentence. The page
 * never echoes the code, the state or any upstream text. Logs: this Worker writes none.
 */
import type { AccountsBinding, AuthConfig, ExchangeResult } from './authConfig.ts';
import { clearPreauthCookie, PREAUTH_COOKIE, readCookie, sessionCookie } from './authCookies.ts';
import { fromBase64url, randomToken, sha256Hex, unseal } from './authCrypto.ts';
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

/** The `nonce` claim of an ID token's payload (the token came straight from accounts over the binding). */
export function idTokenNonce(idToken: string): string | null {
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
export function acceptable(result: ExchangeResult, deviceId: string, nonce: string): boolean {
  const s = result.session;
  return (
    typeof result.sessionToken === 'string' &&
    s.client === 'run' &&
    typeof s.sub === 'string' &&
    /^usr_[0-9A-Za-z]{1,60}$/.test(s.sub) &&
    s.deviceRecordId === deviceId &&
    Number.isFinite(s.absoluteExpiresAt) &&
    idTokenNonce(result.idToken) === nonce
  );
}

async function revokeQuietly(accounts: AccountsBinding, token: string): Promise<void> {
  try {
    await accounts.revokeSession(token);
  } catch {
    // The session may already be gone; nothing more can be done here, and the cookie is never set.
  }
}

function refused(status = 400): Response {
  const response = authProblem(status, FAILED);
  response.headers.append('set-cookie', clearPreauthCookie());
  return response;
}

export async function callback(request: Request, config: AuthConfig, now: number): Promise<Response> {
  const url = new URL(request.url);
  const state = single(url, 'state');
  const browserNonce = readCookie(request, PREAUTH_COOKIE);
  if (state === null || browserNonce === null) return refused();
  const store = new AuthStore(config.db);
  const stateHash = await sha256Hex(state);
  const pending = await store.consumeSignIn(stateHash, await sha256Hex(browserNonce), now);
  if (pending === null) return refused();
  if (url.searchParams.has('error')) return refused();
  const code = single(url, 'code');
  const verifier = await unseal(config.stateKey, pending.verifierSealed, stateHash);
  if (code === null || verifier === null) return refused();

  const deviceId = `dev_${randomToken()}`;
  await store.createDevice(deviceId, deviceLabel(request.headers.get('user-agent')), now);
  let result: ExchangeResult;
  try {
    result = await config.accounts.exchangeCode(code, verifier, { redirectUri: config.redirectUri, deviceRecordId: deviceId, sharedComputer: pending.sharedComputer });
  } catch {
    await store.dropDevice(deviceId);
    return refused();
  }
  if (!acceptable(result, deviceId, pending.nonce) || !(await store.bindDevice(deviceId, result.session.sub, now))) {
    await revokeQuietly(config.accounts, result.sessionToken);
    await store.dropDevice(deviceId);
    return refused();
  }
  // Last step: the cookie, then the stored return path (checked when the sign-in started).
  const headers = new Headers({ location: pending.returnTo, 'cache-control': 'no-store' });
  headers.append('set-cookie', sessionCookie(result.sessionToken, result.session.absoluteExpiresAt, now, pending.sharedComputer));
  headers.append('set-cookie', clearPreauthCookie());
  return new Response(null, { status: 303, headers });
}
