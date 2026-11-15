/** GitHub release data, checked independently by the page and flash worker. */
import { SIMULATOR_RELEASES } from './simulatorReleases.ts';
import type { DialectId } from './dialects/types.ts';
import { isRecord } from './dataValidation.ts';
export type ReleasesEnvironment = 'staging' | 'production';
export const FIRMWARE_RELEASES_FORMAT = 'synthetos-run/github-releases@1';
export const FIRMWARE_RELEASE_REPOSITORIES: readonly string[] = Object.freeze(['synthetos/TinyG']);
export const FIRMWARE_RELEASE_TAG_RE = /^(?!\.+$)[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const MAX_RELEASE_HEX_BYTES = 2 * 1024 * 1024;
export interface FirmwareRelease {
  readonly hv: number;
  readonly fb: number;
  readonly fv: number;
  readonly dialect: DialectId;
  /** avrdude's part name; `x192a3` only. */
  readonly part: 'x192a3';
  /** The `.hex` file name (no directory). */
  readonly file: string;
  /** SHA-256 of the exact `.hex` bytes, lower-case hex. */
  readonly sha256: string;
  /** Size of the `.hex` file in bytes. */
  readonly size: number;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly changelog: string;
  readonly recommended: boolean;
  readonly prerelease?: boolean;
  readonly unavailable?: string;
  /** An image for the test kit's simulated board only (fake-serial). */
  readonly simulatorOnly: boolean;
  /** The GitHub repository (`owner/name`, one of FIRMWARE_RELEASE_REPOSITORIES) whose release holds `file`, or null when the site bundles it. */
  readonly repo: string | null;
  /** The release tag in `repo` (`440.21`, `v2.0.0`), or null with `repo`. */
  readonly tag: string | null;
}

export interface HardwareReleases {
  readonly hv: number;
  /** Boards of this hardware below this build are locked to read-only until updated (null: no minimum). */
  readonly minimumFb: number | null;
  /** Newest first. */
  readonly releases: readonly FirmwareRelease[];
}

export interface FirmwareReleases {
  readonly env: ReleasesEnvironment;
  readonly issuedMs: number;
  readonly expiresMs: number;
  readonly boards: readonly HardwareReleases[];
}

export type ReleasesRejection = 'no-environment' | 'malformed' | 'invalid-clock';
export type ReleasesVerdict = { readonly ok: true; readonly releases: FirmwareReleases } | { readonly ok: false; readonly rejection: ReleasesRejection };
export interface ReleasesVerifyOptions { readonly environment: ReleasesEnvironment | null; readonly now: Date }
function releaseIntegrity(value: Record<string, unknown>): Pick<FirmwareRelease, 'sha256' | 'size' | 'unavailable'> | null {
  const { sha256, size, unavailable } = value;
  const validDigest = typeof sha256 === 'string' && /^[0-9a-f]{64}$/.test(sha256);
  const validSize = typeof size === 'number' && Number.isSafeInteger(size) && size > 0 && size <= MAX_RELEASE_HEX_BYTES;
  if (!validDigest || !validSize) {
    if (typeof unavailable !== 'string' || !unavailable || unavailable.length > 500) return null;
  } else if (unavailable !== null) return null;
  return { sha256: validDigest ? sha256 : '', size: validSize ? size : 0, ...(typeof unavailable === 'string' ? { unavailable } : {}) };
}
function releaseMetadata(value: Record<string, unknown>) {
  const { tag, file, date, notes, prerelease } = value;
  if (typeof tag !== 'string' || !/^(?:v)?[0-9]{3}\.[0-9]{2}$/.test(tag)) return null;
  if (typeof file !== 'string' || !/^tinyg-[A-Za-z0-9._-]+\.hex$/.test(file)) return null;
  if (typeof date !== 'string' || !Number.isFinite(Date.parse(date))) return null;
  if (typeof notes !== 'string' || notes.length > 16000 || typeof prerelease !== 'boolean') return null;
  return { tag, file, date: date.slice(0, 10), changelog: notes, prerelease };
}
function readRelease(value: unknown, recommended: boolean): FirmwareRelease | null {
  if (!isRecord(value) || value['repo'] !== 'synthetos/TinyG') return null;
  const metadata = releaseMetadata(value), integrity = releaseIntegrity(value);
  if (metadata === null || integrity === null) return null;
  const fb = Number(metadata.tag.replace(/^v/, ''));
  return Object.freeze({ ...metadata, ...integrity, hv: 8, fb, fv: 0.97, dialect: fb >= 450 ? 'tinyg-en' : 'tinyg-440', part: 'x192a3', recommended, simulatorOnly: false, repo: 'synthetos/TinyG' });
}
/** Schema validation, not a signature check. HTTPS same-origin delivery is the authority. */
export async function verifyFirmwareReleases(file: unknown, options: ReleasesVerifyOptions): Promise<ReleasesVerdict> {
  if (options.environment === null) return { ok: false, rejection: 'no-environment' };
  const now = options.now.getTime();
  if (!Number.isFinite(now)) return { ok: false, rejection: 'invalid-clock' };
  if (!isRecord(file) || file['format'] !== FIRMWARE_RELEASES_FORMAT || !Array.isArray(file['releases']) || file['releases'].length > 5) return { ok: false, rejection: 'malformed' };
  const releases: FirmwareRelease[] = [];
  for (const value of file['releases']) {
    const release = readRelease(value, releases.length === 0);
    if (release === null || releases.some(r => r.tag === release.tag || r.file === release.file)) return { ok: false, rejection: 'malformed' };
    releases.push(release);
  }
  return { ok: true, releases: { env: options.environment, issuedMs: now, expiresMs: now + 600000, boards: [{ hv: 8, minimumFb: 450.01, releases }, ...(options.environment === 'staging' ? [SIMULATOR_RELEASES] : [])] } };
}
/** The releases for a board's hardware version, or null when the list names none. */
export function releasesForHardware(releases: FirmwareReleases | null, hv: number | null | undefined): HardwareReleases | null {
  if (releases === null || typeof hv !== 'number') return null;
  return releases.boards.find((b) => b.hv === hv) ?? null;
}

/**
 * The old-firmware gate (WORKSPACE_FEATURES "Minimum firmware gate"): true
 * when the list names a minimum for this hardware and the board's build is
 * below it. Unknown values are not "below": they leave the board as its
 * classification decides.
 */
export function belowMinimum(releases: FirmwareReleases | null, hv: number | null | undefined, fb: number | null | undefined): { readonly below: boolean; readonly minimumFb: number | null } {
  const hw = releasesForHardware(releases, hv);
  const minimumFb = hw?.minimumFb ?? null;
  if (minimumFb === null || typeof fb !== 'number' || !Number.isFinite(fb)) return { below: false, minimumFb };
  // Builds are compared to the hundredth they are printed with (450.01).
  return { below: Math.round(fb * 100) < Math.round(minimumFb * 100), minimumFb };
}

/**
 * The same-origin path the page fetches a listed image from: a GitHub-released
 * image through the Worker's proxy (`/firmware/<owner>/<name>/<tag>/<file>`,
 * OD-10), a simulator image from `/firmware/sim/`, anything else from
 * `/firmware/` (a file the site bundles). Never another origin: the page's
 * CSP is `connect-src 'self'`.
 */
export function releasePath(release: Pick<FirmwareRelease, 'file' | 'simulatorOnly' | 'repo' | 'tag'>): string {
  if (release.repo !== null && release.tag !== null) return `/firmware/${release.repo}/${release.tag}/${release.file}`;
  return `/firmware/${release.simulatorOnly ? 'sim/' : ''}${release.file}`;
}
