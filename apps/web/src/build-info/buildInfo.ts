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
}

const SHA = /^[0-9a-f]{40}(-dirty)?$/;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Throws unless the build info is well formed; a chip must never show a wrong or empty version. */
export function checkBuildInfo(info: BuildInfo): BuildInfo {
  if (!VERSION.test(info.version)) throw new Error(`build info: version ${JSON.stringify(info.version)} is not a semantic version`);
  if (!SHA.test(info.sha)) throw new Error(`build info: sha ${JSON.stringify(info.sha)} is not a 40-digit commit SHA`);
  return info;
}

/** The short form shown on the chip: the first 12 hex digits, plus `-dirty` when applicable. */
export function shortSha(sha: string): string {
  return sha.slice(0, 12) + (sha.endsWith('-dirty') ? '-dirty' : '');
}

/** The chip text, for example `v0.0.0 · 4a49691a2b3c`. */
export function versionLabel(info: BuildInfo): string {
  return `v${info.version} · ${shortSha(info.sha)}`;
}
