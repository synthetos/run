/**
 * The recorded independent review of a safety-path pull request (D40).
 *
 * With a single maintainer no one but the author can approve a PR on GitHub,
 * so the second look SAFETY §8 asks for is recorded as a file in the PR
 * itself: `docs/safety/reviews/pr-<N>.md` (reviewPolicy.ts). The reviewer is
 * independent of the author (D40: an independent review; a person or a
 * separate review agent run outside the author's session). The record reads:
 *
 *     # Independent safety review: PR #<N>
 *
 *     - PR: <N>
 *     - Reviewed commit: <40-hex sha of the commit that was reviewed>
 *     - Reviewer: <who reviewed it; never the PR author>
 *     - Verdict: approve
 *     - Open findings: none
 *
 *     ## Safety paths reviewed
 *
 *     - <every safety-review path the PR touches, one per line>
 *
 *     ## Notes
 *
 *     <free text: what was checked, the findings and how each was resolved>
 *
 * The check binds the record to what merges. GitHub's compare of the reviewed
 * commit with the PR head must show the head strictly AHEAD of the reviewed
 * commit, ending at the head, and changing exactly one file: this record. So
 * the head tree is the reviewed tree plus the record, and any later change
 * (another commit, a merge of main into the branch) needs a new review.
 *
 * What this cannot do: prove who wrote the record. With one maintainer the
 * record is an auditable statement, not an identity check; that is D40's
 * accepted trade-off, and the two-approval rule returns with a second
 * maintainer (reviewPolicy.ts). Dependency-free and pure.
 */

const SHA_RE = /^[0-9a-f]{40}$/;
const FIELDS = ['PR', 'Reviewed commit', 'Reviewer', 'Verdict', 'Open findings'] as const;
type Field = (typeof FIELDS)[number];

export interface ReviewRecord {
  readonly pr: string;
  readonly reviewedCommit: string;
  readonly reviewer: string;
  readonly verdict: string;
  readonly openFindings: string;
  readonly paths: readonly string[];
}

