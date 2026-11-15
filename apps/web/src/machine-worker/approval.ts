/** Compiled supported versions, independent of the downloadable GitHub list. */
import { NO_APPROVED_BUILDS, environmentForOrigin, verifyApprovedBuilds, verifyFirmwareReleases, type ApprovedBuild, type ApprovedBuilds, type Environment, type FirmwareReleases, type VerifiedApprovedBuilds } from '@synthetos/protocol';

/** Loopback hosts the worker treats as the bench (staging) environment, over plain HTTP only. */
export const LOOPBACK_HOSTS: readonly string[] = Object.freeze(['localhost', '127.0.0.1']);

/** The environment the worker verifies the manifest for, from its own origin. Fails closed (null). */
export function approvalEnvironment(origin: string): Environment | null {
  const named = environmentForOrigin(origin);
  if (named !== null) return named;
  const m = /^http:\/\/([a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(origin);
  if (m === null) return null;
  return LOOPBACK_HOSTS.includes(m[1] as string) ? 'staging' : null;
}

export interface ApprovalOptions {
  /** The worker's `location.origin`. */
  readonly origin: string;
  readonly now: Date;
}

export interface ApprovalOutcome {
  readonly approved: ApprovedBuilds;
  readonly channels: VerifiedApprovedBuilds['channels'];
}

/** Loads compiled support for this worker. Never throws; anything unverifiable approves nothing. */
export async function approvedBuildsFor(file: unknown, options: ApprovalOptions): Promise<ApprovalOutcome> {
  const environment = approvalEnvironment(options.origin);
  if (environment === null) return { approved: NO_APPROVED_BUILDS, channels: Object.freeze([{ channel: '?', accepted: false, rejection: 'no-environment' as const }]) };
  try {
    const verified = await verifyApprovedBuilds(file, { origin: options.origin, now: options.now, environment });
    return { approved: verified.approved, channels: verified.channels };
  } catch {
    return { approved: NO_APPROVED_BUILDS, channels: Object.freeze([{ channel: '?', accepted: false, rejection: 'malformed' as const }]) };
  }
}

/** One line for the session log: which channels were accepted or why not. */
export function approvalRecord(outcome: ApprovalOutcome): string {
  const parts = outcome.channels.map((c) => (c.accepted ? `${c.channel}: accepted` : `${c.channel}: ${c.rejection ?? 'rejected'}`));
  return `approved builds (${outcome.approved.environment ?? 'no environment'}): ${parts.join(', ') || 'none'}; ${outcome.approved.builds.length} build(s) approved`;
}

// --- Approvals beyond compiled support (SAFETY §4.8 as amended 2026-11-03, H86, H87) -------------------------

/** A custom build the user trusted on one board, as the page sends it at Connect (device-safety, never synced). */
export interface TrustedBuild {
  readonly boardId: string;
  /** SHA-256 of the `.hex` the board was flashed with from this browser. */
  readonly sha256: string;
  readonly dialect: 'tinyg-en' | 'tinyg-440';
  readonly fb: number;
  readonly fbs: string | null;
  readonly name: string;
}

/** Most trusted builds one connect may carry. */
export const MAX_TRUSTED_BUILDS = 16;

/** A trusted-build record from the page, strictly; null when it is not exactly one. */
export function parseTrustedBuild(value: unknown): TrustedBuild | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== 'boardId,dialect,fb,fbs,name,sha256') return null;
  const { boardId, sha256, dialect, fb, fbs, name } = v;
  if (typeof boardId !== 'string' || boardId.length === 0 || boardId.length > 64) return null;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  if (dialect !== 'tinyg-en' && dialect !== 'tinyg-440') return null;
  if (typeof fb !== 'number' || !Number.isFinite(fb) || fb <= 0) return null;
  if (fbs !== null && (typeof fbs !== 'string' || fbs.length === 0 || fbs.length > 64)) return null;
  if (typeof name !== 'string' || name.length === 0 || name.length > 200) return null;
  return Object.freeze({ boardId, sha256, dialect, fb, fbs, name });
}

/** Simulator and explicitly trusted per-board custom images remain staging-only.
 * Downloadable real releases never confer control approval. */
export function extraApprovals(base: ApprovedBuilds, extra: { readonly flasher: boolean; readonly releases: FirmwareReleases | null; readonly simulated: boolean; readonly trusted: readonly TrustedBuild[] }): ApprovedBuilds {
  if (!extra.flasher || base.environment !== 'staging') return base;
  const builds: ApprovedBuild[] = [...base.builds];
  // Test-only simulated images are never approvals on a real serial port.
  if (extra.simulated) for (const hw of extra.releases?.boards ?? []) {
    for (const r of hw.releases) if (r.simulatorOnly) builds.push({ channel: 'bench', dialect: r.dialect, fb: r.fb, fbs: null, commit: '', note: 'Simulator image', source: 'release-list', hv: r.hv });
  }
  for (const t of extra.trusted.slice(0, MAX_TRUSTED_BUILDS)) {
    builds.push(Object.freeze({ channel: 'bench', dialect: t.dialect, fb: t.fb, fbs: t.fbs, commit: '', note: `custom firmware ${t.name}, trusted by the user on this board`, source: 'trusted', boardId: t.boardId, imageSha256: t.sha256 }));
  }
  return Object.freeze({ environment: base.environment, builds: Object.freeze(builds) });
}

/** This worker's verified release list for its origin, or null (production: no entry; other origins: none). */
export async function releasesFor(file: unknown, origin: string, now: Date): Promise<FirmwareReleases | null> {
  const environment = approvalEnvironment(origin);
  const verdict = await verifyFirmwareReleases(file, { environment, now }).catch(() => null);
  return verdict !== null && verdict.ok ? verdict.releases : null;
}
