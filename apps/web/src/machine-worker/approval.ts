/**
 * The approved-builds gate of `machine.worker` (ROADMAP P1-03; RUN_PLAN §5.2,
 * §6.3; SAFETY H27, H44, T-S75).
 *
 * The worker classifies every board against the signed manifest
 * `firmware/approved-builds.json`, bundled into the worker at build time (the
 * worker has no network code, RUN_PLAN §5.4). Before every connect the worker
 * verifies the bundled file again, here, with its own clock:
 *
 * - the environment comes from the worker's own origin: run's production host
 *   is `production`, the staging host is `staging`, and plain-HTTP loopback
 *   (the localhost bench server, and the local test servers) is `staging`.
 *   The bench build is a staging build (D41), and only the bench channel's
 *   window can go LIVE on loopback (the advisory and the D1 gate refuse the
 *   release build there). Any other origin has no environment;
 * - every channel must carry an Ed25519 signature that verifies under a
 *   compiled-in `RELEASE_KEYS` entry authorised for that environment, name
 *   that environment in its signed payload, and be inside its validity window
 *   (protocol approvedBuilds.ts);
 * - the classifier then matches a probed board by dialect, `fb` and `fbs`.
 *
 * Anything that fails (a bad signature, an unknown key, the wrong
 * environment, an expired channel, no matching build, a malformed file)
 * contributes no approval, and the board stays READ_ONLY. Production reads
 * only the release channel, which is empty until an image passes D5, so
 * production stays read-only.
 */
import { NO_APPROVED_BUILDS, environmentForOrigin, verifyApprovedBuilds, verifyFirmwareReleases, type ApprovedBuild, type ApprovedBuilds, type Environment, type FirmwareReleases, type ReleaseKey, type VerifiedApprovedBuilds } from '@synthetos/protocol';

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
  /** Tests only: other trusted keys. The worker always uses the compiled-in `RELEASE_KEYS`. */
  readonly keys?: readonly ReleaseKey[];
}

export interface ApprovalOutcome {
  readonly approved: ApprovedBuilds;
  readonly channels: VerifiedApprovedBuilds['channels'];
}

/** Verifies the bundled manifest for this worker. Never throws; anything unverifiable approves nothing. */
export async function approvedBuildsFor(file: unknown, options: ApprovalOptions): Promise<ApprovalOutcome> {
  const environment = approvalEnvironment(options.origin);
  if (environment === null) return { approved: NO_APPROVED_BUILDS, channels: Object.freeze([{ channel: '?', accepted: false, rejection: 'no-environment' as const }]) };
  try {
    const verified = await verifyApprovedBuilds(file, { origin: options.origin, now: options.now, environment, ...(options.keys === undefined ? {} : { keys: options.keys }) });
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

// --- Approvals beyond the signed manifest (SAFETY §4.8 as amended 2026-11-03, H86, H87) -------------------------

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

/**
 * The approvals the worker adds to the verified manifest, only where the flasher phase switch is on (the
 * staging environment):
 * - each release in the release list this worker verified, for its hardware version only (a signed release is an
 *   approval for that environment); an image for the simulated board only when the port is the test kit's;
 * - each custom build the user trusted, for that one board only, and never on production.
 * Nothing here can approve on production: production's release list has no entry and the switch is off there.
 */
export function extraApprovals(base: ApprovedBuilds, extra: { readonly flasher: boolean; readonly releases: FirmwareReleases | null; readonly simulated: boolean; readonly trusted: readonly TrustedBuild[] }): ApprovedBuilds {
  if (!extra.flasher || base.environment !== 'staging') return base;
  const builds: ApprovedBuild[] = [...base.builds];
  for (const hw of extra.releases?.boards ?? []) {
    for (const r of hw.releases) {
      if (r.simulatorOnly && !extra.simulated) continue;
      builds.push(Object.freeze({ channel: 'bench', dialect: r.dialect, fb: r.fb, fbs: null, commit: '', note: `signed release ${r.file}`, source: 'release-list', hv: r.hv }));
    }
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