/** Reads the record's fields. Returns problems instead of a record when it cannot be read unambiguously. */
export function parseReviewRecord(text: string): { record?: ReviewRecord; problems: string[] } {
  const problems: string[] = [];
  const values = new Map<Field, string[]>();
  for (const m of text.matchAll(/^- (PR|Reviewed commit|Reviewer|Verdict|Open findings): *(.*?) *$/gm)) {
    const field = m[1] as Field;
    values.set(field, [...(values.get(field) ?? []), m[2] ?? '']);
  }
  for (const field of FIELDS) {
    const found = values.get(field) ?? [];
    if (found.length === 0 || found[0] === '') problems.push(`the review record has no '${field}:' line`);
    else if (found.length > 1) problems.push(`the review record has ${found.length} '${field}:' lines; exactly one is allowed`);
  }
  const start = text.search(/^## Safety paths reviewed *$/m);
  const paths: string[] = [];
  if (start === -1) problems.push("the review record has no '## Safety paths reviewed' section");
  else {
    const rest = text.slice(start).split('\n').slice(1);
    for (const line of rest) {
      if (/^#{1,2} /.test(line)) break;
      const m = /^- (\S+) *$/.exec(line);
      if (m) paths.push((m[1] ?? '').replace(/^\//, '').replace(/^`|`$/g, ''));
    }
  }
  if (problems.length > 0) return { problems };
  const one = (f: Field): string => (values.get(f) ?? [''])[0] ?? '';
  return {
    record: { pr: one('PR'), reviewedCommit: one('Reviewed commit'), reviewer: one('Reviewer'), verdict: one('Verdict'), openFindings: one('Open findings'), paths },
    problems,
  };
}

export interface RecordFacts {
  /** The pull request number. */
  readonly prNumber: number;
  /** The record's repository path (reviewRecordPath(prNumber)). */
  readonly recordPath: string;
  readonly author: string;
  readonly headSha: string;
  /** The safety-review paths the PR touches. */
  readonly safetyPaths: readonly string[];
  /** The record's text at the PR head, or undefined when the PR has none. */
  readonly record: string | undefined;
  /** GitHub's answer to GET /repos/{o}/{r}/compare/{reviewed}...{head}, or undefined when it was not fetched. */
  readonly compare: unknown;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Problems with the PR's independent review record; empty when it is present, complete and bound to the head. */
export function checkReviewRecord(facts: RecordFacts): string[] {
  if (facts.record === undefined || facts.record.trim() === '') {
    return [`no independent review record: commit ${facts.recordPath} to this PR (D40, docs/ops/branch-protection.md)`];
  }
  const { record, problems } = parseReviewRecord(facts.record);
  if (record === undefined) return problems;
  if (record.pr !== String(facts.prNumber) && record.pr !== `#${facts.prNumber}`) {
    problems.push(`the review record is for PR ${record.pr}, not PR ${facts.prNumber}`);
  }
  if (record.verdict.toLowerCase() !== 'approve') problems.push(`the review record's verdict is '${record.verdict}', not 'approve'`);
  if (record.openFindings.toLowerCase() !== 'none') problems.push(`the review record lists open findings ('${record.openFindings}'); resolve them and review again`);
  // The author's login anywhere in the field as a whole word ("owner (self-review)",
  // "`owner`", "agent, @owner") is the author reviewing; GitHub logins are [A-Za-z0-9-].
  const reviewerWords = record.reviewer.toLowerCase().split(/[^a-z0-9-]+/);
  if (reviewerWords.includes(facts.author.toLowerCase())) problems.push('the review record names the PR author as the reviewer; the review must be independent of the author');
  const missing = facts.safetyPaths.filter((p) => p !== facts.recordPath && !record.paths.includes(p));
  if (missing.length > 0) problems.push(`safety paths the review record does not list as reviewed: ${missing.join(', ')}`);
  if (!SHA_RE.test(record.reviewedCommit)) {
    problems.push("the review record's 'Reviewed commit' is not a 40-character commit sha");
    return problems;
  }
  problems.push(...checkBinding(record.reviewedCommit, facts));
  return problems;
}

/** The head must be the reviewed commit plus commits that change only the record. */
function checkBinding(reviewed: string, facts: RecordFacts): string[] {
  const c = facts.compare;
  const unbound = (why: string): string[] => [`the review record is not bound to the head commit: ${why}`];
  if (!isObject(c)) return unbound(`no comparison of ${reviewed} with the head was available`);
  const baseCommit = isObject(c['base_commit']) ? c['base_commit']['sha'] : undefined;
  if (baseCommit !== reviewed) return unbound('the comparison is not from the reviewed commit');
  if (c['status'] !== 'ahead' || c['behind_by'] !== 0) {
    return unbound(`the head is not strictly ahead of the reviewed commit ${reviewed} (status ${JSON.stringify(c['status'])}); review the current head`);
  }
  const commits = c['commits'];
  if (!Array.isArray(commits) || commits.length === 0 || c['total_commits'] !== commits.length) {
    return unbound('the comparison does not list every commit after the reviewed one');
  }
  const last = commits[commits.length - 1] as unknown;
  if (!isObject(last) || last['sha'] !== facts.headSha) return unbound('the comparison does not end at the head commit');
  const files = c['files'];
  if (!Array.isArray(files)) return unbound('the comparison lists no files');
  const changed = new Set<string>();
  for (const f of files as unknown[]) {
    if (!isObject(f) || typeof f['filename'] !== 'string') return unbound('the comparison lists a file without a name');
    changed.add(f['filename']);
    if (typeof f['previous_filename'] === 'string') changed.add(f['previous_filename']);
  }
  const others = [...changed].filter((name) => name !== facts.recordPath).sort();
  if (others.length > 0) {
    return unbound(`files changed after the reviewed commit ${reviewed}: ${others.join(', ')}; review the current head and record that commit`);
  }
  if (!changed.has(facts.recordPath)) return unbound('the record itself was not added after the reviewed commit');
  return [];
}
