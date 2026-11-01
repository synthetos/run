/**
 * The signed safety advisory (ROADMAP P1-05; SAFETY H27, T-S31, T-S75;
 * RUN_PLAN §6.3).
 *
 * `safety-advisory.json` lists app versions (build commit SHAs) that must no
 * longer enter LIVE. Like `approved-builds.json` it is a per-environment
 * signed data file: one entry per environment, each a JSON payload string
 * signed with Ed25519 over `ADVISORY_SIGNING_PREFIX + payload` by a
 * compiled-in release key authorised for that environment. The payload must
 * name the same environment, and carries an issue and expiry time.
 *
 * The caller passes the environment it runs in (the web app derives it from
 * `location.origin`, and the localhost bench build reads the staging entry).
 * The production origin therefore never accepts a staging-signed entry:
 * there is no production entry in it, the key is not authorised for
 * production, and the payload names staging (T-S75).
 *
 * Verification never throws. Anything malformed, unsigned, expired, for
 * another environment or ambiguous is a rejection, and a rejection refuses
 * LIVE (fail closed, H27). This module decides only "verified, and which
 * versions are revoked"; caching, the 7-day rule and the poll are the web
 * app's (apps/web/src/live/advisoryGate.ts).
 */
import { RELEASE_KEYS } from './releaseKeys.ts';
import type { ReleaseKey } from './releaseKeys.ts';
import { clockMs, hasOnlyKeys, isRecord, parseJson, parseTime, verifyEd25519 } from './signed.ts';

export type AdvisoryEnvironment = 'staging' | 'production';

export const SAFETY_ADVISORY_FORMAT = 'synthetos-run/safety-advisory@1';
export const ADVISORY_PAYLOAD_FORMAT = 'synthetos-run/safety-advisory-env@1';
/** Prefixed to the payload before signing; differs from the manifest's, so neither signature replays as the other. */
export const ADVISORY_SIGNING_PREFIX = 'synthetos-run safety-advisory v1\n';

export interface Revocation {
  /** The revoked build's full commit SHA (40 hex digits). */
  readonly sha: string;
  readonly reason: string;
}

export interface SafetyAdvisory {
  readonly env: AdvisoryEnvironment;
  readonly issuedMs: number;
  readonly expiresMs: number;
  readonly revoked: readonly Revocation[];
}

export type AdvisoryRejection =
  | 'no-environment'
  | 'malformed'
  | 'no-entry'
  | 'duplicate-entry'
  | 'unknown-key'
  | 'key-not-authorised-for-environment'
  | 'bad-signature'
  | 'malformed-payload'
  | 'environment-mismatch'
  | 'not-yet-valid'
  | 'expired'
  | 'invalid-clock';

export type AdvisoryVerdict =
  | { readonly ok: true; readonly advisory: SafetyAdvisory }
  | { readonly ok: false; readonly rejection: AdvisoryRejection };

export interface AdvisoryVerifyOptions {
  /** The environment the page runs in, or null (any other origin: nothing verifies). */
  readonly environment: AdvisoryEnvironment | null;
  readonly now: Date;
  readonly keys?: readonly ReleaseKey[];
}

const ENTRY_KEYS: readonly string[] = ['env', 'kid', 'payload', 'sig'];
const PAYLOAD_KEYS: readonly string[] = ['format', 'env', 'issued', 'expires', 'revoked'];
const REVOCATION_KEYS: readonly string[] = ['sha', 'reason'];

function reject(rejection: AdvisoryRejection): AdvisoryVerdict {
  return Object.freeze({ ok: false, rejection });
}

/** Verify the advisory file for one environment. Never throws. */
export async function verifySafetyAdvisory(file: unknown, options: AdvisoryVerifyOptions): Promise<AdvisoryVerdict> {
  const { environment } = options;
  if (environment !== 'staging' && environment !== 'production') return reject('no-environment');
  const nowMs = clockMs(options.now);
  if (nowMs === undefined) return reject('invalid-clock');
  if (!isRecord(file) || file['format'] !== SAFETY_ADVISORY_FORMAT || !hasOnlyKeys(file, ['format', 'advisories'])) return reject('malformed');
  const entries = file['advisories'];
  if (!Array.isArray(entries)) return reject('malformed');
  const mine = entries.filter((e) => isRecord(e) && e['env'] === environment);
  if (mine.length === 0) return reject('no-entry');
  // Two entries for one environment: which one is meant is not decidable, so neither is used.
  if (mine.length > 1) return reject('duplicate-entry');
  const entry = mine[0] as Record<string, unknown>;
  if (!hasOnlyKeys(entry, ENTRY_KEYS)) return reject('malformed');
  const { kid, payload, sig } = entry;
  if (typeof kid !== 'string' || typeof payload !== 'string' || typeof sig !== 'string') return reject('malformed');
  const key = (options.keys ?? RELEASE_KEYS).find((k) => k.kid === kid);
  if (key === undefined) return reject('unknown-key');
  if (!key.environments.includes(environment)) return reject('key-not-authorised-for-environment');
  if (!(await verifyEd25519(key.publicKey, sig, ADVISORY_SIGNING_PREFIX + payload))) return reject('bad-signature');

  const body = parseJson(payload);
  if (!isRecord(body) || body['format'] !== ADVISORY_PAYLOAD_FORMAT || !hasOnlyKeys(body, PAYLOAD_KEYS)) return reject('malformed-payload');
  if (body['env'] !== environment) return reject('environment-mismatch');
  const issuedMs = parseTime(body['issued']);
  const expiresMs = parseTime(body['expires']);
  if (issuedMs === undefined || expiresMs === undefined || !(issuedMs < expiresMs)) return reject('malformed-payload');
  const list = body['revoked'];
  if (!Array.isArray(list)) return reject('malformed-payload');
  const revoked: Revocation[] = [];
  for (const r of list) {
    if (!isRecord(r) || !hasOnlyKeys(r, REVOCATION_KEYS)) return reject('malformed-payload');
    const { sha, reason } = r;
    if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha) || typeof reason !== 'string') return reject('malformed-payload');
    revoked.push(Object.freeze({ sha, reason }));
  }
  if (nowMs < issuedMs) return reject('not-yet-valid');
  if (nowMs >= expiresMs) return reject('expired');
  return Object.freeze({ ok: true, advisory: Object.freeze({ env: environment, issuedMs, expiresMs, revoked: Object.freeze(revoked) }) });
}

/**
 * The revocation of this app build, if the advisory lists it. A build from
 * an uncommitted tree (`<sha>-dirty`) is revoked when its base commit is.
 */
export function findRevocation(advisory: SafetyAdvisory, appSha: string): Revocation | undefined {
  const base = appSha.endsWith('-dirty') ? appSha.slice(0, -'-dirty'.length) : appSha;
  return advisory.revoked.find((r) => r.sha === base);
}
