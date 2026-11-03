/**
 * The signed firmware release list (SAFETY §4.8 as amended 2026-11-03, H22,
 * H86; WORKSPACE_FEATURES "Firmware update").
 *
 * `firmware/releases.json` lists, per hardware version (`hv`), the firmware
 * images the update panel offers: build (`fb`), version (`fv`), the SHA-256
 * and size of the exact `.hex` file, a changelog and its date, which one is
 * recommended, and the minimum build a board of that hardware should run
 * (the old-firmware gate). Like the approved-builds manifest and the safety
 * advisory it is a per-environment signed data file: one entry per
 * environment, its payload a JSON string signed with Ed25519 over
 * `FIRMWARE_RELEASES_SIGNING_PREFIX + payload` by a compiled-in release key
 * authorised for that environment, and the payload names the same
 * environment and carries an issue and expiry time.
 *
 * - Staging is signed with the owner's bench key (staging only).
 * - Production has no entry until the owner signs one with the offline
 *   release key, so production offers no firmware (fail closed).
 *
 * A release marked `simulatorOnly` is an image for the test kit's simulated
 * board (fake-serial builds); the machine worker refuses to flash it to
 * anything but a simulated port, whatever the page says (H86).
 *
 * The hex itself comes from GitHub Releases (OD-10, docs/ops/
 * firmware-releases.md): an entry naming `repo` and `tag` is the release
 * asset `file` of that release, which the page fetches from its own origin
 * through run's Worker (`/firmware/<repo>/<tag>/<file>`, `releasePath`);
 * an entry without them is a file the site bundles. The page may also read
 * a local file the user chooses. Either way its SHA-256 and size must equal
 * the entry before anything is parsed or flashed.
 *
 * Verification never throws: anything malformed, unsigned, expired or for
 * another environment offers nothing.
 */
import type { DialectId } from './dialects/types.ts';
import { RELEASE_KEYS } from './releaseKeys.ts';
import type { ReleaseKey } from './releaseKeys.ts';
import { clockMs, hasOnlyKeys, isRecord, parseJson, parseTime, verifyEd25519 } from './signed.ts';

export const FIRMWARE_RELEASES_FORMAT = 'synthetos-run/firmware-releases@1';
export const FIRMWARE_RELEASES_PAYLOAD_FORMAT = 'synthetos-run/firmware-releases-env@1';
/** Prefixed to the payload before signing; differs from the other signed files', so no signature replays as another's. */
export const FIRMWARE_RELEASES_SIGNING_PREFIX = 'synthetos-run firmware-releases v1\n';

export type ReleasesEnvironment = 'staging' | 'production';

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

export type ReleasesRejection =
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

export type ReleasesVerdict = { readonly ok: true; readonly releases: FirmwareReleases } | { readonly ok: false; readonly rejection: ReleasesRejection };

export interface ReleasesVerifyOptions {
  readonly environment: ReleasesEnvironment | null;
  readonly now: Date;
  /** Tests only: other trusted keys. */
  readonly keys?: readonly ReleaseKey[];
}

const ENTRY_KEYS: readonly string[] = ['env', 'kid', 'payload', 'sig'];
const PAYLOAD_KEYS: readonly string[] = ['format', 'env', 'issued', 'expires', 'boards'];
const BOARD_KEYS: readonly string[] = ['hv', 'minimumFb', 'releases'];
const RELEASE_KEYS_ALLOWED: readonly string[] = ['fb', 'fv', 'dialect', 'part', 'file', 'sha256', 'size', 'date', 'changelog', 'recommended', 'simulatorOnly', 'repo', 'tag'];
const FLASHABLE_DIALECTS: readonly DialectId[] = ['tinyg-en', 'tinyg-440'];
/**
 * The GitHub repositories whose release assets a listed release may come from
 * (OD-10). The Worker proxies assets of these repositories only
 * (workers/run/src/firmwareProxy.ts keeps the same list; a gate test holds
 * the two equal). Widening it is a reviewed change.
 */
export const FIRMWARE_RELEASE_REPOSITORIES: readonly string[] = Object.freeze(['synthetos/TinyG', 'synthetos/tg-xboot']);
/** A release tag as the Worker's route accepts it (`440.21`, `v2.0.0`): one path segment, no dots-only names. */
export const FIRMWARE_RELEASE_TAG_RE = /^(?!\.+$)[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** The largest `.hex` an entry may name (a full 192 KB image is about 540 KB of text). */
export const MAX_RELEASE_HEX_BYTES = 2 * 1024 * 1024;
const MAX_CHANGELOG = 4000;

function reject(rejection: ReleasesRejection): ReleasesVerdict {
  return Object.freeze({ ok: false, rejection });
}

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

function isDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return parseTime(`${v}T00:00:00Z`) !== undefined;
}

