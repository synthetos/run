/**
 * Test harness for run's sign-in handoff: the RUN_AUTH schema in an in-memory SQLite database behind the D1 subset
 * the Worker uses, and a fake accounts `RunEntrypoint` that follows the RP contract (codes bound to the redirect
 * URI, the S256 challenge and the nonce; single use; sessions validated on every call; revocation at once).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { AccountsBinding, AccountsSession, ExchangeResult } from '../src/authConfig.ts';
import type { AuthDatabase, AuthStatement } from '../src/authStore.ts';
import type { Env } from '../src/routes.ts';

const MIGRATIONS = new URL('../migrations/', import.meta.url);

export function authDatabase(): { readonly db: AuthDatabase; readonly sql: DatabaseSync } {
  const sql = new DatabaseSync(':memory:');
  for (const name of readdirSync(MIGRATIONS).filter((n: string) => n.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(name, MIGRATIONS), 'utf8'));
  const db: AuthDatabase = {
    prepare(text: string): AuthStatement {
      const statement = sql.prepare(text);
      let values: unknown[] = [];
      const self: AuthStatement = {
        bind(...bound: unknown[]) {
          values = bound;
          return self;
        },
        first<T>() {
          return Promise.resolve((statement.get(...(values as never[])) as T | undefined) ?? null);
        },
        run() {
          return Promise.resolve({ meta: { changes: Number(statement.run(...(values as never[])).changes) } });
        },
      };
      return self;
    },
  };
  return { db, sql };
}

const b64url = (bytes: Buffer): string => bytes.toString('base64url');

export interface FakeAccounts extends AccountsBinding {
  /** Issues a code for the `/authorize` URL run redirected to, as accounts would after a sign-in. */
  authorize(location: string, login?: string): string;
  readonly exchanges: number;
  readonly revoked: readonly string[];
  /** Makes the next exchange misbehave. */
  next: 'ok' | 'throw' | 'wrong-device' | 'wrong-nonce' | 'wrong-client' | 'malformed';
  /** Called during an exchange (for races). */
  onExchange: (deviceId: string) => void;
}

export function fakeAccounts(clock: () => number, redirectUri: string): FakeAccounts {
  const codes = new Map<string, { challenge: string; redirect: string; nonce: string; login: string }>();
  const sessions = new Map<string, AccountsSession & { revoked: boolean }>();
  let exchanges = 0;
  const revoked: string[] = [];
  let counter = 0;
  const fake: FakeAccounts = {
    next: 'ok',
    onExchange: () => undefined,
    get exchanges() {
      return exchanges;
    },
    get revoked() {
      return revoked;
    },
    authorize(location, login = 'ril3y') {
      const url = new URL(location);
      if (url.searchParams.get('client_id') !== 'run' || url.searchParams.get('redirect_uri') !== redirectUri) throw new Error('unregistered');
      counter += 1;
      const code = b64url(createHash('sha256').update(`code-${counter}`).digest());
      codes.set(code, { challenge: url.searchParams.get('code_challenge') ?? '', redirect: url.searchParams.get('redirect_uri') ?? '', nonce: url.searchParams.get('nonce') ?? '', login });
      return code;
    },
    async exchangeCode(code, verifier, context) {
      exchanges += 1;
      const issued = codes.get(code);
      codes.delete(code);
      if (fake.next === 'throw') {
        fake.next = 'ok';
        throw new Error('invalid_grant');
      }
      if (issued === undefined || issued.redirect !== context.redirectUri) throw new Error('invalid_grant');
      if (b64url(createHash('sha256').update(verifier).digest()) !== issued.challenge) throw new Error('invalid_grant');
      fake.onExchange(context.deviceRecordId);
      counter += 1;
      const token = b64url(createHash('sha256').update(`token-${counter}`).digest());
      const mode = fake.next;
      fake.next = 'ok';
      const now = clock();
      const session: AccountsSession & { revoked: boolean } = {
        id: `ses_${counter}`,
        sub: 'usr_01JTESTUSER0000000000000000',
        name: issued.login,
        client: mode === 'wrong-client' ? 'forum-synthetos' : 'run',
        identities: [{ provider: 'github', id: '231731', login: issued.login }],
        absoluteExpiresAt: now + 7 * 86400,
        deviceRecordId: mode === 'wrong-device' ? 'dev_other' : context.deviceRecordId,
        sharedComputer: context.sharedComputer ?? false,
        revoked: false,
      };
      sessions.set(token, session);
      const claims = { iss: 'https://staging.accounts.synthetos.com', aud: 'run', sub: session.sub, nonce: mode === 'wrong-nonce' ? 'other' : issued.nonce };
      const idToken = `${b64url(Buffer.from('{"alg":"ES256","typ":"JWT"}'))}.${b64url(Buffer.from(JSON.stringify(claims)))}.sig`;
      const result: ExchangeResult = { sessionToken: token, idToken: mode === 'malformed' ? (42 as unknown as string) : idToken, expiresIn: 7 * 86400, session };
      return result;
    },
    async validateSession(token) {
      const s = sessions.get(token);
      return s === undefined || s.revoked ? null : s;
    },
    async revokeSession(token) {
      revoked.push(token);
      const s = sessions.get(token);
      if (s === undefined) throw new Error('invalid_session');
      s.revoked = true;
    },
  };
  return fake;
}

export const STATE_KEY = Buffer.alloc(32, 7).toString('base64url');
export const RATE_KEY = Buffer.alloc(32, 9).toString('base64url');
export const STAGING_ORIGIN = 'https://staging.run.synthetos.com';
export const PRODUCTION_ORIGIN = 'https://run.synthetos.com';

/** A signed-in-capable env for `origin`'s environment, with its own database and fake accounts. */
export function authEnv(environment: 'staging' | 'production', clock: () => number) {
  const origin = environment === 'staging' ? STAGING_ORIGIN : PRODUCTION_ORIGIN;
  const { db, sql } = authDatabase();
  const accounts = fakeAccounts(clock, `${origin}/auth/callback`);
  const env: Env = { ASSETS: { fetch: () => Promise.resolve(new Response('')) }, RUN_ENV: environment, ACCOUNTS: accounts, RUN_AUTH: db, RUN_STATE_KEY: STATE_KEY, RUN_RATE_KEY: RATE_KEY };
  return { env, accounts, sql, origin };
}

/** The `name=value` of a Set-Cookie for `name`, and the full header. */
export function setCookie(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

export function cookieValue(header: string | undefined): string {
  return header?.split(';')[0]?.split('=')[1] ?? '';
}
