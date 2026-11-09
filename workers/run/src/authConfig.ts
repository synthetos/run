/**
 * Whether run's sign-in handoff is on, and its fixed origins (ROADMAP A1-06, A1-07; DECISIONS D1, D37, D39).
 *
 * Sign-in is on only when every piece is present and the request came to the host this Worker is deployed for:
 * - `RUN_ENV` is `production` or `staging`, and the request is `https://run.synthetos.com` or
 *   `https://staging.run.synthetos.com` to match (any other host, port or scheme: off);
 * - the `ACCOUNTS` service binding (accounts' named `RunEntrypoint`, pinned in wrangler.jsonc);
 * - the `RUN_AUTH` D1 database (pending sign-ins and device rows);
 * - the two secrets `RUN_STATE_KEY` and `RUN_RATE_KEY`, each a canonical base64url 32-byte key.
 *
 * Off means exactly what run did before: `/auth/*` is a 404 and `/api/identity` names no run session. A missing
 * secret therefore fails closed. The origins are constants, never read from a variable or the request, so a
 * redirect can only ever go to the accounts host of the same environment.
 *
 * Who may sign in is decided by accounts, before any user or session exists (D37, `GITHUB_ALLOWED_IDS`), never by
 * this Worker or the page.
 */
import { readKey } from './authCrypto.ts';
import type { AuthDatabase } from './authStore.ts';

/** The session view accounts returns (accounts workers/accounts/src/oidc.ts `SessionView`), as far as run reads it. */
export interface AccountsSession {
  readonly id: string;
  readonly sub: string;
  readonly name: string;
  readonly client: string;
  readonly identities: readonly { readonly provider: string; readonly id: string; readonly login: string }[];
  readonly absoluteExpiresAt: number;
  readonly deviceRecordId: string | null;
  readonly sharedComputer: boolean;
}

export interface ExchangeResult {
  readonly sessionToken: string;
  readonly idToken: string;
  readonly expiresIn: number;
  readonly session: AccountsSession;
}

/** accounts' `RunEntrypoint` over the service binding (accounts docs/RP_CONTRACT.md "Run binding"). */
export interface AccountsBinding {
  exchangeCode(code: string, verifier: string, context: { redirectUri: string; deviceRecordId: string; sharedComputer?: boolean }): Promise<ExchangeResult>;
  validateSession(token: string): Promise<AccountsSession | null>;
  revokeSession(token: string): Promise<void>;
}

export interface AuthEnv {
  readonly RUN_ENV?: string;
  readonly ACCOUNTS?: AccountsBinding;
  readonly RUN_AUTH?: AuthDatabase;
  readonly RUN_STATE_KEY?: string;
  readonly RUN_RATE_KEY?: string;
}

/** The run origin and the accounts origin of each deployed environment. */
export const AUTH_ORIGINS = {
  production: { run: 'https://run.synthetos.com', accounts: 'https://accounts.synthetos.com' },
  staging: { run: 'https://staging.run.synthetos.com', accounts: 'https://staging.accounts.synthetos.com' },
} as const;

/** The single client id accounts registers for run, and run's single callback path. */
export const RUN_CLIENT_ID = 'run';
export const CALLBACK_PATH = '/auth/callback';

export interface AuthConfig {
  readonly runOrigin: string;
  readonly accountsOrigin: string;
  readonly redirectUri: string;
  readonly accounts: AccountsBinding;
  readonly db: AuthDatabase;
  readonly stateKey: Uint8Array<ArrayBuffer>;
  readonly rateKey: Uint8Array<ArrayBuffer>;
}

/** The sign-in configuration for this request, or null when sign-in is off here. */
export function authConfig(env: AuthEnv, url: URL): AuthConfig | null {
  const environment = env.RUN_ENV;
  if (environment !== 'production' && environment !== 'staging') return null;
  const origins = AUTH_ORIGINS[environment];
  if (url.origin !== origins.run) return null;
  const stateKey = readKey(env.RUN_STATE_KEY);
  const rateKey = readKey(env.RUN_RATE_KEY);
  if (env.ACCOUNTS === undefined || env.RUN_AUTH === undefined || stateKey === null || rateKey === null) return null;
  return {
    runOrigin: origins.run,
    accountsOrigin: origins.accounts,
    redirectUri: `${origins.run}${CALLBACK_PATH}`,
    accounts: env.ACCOUNTS,
    db: env.RUN_AUTH,
    stateKey,
    rateKey,
  };
}
