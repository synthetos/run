/** Public TinyG release data. No browser-provided upstream or repository is used. */
export const TINYG_REPO = 'synthetos/TinyG';
export const MAX_GITHUB_HEX_BYTES = 2 * 1024 * 1024;
export interface GithubFirmwareRelease {
  readonly repo: typeof TINYG_REPO;
  readonly tag: string;
  readonly file: string;
  readonly date: string;
  readonly notes: string;
  readonly prerelease: boolean;
  readonly size: number;
  readonly sha256: string | null;
  readonly unavailable: string | null;
}
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const TAG = /^(?!\.+$)[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HEX = /^tinyg-[A-Za-z0-9._-]+\.hex$/;
function integrity(asset: Record<string, unknown>) {
  const digest = asset['digest'], size = asset['size'];
  const sha256 = typeof digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(digest) ? digest.slice(7) : null;
  const validSize = typeof size === 'number' && Number.isSafeInteger(size) && size > 0 && size <= MAX_GITHUB_HEX_BYTES;
  const unavailable = sha256 === null ? 'GitHub did not provide a SHA-256 digest for this release.' : !validSize ? 'This release exceeds the firmware size limit or has an invalid size.' : null;
  return { sha256, size: validSize ? size : 0, unavailable };
}
function readRelease(value: unknown): GithubFirmwareRelease | null {
  if (!record(value) || value['draft'] !== false || !Array.isArray(value['assets'])) return null;
  const assets = value['assets'].filter(a => record(a) && typeof a['name'] === 'string' && HEX.test(a['name']));
  if (assets.length !== 1) return null;
  const asset = assets[0] as Record<string, unknown>;
  const tag = value['tag_name'], date = value['published_at'], notes = value['body'];
  if (typeof tag !== 'string' || !TAG.test(tag) || typeof date !== 'string' || !Number.isFinite(Date.parse(date))) return null;
  if (typeof value['prerelease'] !== 'boolean' || (notes !== null && typeof notes !== 'string')) return null;
  const { sha256, size, unavailable } = integrity(asset);
  return Object.freeze({ repo: TINYG_REPO, tag, file: asset['name'] as string, date, notes: typeof notes === 'string' ? notes.slice(0, 16000) : '', prerelease: value['prerelease'], size, sha256, unavailable });
}
/** The firmware build in `tinyg-<major>.<minor>.hex` as one comparable number; -1 when the name carries none. */
function firmwareRank(file: string): number {
  const m = /^tinyg-(\d{1,4})\.(\d{1,3})\.hex$/.exec(file);
  return m === null ? -1 : Number(m[1]) * 1000 + Number(m[2]);
}
/** Newest firmware first, by the version in the hex name (owner 2026-11-19: old builds uploaded later must not push 450.06 out); then by date. */
function newestFirst(a: GithubFirmwareRelease, b: GithubFirmwareRelease): number {
  return firmwareRank(b.file) - firmwareRank(a.file) || Date.parse(b.date) - Date.parse(a.date);
}
/** Invalid integrity metadata stays visible but can never authorize a download. */
export function latestGithubReleases(value: unknown): readonly GithubFirmwareRelease[] {
  if (!Array.isArray(value)) throw new Error('GitHub returned an invalid release list.');
  const releases = value.map(readRelease).filter((r): r is GithubFirmwareRelease => r !== null);
  releases.sort(newestFirst);
  const unique = releases.filter((r, i) => releases.findIndex(other => other.tag === r.tag) === i);
  return Object.freeze(unique.slice(0, 5));
}
