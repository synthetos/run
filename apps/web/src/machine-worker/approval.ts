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
import { NO_APPROVED_BUILDS, environmentForOrigin, verifyApprovedBuilds, type ApprovedBuilds, type Environment, type ReleaseKey, type VerifiedApprovedBuilds } from '@synthetos/protocol';

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