function readRelease(r: unknown, hv: number): FirmwareRelease | undefined {
  if (!isRecord(r) || !hasOnlyKeys(r, RELEASE_KEYS_ALLOWED)) return undefined;
  const { fb, fv, dialect, part, file, sha256, size, date, changelog, recommended, simulatorOnly, repo, tag } = r;
  if (!positive(fb) || !positive(fv)) return undefined;
  if (typeof dialect !== 'string' || !FLASHABLE_DIALECTS.includes(dialect as DialectId)) return undefined;
  if (part !== 'x192a3') return undefined;
  if (typeof file !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.hex$/.test(file)) return undefined;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return undefined;
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > MAX_RELEASE_HEX_BYTES) return undefined;
  if (!isDate(date)) return undefined;
  if (typeof changelog !== 'string' || changelog.length > MAX_CHANGELOG) return undefined;
  if (typeof recommended !== 'boolean') return undefined;
  if (simulatorOnly !== undefined && typeof simulatorOnly !== 'boolean') return undefined;
  // A GitHub-released image names both its repository and its tag; a bundled or simulator image names neither.
  if ((repo === undefined) !== (tag === undefined)) return undefined;
  if (repo !== undefined && (typeof repo !== 'string' || !FIRMWARE_RELEASE_REPOSITORIES.includes(repo))) return undefined;
  if (tag !== undefined && (typeof tag !== 'string' || !FIRMWARE_RELEASE_TAG_RE.test(tag))) return undefined;
  if (repo !== undefined && simulatorOnly === true) return undefined;
  return Object.freeze({ hv, fb, fv, dialect: dialect as DialectId, part: 'x192a3', file, sha256, size, date, changelog, recommended, simulatorOnly: simulatorOnly === true, repo: (repo as string | undefined) ?? null, tag: (tag as string | undefined) ?? null });
}

function readBoard(b: unknown): HardwareReleases | undefined {
  if (!isRecord(b) || !hasOnlyKeys(b, BOARD_KEYS)) return undefined;
  const { hv, minimumFb, releases } = b;
  if (!positive(hv)) return undefined;
  if (minimumFb !== null && !positive(minimumFb)) return undefined;
  if (!Array.isArray(releases)) return undefined;
  const out: FirmwareRelease[] = [];
  for (const r of releases) {
    const release = readRelease(r, hv);
    if (release === undefined) return undefined;
    // One entry per image: a second with the same build and file would be ambiguous.
    if (out.some((o) => o.file === release.file || (o.fb === release.fb && o.simulatorOnly === release.simulatorOnly))) return undefined;
    out.push(release);
  }
  // At most one recommended release per hardware.
  if (out.filter((r) => r.recommended).length > 1) return undefined;
  out.sort((a, z) => z.fb - a.fb);
  return Object.freeze({ hv, minimumFb: minimumFb as number | null, releases: Object.freeze(out) });
}

/** Verify the release list for one environment. Never throws. */
export async function verifyFirmwareReleases(file: unknown, options: ReleasesVerifyOptions): Promise<ReleasesVerdict> {
  const { environment } = options;
  if (environment !== 'staging' && environment !== 'production') return reject('no-environment');
  const nowMs = clockMs(options.now);
  if (nowMs === undefined) return reject('invalid-clock');
  if (!isRecord(file) || file['format'] !== FIRMWARE_RELEASES_FORMAT || !hasOnlyKeys(file, ['format', 'manifests'])) return reject('malformed');
  const entries = file['manifests'];
  if (!Array.isArray(entries)) return reject('malformed');
  const mine = entries.filter((e) => isRecord(e) && e['env'] === environment);
  if (mine.length === 0) return reject('no-entry');
  if (mine.length > 1) return reject('duplicate-entry');
  const entry = mine[0] as Record<string, unknown>;
  if (!hasOnlyKeys(entry, ENTRY_KEYS)) return reject('malformed');
  const { kid, payload, sig } = entry;
  if (typeof kid !== 'string' || typeof payload !== 'string' || typeof sig !== 'string') return reject('malformed');
  const key = (options.keys ?? RELEASE_KEYS).find((k) => k.kid === kid);
  if (key === undefined) return reject('unknown-key');
  if (!key.environments.includes(environment)) return reject('key-not-authorised-for-environment');
  if (!(await verifyEd25519(key.publicKey, sig, FIRMWARE_RELEASES_SIGNING_PREFIX + payload))) return reject('bad-signature');

  const body = parseJson(payload);
  if (!isRecord(body) || body['format'] !== FIRMWARE_RELEASES_PAYLOAD_FORMAT || !hasOnlyKeys(body, PAYLOAD_KEYS)) return reject('malformed-payload');
  if (body['env'] !== environment) return reject('environment-mismatch');
  const issuedMs = parseTime(body['issued']);
  const expiresMs = parseTime(body['expires']);
  if (issuedMs === undefined || expiresMs === undefined || !(issuedMs < expiresMs)) return reject('malformed-payload');
  const list = body['boards'];
  if (!Array.isArray(list)) return reject('malformed-payload');
  const boards: HardwareReleases[] = [];
  for (const b of list) {
    const board = readBoard(b);
    if (board === undefined || boards.some((x) => x.hv === board.hv)) return reject('malformed-payload');
    boards.push(board);
  }
  if (nowMs < issuedMs) return reject('not-yet-valid');
  if (nowMs >= expiresMs) return reject('expired');
  return Object.freeze({ ok: true, releases: Object.freeze({ env: environment, issuedMs, expiresMs, boards: Object.freeze(boards) }) });
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
