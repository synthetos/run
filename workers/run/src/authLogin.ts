/**
 * `GET /auth/login` (ROADMAP A1-06; RUN_PLAN §3.3 "Login from run", step 1; accounts docs/RP_CONTRACT.md).
 *
 * Starts a sign-in with accounts.synthetos.com (or staging.accounts…): a fresh random state, OIDC nonce, PKCE S256
 * verifier and browser nonce. The pending sign-in is stored server-side (authStore.ts) with the checked return path;
 * the browser gets only the `__Host-run_oauth` nonce cookie. Then a 302 to accounts' `/authorize` with exactly the
 * parameters the RP contract lists.
 *
 * Query: `return_to` (optional, a local path that passes `safeReturnPath`) and `shared=1` (optional, "This is a
 * shared computer": a browser-session cookie with the shorter idle limit). Anything else is refused.
 *
 * Starts are limited per edge IP (keyed hash, never the raw address) and each start prunes a bounded number of
 * expired rows. This route never decides who may sign in: accounts does, before any user or session exists (D37).
 */
import { RUN_CLIENT_ID, type AuthConfig } from './authConfig.ts';
import { preauthCookie, PREAUTH_SECONDS } from './authCookies.ts';
import { keyedHash, pkceChallenge, randomToken, seal, sha256Hex } from './authCrypto.ts';
import { authProblem } from './authPages.ts';
import { AuthStore, LOGIN_LIMIT, LOGIN_WINDOW_SECONDS } from './authStore.ts';

/** RUN_PLAN §3.3: a same-origin local path, lower-case letters, digits, `/`, `_` and `-` only, never `//` or `/\`. */
const RETURN_PATH = /^\/(?![/\\])[a-z0-9/_-]*$/;

/** The return path if it is safe on `origin`, else null (T-S82: `//evil`, `/\evil`, `//2130706433/` are refused). */
export function safeReturnPath(value: string, origin: string): string | null {
  if (value.length > 512 || !RETURN_PATH.test(value)) return null;
  try {
    return new URL(value, origin).origin === origin ? value : null;
  } catch {
    return null;
  }
}

/** The accounts `/authorize` URL for one sign-in (RP contract: these parameters, single-valued, nothing else). */
export function authorizeUrl(config: AuthConfig, state: string, nonce: string, challenge: string): string {
  const url = new URL('/authorize', config.accountsOrigin);
  url.searchParams.set('client_id', RUN_CLIENT_ID);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

function parseQuery(url: URL, origin: string): { returnTo: string; sharedComputer: boolean } | null {
  for (const key of url.searchParams.keys()) if (key !== 'return_to' && key !== 'shared') return null;
  const returns = url.searchParams.getAll('return_to');
  const shared = url.searchParams.getAll('shared');
  if (returns.length > 1 || shared.length > 1) return null;
  if (shared.length === 1 && shared[0] !== '1') return null;
  const returnTo = returns.length === 0 ? '/' : safeReturnPath(returns[0] as string, origin);
  if (returnTo === null) return null;
  return { returnTo, sharedComputer: shared.length === 1 };
}

export async function login(request: Request, config: AuthConfig, now: number): Promise<Response> {
  const query = parseQuery(new URL(request.url), config.runOrigin);
  if (query === null) return authProblem(400, 'This sign-in link is not valid.');
  const store = new AuthStore(config.db);
  // Cloudflare always sets CF-Connecting-IP on a request from the internet. Without it (only a request that did
  // not come through Cloudflare's edge), every such request shares the one 'unknown' bucket: the limit then holds
  // for all of them together, which fails closed (more refusals, never fewer).
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const bucket = `${(await keyedHash(config.rateKey, ip)).slice(0, 32)}:${Math.floor(now / LOGIN_WINDOW_SECONDS)}`;
  if ((await store.countLogin(bucket, now)) > LOGIN_LIMIT) {
    return authProblem(429, 'Too many sign-in attempts from here. Wait a few minutes and try again.', { 'retry-after': String(LOGIN_WINDOW_SECONDS) });
  }
  await store.prune(now);
  const state = randomToken();
  const browserNonce = randomToken();
  const verifier = randomToken();
  const nonce = randomToken();
  const stateHash = await sha256Hex(state);
  await store.createSignIn({
    stateHash,
    browserNonceHash: await sha256Hex(browserNonce),
    verifierSealed: await seal(config.stateKey, verifier, stateHash),
    nonce,
    returnTo: query.returnTo,
    sharedComputer: query.sharedComputer,
    createdAt: now,
    expiresAt: now + PREAUTH_SECONDS,
  });
  return new Response(null, {
    status: 302,
    headers: { location: authorizeUrl(config, state, nonce, await pkceChallenge(verifier)), 'set-cookie': preauthCookie(browserNonce), 'cache-control': 'no-store' },
  });
}
