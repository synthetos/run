/**
 * The third-party canary (ROADMAP P0-06 acceptance: "A third-party URL in a
 * built page fails the job").
 *
 * The e2e job runs the suite twice: once against the artifact, which must
 * pass, and once against a copy of the artifact's site tree with a
 * third-party URL planted in each built page, which must FAIL, and fail for
 * the right reason: the origin guard must name every planted URL. A canary
 * run that passes, or fails only for some unrelated reason (wrangler did not
 * start, a selector broke), fails the job.
 *
 * Pure functions only; canary-cli.ts does the file and process work.
 */
import { GUARD_PREFIX } from './origin.ts';

/** One planted reference. Hosts are under `.invalid` (RFC 6761): they never resolve. */
export interface Injection {
  /** The built page, relative to the site root. */
  readonly page: string;
  /** Inserted immediately before `before`, which must occur exactly once in the page. */
  readonly before: '</head>' | '</body>';
  readonly html: string;
  /** The URL the guard must report. */
  readonly marker: string;
}

/**
 * One page per kind of reference: a resource the CSP blocks (image,
 * stylesheet, script) and a resource hint that never becomes a request
 * (dns-prefetch, on the 404 page).
 */
export const INJECTIONS: readonly Injection[] = [
  { page: 'index.html', before: '</body>', html: '<img src="https://canary-img.third-party.invalid/pixel.png" alt="">', marker: 'https://canary-img.third-party.invalid/pixel.png' },
  { page: 'safety/index.html', before: '</head>', html: '<link rel="stylesheet" href="https://canary-css.third-party.invalid/style.css">', marker: 'https://canary-css.third-party.invalid/style.css' },
  { page: 'privacy/index.html', before: '</head>', html: '<script src="https://canary-js.third-party.invalid/tag.js"></script>', marker: 'https://canary-js.third-party.invalid/tag.js' },
  { page: '404.html', before: '</head>', html: '<link rel="dns-prefetch" href="https://canary-dns.third-party.invalid/">', marker: 'https://canary-dns.third-party.invalid/' },
];

/** The page with the injection planted. Refuses a page without exactly one anchor. */
export function inject(html: string, injection: Injection): string {
  const first = html.indexOf(injection.before);
  if (first === -1 || html.indexOf(injection.before, first + 1) !== -1) {
    throw new Error(`canary: ${injection.page} must contain ${injection.before} exactly once`);
  }
  return `${html.slice(0, first)}${injection.html}${html.slice(first)}`;
}

interface JsonError {
  readonly message?: string;
}
interface JsonResult {
  readonly status?: string;
  readonly errors?: readonly JsonError[];
  readonly error?: JsonError;
}
interface JsonTest {
  readonly results?: readonly JsonResult[];
}
interface JsonSpec {
  readonly title?: string;
  readonly tests?: readonly JsonTest[];
}
interface JsonSuite {
  readonly specs?: readonly JsonSpec[];
  readonly suites?: readonly JsonSuite[];
}
/** The parts of Playwright's JSON report the canary reads. */
export interface JsonReport {
  readonly suites?: readonly JsonSuite[];
  readonly errors?: readonly JsonError[];
  readonly stats?: { readonly expected?: number; readonly unexpected?: number };
}

function failureMessages(suites: readonly JsonSuite[] | undefined, out: string[]): void {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        for (const r of t.results ?? []) {
          for (const e of r.errors ?? []) if (e.message !== undefined) out.push(e.message);
          if (r.error?.message !== undefined) out.push(r.error.message);
        }
      }
    }
    failureMessages(suite.suites, out);
  }
}

/** ANSI colour sequences (built from the code point so no control character appears in a regex literal). */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export interface CanaryVerdict {
  readonly ok: boolean;
  readonly problems: readonly string[];
}

/**
 * Whether the canary run failed for the right reason. `exitCode` is the
 * Playwright process status.
 */
export function judgeCanary(exitCode: number | null, report: JsonReport, markers: readonly string[]): CanaryVerdict {
  const problems: string[] = [];
  if (exitCode === 0) problems.push('the suite PASSED with third-party URLs planted in the built pages');
  if ((report.errors ?? []).length > 0) {
    problems.push(`the run had global errors, so it did not test the pages: ${(report.errors ?? []).map((e) => e.message ?? '').join(' | ')}`);
  }
  if ((report.stats?.unexpected ?? 0) === 0) problems.push('no test failed');
  const messages: string[] = [];
  failureMessages(report.suites, messages);
  // Playwright colours some messages; compare on plain text.
  const guardMessages = messages.map((m) => m.replace(ANSI, '')).filter((m) => m.includes(GUARD_PREFIX));
  if (guardMessages.length === 0) problems.push(`no failure came from the origin guard ("${GUARD_PREFIX}")`);
  for (const marker of markers) {
    if (!guardMessages.some((m) => m.includes(marker))) problems.push(`the origin guard never reported ${marker}`);
  }
  return { ok: problems.length === 0, problems };
}
