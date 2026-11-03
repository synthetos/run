/**
 * What the safety bar's version chip shows (ROADMAP P0-05: "the app version
 * and SHA"). The values are fixed at build time (build/buildInfo.ts) and
 * reach the page twice: in the prerendered HTML and, for the client, through
 * the `__RUN_BUILD__` constant (src/env.d.ts). Pure.
 */

export interface BuildInfo {
  /** apps/web/package.json `version`. */
  readonly version: string;
  /** The full commit SHA the bundle was built from (40 hex digits), with `-dirty` for an uncommitted tree. */
  readonly sha: string;
  /**
   * When that commit was made (ISO 8601 with its offset, from `git show -s --format=%cI`), so the owner can
   * tell at a glance whether an open bench tab is the current build. It is the commit's time, not the
   * build's, so two builds of one commit stay byte-identical (bench:check). Absent when the SHA came from
   * the environment rather than a checkout.
   */
  readonly committedAt?: string;
}

const SHA = /^[0-9a-f]{40}(-dirty)?$/;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const COMMITTED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Throws unless the build info is well formed; a chip must never show a wrong or empty version. */
export function checkBuildInfo(info: BuildInfo): BuildInfo {
  if (!VERSION.test(info.version)) throw new Error(`build info: version ${JSON.stringify(info.version)} is not a semantic version`);
  if (!SHA.test(info.sha)) throw new Error(`build info: sha ${JSON.stringify(info.sha)} is not a 40-digit commit SHA`);
  if (info.committedAt !== undefined && !COMMITTED_AT.test(info.committedAt)) {
    throw new Error(`build info: committedAt ${JSON.stringify(info.committedAt)} is not an ISO 8601 timestamp`);
  }
  return info;
}

/** The commit time as shown on the chip: `YYYY-MM-DD HH:MM` in the commit's own offset. */
export function committedLabel(committedAt: string): string {
  return `${committedAt.slice(0, 10)} ${committedAt.slice(11, 16)}`;
}

/** The short form shown on the chip: the first 12 hex digits, plus `-dirty` when applicable. */
export function shortSha(sha: string): string {
  return sha.slice(0, 12) + (sha.endsWith('-dirty') ? '-dirty' : '');
}

/** The chip text, for example `v0.0.0 · 4a49691a2b3c · 2026-11-03 10:48` (the commit time is omitted when unknown). */
export function versionLabel(info: BuildInfo): string {
  const base = `v${info.version} · ${shortSha(info.sha)}`;
  return info.committedAt === undefined ? base : `${base} · ${committedLabel(info.committedAt)}`;
}
