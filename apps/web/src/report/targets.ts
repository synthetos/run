/**
 * Where a problem report can go (docs/design/REPORT_A_PROBLEM.md §3, §6).
 *
 * This is the one allowlist of report destinations. Each entry is a fixed
 * URL; nothing the user types or the board reports ever becomes part of a
 * host or a path. The only variable parts are the query values, and they
 * are built with `encodeURIComponent` alone (`issueUrl`).
 *
 * The bundle scan (tools/gates/src/bundle/scan.ts) refuses every origin
 * literal in a JavaScript chunk except the exact URLs in `REPORT_URLS`,
 * which it imports from here. Adding or changing a URL here is a reviewed
 * change to what the scan allows (CODEOWNERS owns this file).
 *
 * Nothing here fetches anything. A destination is only ever the `href` of a
 * link the user clicks, opened in a new tab with `noopener` (Tenet 1: the
 * workspace never navigates away).
 */

/** The issue trackers, keyed by what the user picks. URLs only: no host is ever assembled. */
export const REPORT_TARGETS = Object.freeze({
  run: Object.freeze({ id: 'run', label: 'synthetos/run', kind: 'issues', url: 'https://github.com/synthetos/run/issues/new' }),
  tinyg: Object.freeze({ id: 'tinyg', label: 'synthetos/TinyG', kind: 'issues', url: 'https://github.com/synthetos/TinyG/issues/new' }),
  g2core: Object.freeze({ id: 'g2core', label: 'synthetos/g2core', kind: 'issues', url: 'https://github.com/synthetos/g2core/issues/new' }),
  /**
   * The forum's "start a discussion" form. forumbot's `GET new/` takes only `?category=` and `?ref=`
   * (forumbot src/routes/ask.ts), not a title or body, so run opens it plainly and copies the report.
   */
  forum: Object.freeze({ id: 'forum', label: 'the Synthetos forum', kind: 'forum', url: 'https://synthetos.com/forum/new/' }),
} as const);

export type ReportTargetId = keyof typeof REPORT_TARGETS;
export type ReportTarget = (typeof REPORT_TARGETS)[ReportTargetId];

/** Every URL the bundle scan admits in a chunk: exactly these strings, nothing longer. */
export const REPORT_URLS: readonly string[] = Object.freeze(Object.values(REPORT_TARGETS).map((t) => t.url));

/** Which firmware tracker a dialect's problems go to; null when the board was not identified. */
export function firmwareTarget(dialectId: string | null | undefined): 'tinyg' | 'g2core' | null {
  if (typeof dialectId !== 'string') return null;
  if (dialectId.startsWith('tinyg')) return 'tinyg';
  if (dialectId.startsWith('g2core')) return 'g2core';
  return null;
}

/**
 * A pre-filled "new issue" URL: the target's fixed URL plus `title` and `body`, each through
 * `encodeURIComponent`. Throws for anything that is not an issue tracker in the allowlist.
 */
export function issueUrl(target: ReportTargetId, title: string, body: string): string {
  if (!Object.hasOwn(REPORT_TARGETS, target)) throw new Error(`report: ${JSON.stringify(target)} is not a report target`);
  const t = REPORT_TARGETS[target];
  if (t.kind !== 'issues') throw new Error(`report: ${t.id} is not an issue tracker`);
  return `${t.url}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

/** The forum's new-discussion URL (no query: the report goes on the clipboard). */
export function forumUrl(): string {
  return REPORT_TARGETS.forum.url;
}
