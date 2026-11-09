/**
 * The `RUN_AUTH` D1 database (workers/run/migrations): pending sign-ins, device rows and the sign-in rate counter
 * (ROADMAP A1-06; accounts docs/RP_CONTRACT.md "Registration and browser handoff", "Run binding").
 *
 * - A pending sign-in is stored server-side with its state hash, the hash of the browser's pre-auth nonce, the
 *   encrypted PKCE verifier, the OIDC nonce, the checked return path and the shared-computer choice. It is consumed
 *   once, by one conditional UPDATE that also checks expiry and the browser nonce (never read-then-write).
 * - A device row is created before the code exchange (accounts records it on the session) and bound to the
 *   session's `sub` after it, by a conditional UPDATE that must change exactly one row.
 * - Every write binds its values; no SQL is built from input.
 *
 * Only digests of bearer values are stored. The schema is the migration; this module holds the queries.
 */

/** The subset of Cloudflare's D1 binding this module uses. */
export interface AuthStatement {
  bind(...values: unknown[]): AuthStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ readonly meta: { readonly changes: number } }>;
}

export interface AuthDatabase {
  prepare(sql: string): AuthStatement;
}

/** Attempts per edge IP per window before `/auth/login` answers 429. */
export const LOGIN_LIMIT = 20;
export const LOGIN_WINDOW_SECONDS = 600;
/** At most this many expired rows are pruned per sign-in start (bounded work per request). */
export const PRUNE_LIMIT = 100;

export interface PendingSignIn {
  readonly stateHash: string;
  readonly browserNonceHash: string;
  readonly verifierSealed: string;
  readonly nonce: string;
  readonly returnTo: string;
  readonly sharedComputer: boolean;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface ConsumedSignIn {
  readonly verifierSealed: string;
  readonly nonce: string;
  readonly returnTo: string;
  readonly sharedComputer: boolean;
}

export class AuthStore {
  readonly #db: AuthDatabase;

  constructor(db: AuthDatabase) {
    this.#db = db;
  }

  /** Counts one sign-in start for `bucket` (a keyed IP hash and window); returns the count so far. */
  async countLogin(bucket: string, now: number): Promise<number> {
    const row = await this.#db
      .prepare(
        `INSERT INTO login_rate(bucket,count,expires_at) VALUES(?,1,?)
         ON CONFLICT(bucket) DO UPDATE SET count=MIN(count+1,1000) RETURNING count`,
      )
      .bind(bucket, now + LOGIN_WINDOW_SECONDS)
      .first<{ count: number }>();
    return row?.count ?? Number.MAX_SAFE_INTEGER;
  }

  /** Removes a bounded number of expired pending sign-ins, rate buckets and never-bound device rows. */
  async prune(now: number): Promise<void> {
    await this.#db.prepare(`DELETE FROM auth_requests WHERE rowid IN (SELECT rowid FROM auth_requests WHERE expires_at<=? LIMIT ${PRUNE_LIMIT})`).bind(now).run();
    await this.#db.prepare(`DELETE FROM login_rate WHERE rowid IN (SELECT rowid FROM login_rate WHERE expires_at<=? LIMIT ${PRUNE_LIMIT})`).bind(now).run();
    await this.#db
      .prepare(`DELETE FROM devices WHERE rowid IN (SELECT rowid FROM devices WHERE user_sub IS NULL AND created_at<=? LIMIT ${PRUNE_LIMIT})`)
      .bind(now - LOGIN_WINDOW_SECONDS)
      .run();
  }

  async createSignIn(p: PendingSignIn): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO auth_requests(state_hash,browser_nonce_hash,verifier_enc,nonce,return_to,shared_computer,created_at,expires_at)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .bind(p.stateHash, p.browserNonceHash, p.verifierSealed, p.nonce, p.returnTo, p.sharedComputer ? 1 : 0, p.createdAt, p.expiresAt)
      .run();
  }

  /**
   * Consumes the pending sign-in for `stateHash` once, only while unexpired and only when the browser's nonce hash
   * matches. Null for an unknown, used, expired or foreign-browser state (indistinguishable to the caller).
   */
  async consumeSignIn(stateHash: string, browserNonceHash: string, now: number): Promise<ConsumedSignIn | null> {
    const row = await this.#db
      .prepare(
        `UPDATE auth_requests SET used_at=?
         WHERE state_hash=? AND browser_nonce_hash=? AND used_at IS NULL AND expires_at>?
         RETURNING verifier_enc,nonce,return_to,shared_computer`,
      )
      .bind(now, stateHash, browserNonceHash, now)
      .first<{ verifier_enc: string; nonce: string; return_to: string; shared_computer: number }>();
    if (row === null) return null;
    return { verifierSealed: row.verifier_enc, nonce: row.nonce, returnTo: row.return_to, sharedComputer: row.shared_computer === 1 };
  }

  /** A device row with no user yet (bound after the exchange). */
  async createDevice(id: string, label: string, now: number): Promise<void> {
    await this.#db.prepare('INSERT INTO devices(id,user_sub,created_at,last_seen_at,label) VALUES(?,NULL,?,?,?)').bind(id, now, now, label).run();
  }

  /** Binds the new device row to `sub`. True only when exactly that unbound row changed. */
  async bindDevice(id: string, sub: string, now: number): Promise<boolean> {
    const result = await this.#db.prepare('UPDATE devices SET user_sub=?,last_seen_at=? WHERE id=? AND user_sub IS NULL').bind(sub, now, id).run();
    return result.meta.changes === 1;
  }

  /** Deletes a device row that was never bound (a failed sign-in). */
  async dropDevice(id: string): Promise<void> {
    await this.#db.prepare('DELETE FROM devices WHERE id=? AND user_sub IS NULL').bind(id).run();
  }
}
