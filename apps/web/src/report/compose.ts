/**
 * Turns a report into what gets filed (REPORT_A_PROBLEM §5, Phase A):
 *
 * - `issueLink`: the pre-filled "new issue" URL. The user's own words go in
 *   the body; the diagnostics go in a collapsed `<details>` block. The whole
 *   URL is kept under `URL_BUDGET` (about 8 kB): longer diagnostics are cut,
 *   with a note that points at the report files.
 * - `reportMarkdown`: the same report, never cut, for "Copy report" and the
 *   forum.
 *
 * Pure. Every item's text arrives already redacted (collect.ts).
 */
import { issueUrl, type ReportTargetId } from './targets.ts';

/** Most characters a pre-filled issue URL may have (§5: "about 8 kB"). */
export const URL_BUDGET = 8000;
/** Longest title kept. */
export const TITLE_MAX = 200;

export const TRUNCATION_NOTE = 'Truncated: the diagnostics were longer than an issue link can carry (about 8 kB). The full report is in the report files ("Download report files" in run).';

export interface ReportSummary {
  readonly title: string;
  readonly happened: string;
  readonly steps: string;
  readonly expected: string;
}

export interface ComposedItem {
  readonly title: string;
  readonly text: string;
  /** The code fence language (`text`, `json`, `gcode`). */
  readonly fence: string;
  /** A sentence shown above the block, outside the fence. */
  readonly note?: string;
}

export interface ComposeInput {
  readonly summary: ReportSummary;
  readonly items: readonly ComposedItem[];
  /** `v0.0.0 (0123456789ab)`. */
  readonly version: string;
}

function fenceFor(text: string): string {
  let fence = '```';
  while (text.includes(fence)) fence += '`';
  return fence;
}

function block(item: ComposedItem): string {
  const f = fenceFor(item.text);
  return [`#### ${item.title}`, ...(item.note === undefined ? [] : [item.note]), `${f}${item.fence}`, item.text, f].join('\n');
}

/** The title as filed: trimmed, one line, at most TITLE_MAX characters. */
export function issueTitle(summary: ReportSummary): string {
  const t = summary.title.replace(/\s+/g, ' ').trim();
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t;
}

function userPart(s: ReportSummary): string {
  const section = (heading: string, text: string): string => `### ${heading}\n\n${text.trim() === '' ? '_Not given._' : text.trim()}`;
  return [section('What happened', s.happened), section('Steps to reproduce', s.steps), section('What I expected', s.expected)].join('\n\n');
}

function diagnostics(items: readonly ComposedItem[]): string {
  return items.map(block).join('\n\n');
}

function footer(version: string): string {
  return `_Filed from run ${version}. Attachments (G-code, transcript, settings) are in the report files: download them in run and drag them into this issue._`;
}

function wrap(diag: string): string {
  return `<details>\n<summary>Diagnostics from run</summary>\n\n${diag}\n\n</details>`;
}

/** The report as Markdown, never cut (Copy report, the forum). */
export function reportMarkdown(input: ComposeInput): string {
  const parts = [`## ${issueTitle(input.summary) || 'Problem report'}`, userPart(input.summary)];
  if (input.items.length > 0) parts.push(wrap(diagnostics(input.items)));
  parts.push(footer(input.version));
  return parts.join('\n\n');
}

/**
 * Cuts `diag` to `keep` characters on a line boundary and closes any code fence left open, so a cut
 * never swallows the rest of the issue into a code block.
 */
export function cutDiagnostics(diag: string, keep: number): string {
  if (keep >= diag.length) return diag;
  let cut = diag.slice(0, Math.max(0, keep));
  const nl = cut.lastIndexOf('\n');
  if (nl > 0) cut = cut.slice(0, nl);
  const open: string[] = [];
  for (const m of cut.matchAll(/^(`{3,})(\w*)$/gm)) {
    const f = m[1] as string;
    if (open.length > 0 && open.at(-1) === f && (m[2] ?? '') === '') open.pop();
    else open.push(f);
  }
  const closing = open.reverse().map((f) => `\n${f}`).join('');
  return `${cut}\n…${closing}\n\n${TRUNCATION_NOTE}`;
}

export interface IssueLink {
  readonly url: string;
  readonly body: string;
  readonly truncated: boolean;
}

/** The pre-filled issue URL for an issue-tracker target, at most `budget` characters. */
export function issueLink(target: ReportTargetId, input: ComposeInput, budget = URL_BUDGET): IssueLink {
  const title = issueTitle(input.summary);
  const user = userPart(input.summary);
  const foot = footer(input.version);
  const diag = diagnostics(input.items);
  const bodyWith = (d: string | null, u = user): string => [u, ...(d === null ? [] : [wrap(d)]), foot].join('\n\n');
  const full = bodyWith(input.items.length === 0 ? null : diag);
  const fullUrl = issueUrl(target, title, full);
  if (fullUrl.length <= budget) return { url: fullUrl, body: full, truncated: false };
  // Keep as much of the diagnostics as fits: binary search on the kept length.
  let lo = 0;
  let hi = diag.length;
  let best: string | null = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const body = bodyWith(cutDiagnostics(diag, mid));
    if (issueUrl(target, title, body).length <= budget) {
      best = body;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (best !== null) return { url: issueUrl(target, title, best), body: best, truncated: true };
  // Even the user's own text is too long for a link: cut it too, and point at the report files.
  let ulo = 0;
  let uhi = user.length;
  let fallback = bodyWith(TRUNCATION_NOTE, '');
  while (ulo <= uhi) {
    const mid = Math.floor((ulo + uhi) / 2);
    const body = bodyWith(TRUNCATION_NOTE, `${user.slice(0, mid)}…`);
    if (issueUrl(target, title, body).length <= budget) {
      fallback = body;
      ulo = mid + 1;
    } else uhi = mid - 1;
  }
  return { url: issueUrl(target, title, fallback), body: fallback, truncated: true };
}
