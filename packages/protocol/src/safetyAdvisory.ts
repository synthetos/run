/** Unsigned, deployed per-environment revocations. The HTTPS deployment is authoritative. */
import { clockMs, hasOnlyKeys, isRecord, parseTime } from './dataValidation.ts';

export type AdvisoryEnvironment = 'staging' | 'production';

export const SAFETY_ADVISORY_FORMAT = 'synthetos-run/safety-advisory@1';
export const ADVISORY_PAYLOAD_FORMAT = 'synthetos-run/safety-advisory-env@1';

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
}

const PAYLOAD_KEYS: readonly string[] = ['format', 'env', 'issued', 'expires', 'revoked'];
const REVOCATION_KEYS: readonly string[] = ['sha', 'reason'];

function reject(rejection: AdvisoryRejection): AdvisoryVerdict {
  return Object.freeze({ ok: false, rejection });
}

function readRevocations(list: unknown): readonly Revocation[] | null {
  if (!Array.isArray(list)) return null;
  const revoked: Revocation[] = [];
  for (const r of list) {
    if (!isRecord(r) || !hasOnlyKeys(r, REVOCATION_KEYS)) return null;
    const { sha, reason } = r;
    if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha) || typeof reason !== 'string') return null;
    revoked.push(Object.freeze({ sha, reason }));
  }
  return Object.freeze(revoked);
}

function readAdvisory(body: Record<string, unknown>, environment: AdvisoryEnvironment): SafetyAdvisory | null {
  if (body['format'] !== ADVISORY_PAYLOAD_FORMAT || !hasOnlyKeys(body, PAYLOAD_KEYS)) return null;
  const issuedMs = parseTime(body['issued']);
  const expiresMs = parseTime(body['expires']);
  if (issuedMs === undefined || expiresMs === undefined || !(issuedMs < expiresMs)) return null;
  const revoked = readRevocations(body['revoked']);
  if (revoked === null) return null;
  return Object.freeze({ env: environment, issuedMs, expiresMs, revoked });
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
  const body = mine[0] as Record<string, unknown>;
  const advisory = readAdvisory(body, environment);
  if (advisory === null) return reject('malformed-payload');
  const { issuedMs, expiresMs } = advisory;
  if (nowMs < issuedMs) return reject('not-yet-valid');
  if (nowMs >= expiresMs) return reject('expired');
  return Object.freeze({ ok: true, advisory });
}

/**
 * The revocation of this app build, if the advisory lists it. A build from
 * an uncommitted tree (`<sha>-dirty`) is revoked when its base commit is.
 */
export function findRevocation(advisory: SafetyAdvisory, appSha: string): Revocation | undefined {
  const base = appSha.endsWith('-dirty') ? appSha.slice(0, -'-dirty'.length) : appSha;
  return advisory.revoked.find((r) => r.sha === base);
}
