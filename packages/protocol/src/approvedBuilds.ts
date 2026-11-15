/** Reviewed firmware support. Downloads never confer machine-control approval. */
import type { DialectId } from './dialects/types.ts';
import { SUPPORTED_TINYG_BUILDS } from './supportedFirmware.ts';
export type Environment = 'staging' | 'production';
export type Channel = 'bench' | 'release';
const ENVIRONMENT_BY_HOST: ReadonlyMap<string, Environment> = new Map([['run.synthetos.com', 'production'], ['staging.run.synthetos.com', 'staging']]);
export interface ApprovedBuild {
  readonly channel: Channel;
  readonly dialect: DialectId;
  /** The `fb` the board reports. */
  readonly fb: number;
  /** Exact hash for custom approvals; compiled support deliberately matches version. */
  readonly fbs: string | null;
  /**
   * The firmware commit the build was made from (40 hex digits). The probe
   * cannot read it from the board: it is shown only as the manifest's claim,
   * and only `fbs` ties a board to it.
   */
  readonly commit: string;
  readonly note: string;
  /** Simulator release or this browser's explicit trust in one custom image on one board. */
  readonly source?: 'release-list' | 'trusted';
  /** Compiled support matches version, not a remotely supplied hash. */
  readonly supportByVersion?: true;
  /** Restricts the approval to boards reporting this hardware version (release-list entries). */
  readonly hv?: number;
  /** Restricts the approval to this one board id (a trusted custom build). */
  readonly boardId?: string;
  /** The image a trusted build was flashed from (SHA-256 of its .hex), for display. */
  readonly imageSha256?: string;
}

/** What the probe read about the board that an approval may be restricted to. */
export interface ProbedBoard {
  readonly hv?: number | string | undefined;
  readonly id?: string | undefined;
}

export interface ApprovedBuilds {
  /** The environment the builds were accepted for, or null on any other origin. */
  readonly environment: Environment | null;
  readonly builds: readonly ApprovedBuild[];
}

export function environmentForOrigin(origin: string): Environment | null {
  const match = /^https:\/\/([a-z0-9.-]+)$/.exec(origin);
  return match === null ? null : (ENVIRONMENT_BY_HOST.get(match[1] as string) ?? null);
}

/** Compiled support matches version; custom approvals retain their exact restrictions. */
export function findApproval(
  manifest: ApprovedBuilds,
  dialect: DialectId,
  fb: number | undefined,
  fbs: string | undefined,
  board: ProbedBoard = {},
): ApprovedBuild | undefined {
  if (fb === undefined) return undefined;
  // A build that reports an fbs differs from one approved without it, and vice versa (D4: manifest(fb, fbs)).
  // A restricted approval (one hardware version, one board) matches only that board.
  return manifest.builds.find(
    (b) =>
      b.dialect === dialect &&
      b.fb === fb &&
      (b.supportByVersion === true || b.fbs === (fbs ?? null)) &&
      (b.hv === undefined || b.hv === board.hv) &&
      (b.boardId === undefined || (typeof board.id === 'string' && b.boardId === board.id)),
  );
}

export const NO_APPROVED_BUILDS: ApprovedBuilds = Object.freeze({ environment: null, builds: Object.freeze([]) });
export type ChannelRejection = 'no-environment' | 'malformed';
export interface ChannelVerdict { readonly channel: string; readonly accepted: boolean; readonly rejection?: ChannelRejection }
export interface VerifiedApprovedBuilds { readonly approved: ApprovedBuilds; readonly channels: readonly ChannelVerdict[] }
export interface VerifyOptions { readonly origin: string; readonly now: Date; readonly environment?: Environment | null }
/** Compatibility entry point: approval comes exclusively from this deployed code, never file contents. */
export async function verifyApprovedBuilds(_file: unknown, options: VerifyOptions): Promise<VerifiedApprovedBuilds> {
  const environment = options.environment !== undefined ? options.environment : environmentForOrigin(options.origin);
  if (environment === null) return { approved: NO_APPROVED_BUILDS, channels: [{ channel: '?', accepted: false, rejection: 'no-environment' }] };
  const channel = environment === 'production' ? 'release' : 'bench';
  const builds: ApprovedBuild[] = SUPPORTED_TINYG_BUILDS.map(fb => ({ channel, dialect: 'tinyg-en', fb, fbs: null, commit: '', note: 'Supported by this Run version', supportByVersion: true }));
  return { approved: { environment, builds }, channels: [{ channel, accepted: true }] };
}
