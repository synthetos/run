/**
 * D40 (owner, 2026-11-01): a single maintainer, so the safety-review check
 * requires zero approvals (GitHub never lets authors approve their own PRs)
 * and instead requires a recorded independent review, bound to the head
 * tree, on every safety-path PR. Restoring the two-approval rule when a
 * second maintainer joins is a one-line change in reviewPolicy.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUIRED_SAFETY_APPROVALS, REVIEW_RECORD_DIR, reviewRecordPath } from '../src/review/reviewPolicy.ts';
import { checkReviewRecord, parseReviewRecord, type RecordFacts } from '../src/review/reviewRecord.ts';
import { evaluateSafetyReview, parsePermissions, type PullRequestFacts, type Review, touchedSafetyPaths } from '../src/review/safetyReview.ts';
import { compare, PR_NUMBER, RECORD_PATH, record, REVIEWED } from './reviewRecordFixture.ts';
import { REPO_ROOT, ScratchRepo } from './scratch.ts';

const TEMPLATE = readFileSync(join(REPO_ROOT, '.github/pull_request_template.md'), 'utf8');
const TICKED = TEMPLATE.replace(/^- \[ \] /gm, '- [x] ');
const HEAD = 'a'.repeat(40);
const POLICY_FILE = 'tools/gates/src/review/reviewPolicy.ts';
const POLICY_LINE = /^export const REQUIRED_SAFETY_APPROVALS: number = (\d+);$/gm;
const SOLE = { requiredApprovals: 0 };
const TWO = { requiredApprovals: 2 };
const SAFETY_FILES = ['packages/safety/src/index.ts', '.github/workflows/safety-review.yml'];

const approve = (user: string): Review => ({ user, state: 'APPROVED', commitId: HEAD, association: 'MEMBER', submittedAt: '2026-11-01T10:00:00Z' });

/** The owner's own safety-path PR: nobody else can approve it. */
function solePr(overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return {
    author: 'owner',
    headSha: HEAD,
    body: TICKED,
    changedFiles: [...SAFETY_FILES, RECORD_PATH],
    reviews: [approve('owner')],
    permissions: parsePermissions([{ permission: 'admin', user: { login: 'owner', type: 'User', permissions: { push: true } } }]),
    prNumber: PR_NUMBER,
    reviewRecord: record(SAFETY_FILES),
    recordCompare: compare(HEAD),
    ...overrides,
  };
}

function facts(overrides: Partial<RecordFacts> = {}): RecordFacts {
  return { prNumber: PR_NUMBER, recordPath: RECORD_PATH, author: 'owner', headSha: HEAD, safetyPaths: SAFETY_FILES, record: record(SAFETY_FILES), compare: compare(HEAD), ...overrides };
}

describe('the committed policy (D40)', () => {
  it('is a single line, and is either the sole-maintainer value (0) or the two-maintainer value (2)', () => {
    const source = readFileSync(join(REPO_ROOT, POLICY_FILE), 'utf8');
    const lines = [...source.matchAll(POLICY_LINE)];
    expect(lines).toHaveLength(1);
    expect(Number(lines[0]?.[1])).toBe(REQUIRED_SAFETY_APPROVALS);
    expect([0, 2]).toContain(REQUIRED_SAFETY_APPROVALS);
    // The count is not set anywhere else in the gate code.
    expect(readFileSync(join(REPO_ROOT, 'tools/gates/src/review/safetyReview.ts'), 'utf8')).not.toMatch(/REQUIRED_SAFETY_APPROVALS\s*=/);
    expect(readFileSync(join(REPO_ROOT, 'tools/gates/src/review/cli.ts'), 'utf8')).not.toMatch(/requiredApprovals/);
  });

  it('names one record path per PR, under docs/safety/reviews/', () => {
    expect(reviewRecordPath(42)).toBe(`${REVIEW_RECORD_DIR}pr-42.md`);
    expect(() => reviewRecordPath(0)).toThrow();
    expect(() => reviewRecordPath(1.5)).toThrow();
  });

  it('the record directory is not itself a safety path (adding a record does not need a record)', () => {
    expect(touchedSafetyPaths([RECORD_PATH])).toEqual([]);
  });
});

describe('the sole maintainer is not blocked', () => {
  it("the owner's own safety-path PR with no approval but the checklist and a bound independent review passes", () => {
    const result = evaluateSafetyReview(solePr(), SOLE);
    expect(result.problems).toEqual([]);
    expect(result.approvers).toEqual([]);
  });

  it('the same PR still fails the two-maintainer rule, which counts no self-approval', () => {
    expect(evaluateSafetyReview(solePr(), TWO).problems).toEqual([
      '0 approval(s) of the head commit from reviewers other than the author with write access to this repository; 2 are required for safety-review paths',
    ]);
  });

  it('the checklist is still required', () => {
    expect(evaluateSafetyReview(solePr({ body: 'Small fix.' }), SOLE).problems).toEqual([
      'the PR description has no SAFETY §8 checklist; copy it from .github/pull_request_template.md',
    ]);
  });

  it('a PR that changes its own enforcement workflow without a record fails', () => {
    const problems = evaluateSafetyReview(solePr({ changedFiles: ['.github/workflows/safety-review.yml'], reviewRecord: undefined }), SOLE).problems;
    expect(problems).toEqual([`no independent review record: commit ${RECORD_PATH} to this PR (D40, docs/ops/branch-protection.md)`]);
  });

  it('the record is required under the two-maintainer rule too', () => {
    const problems = evaluateSafetyReview(solePr({ reviews: [approve('bob'), approve('carol')], permissions: parsePermissions(['bob', 'carol'].map((login) => ({ permission: 'write', user: { login } }))), reviewRecord: '' }), TWO).problems;
    expect(problems).toEqual([`no independent review record: commit ${RECORD_PATH} to this PR (D40, docs/ops/branch-protection.md)`]);
  });

  it('a PR touching no safety path needs neither a record nor approvals', () => {
    expect(evaluateSafetyReview(solePr({ changedFiles: ['README.md'], body: '', reviewRecord: undefined, recordCompare: undefined }), SOLE).problems).toEqual([]);
  });

  it('refuses a negative or fractional approval count', () => {
    expect(() => evaluateSafetyReview(solePr(), { requiredApprovals: -1 })).toThrow();
    expect(() => evaluateSafetyReview(solePr(), { requiredApprovals: 0.5 })).toThrow();
  });
});

describe('the review record', () => {
  it('a complete, approving, bound record has no problems', () => {
    expect(checkReviewRecord(facts())).toEqual([]);
  });

  it('accepts "#42" for the PR and a leading slash on paths', () => {
    expect(checkReviewRecord(facts({ record: record(SAFETY_FILES.map((p) => `/${p}`), { pr: `#${PR_NUMBER}` }) }))).toEqual([]);
  });

  it.each([
    ['another PR', { pr: '41' }, 'the review record is for PR 41, not PR 42'],
    ['a verdict other than approve', { verdict: 'request changes' }, "the review record's verdict is 'request changes', not 'approve'"],
    ['open findings', { open: '2 (MEDIUM)' }, "the review record lists open findings ('2 (MEDIUM)'); resolve them and review again"],
    ['the author as reviewer', { reviewer: '@Owner' }, 'the review record names the PR author as the reviewer; the review must be independent of the author'],
    ['the author with a note', { reviewer: 'owner (self-review)' }, 'the review record names the PR author as the reviewer; the review must be independent of the author'],
    ['the author in backticks', { reviewer: '`owner`' }, 'the review record names the PR author as the reviewer; the review must be independent of the author'],
    ['the author among others', { reviewer: 'second-agent, @owner' }, 'the review record names the PR author as the reviewer; the review must be independent of the author'],
    ['a short commit', { commit: 'abc123' }, "the review record's 'Reviewed commit' is not a 40-character commit sha"],
  ])('refuses %s', (_name, overrides, problem) => {
    expect(checkReviewRecord(facts({ record: record(SAFETY_FILES, overrides) }))).toContain(problem);
  });

  it('refuses a record that does not list every safety path the PR touches', () => {
    expect(checkReviewRecord(facts({ record: record(['packages/safety/src/index.ts']) }))).toEqual([
      'safety paths the review record does not list as reviewed: .github/workflows/safety-review.yml',
    ]);
  });

  it('refuses a record with a missing or repeated field, or no paths section', () => {
    expect(checkReviewRecord(facts({ record: record(SAFETY_FILES).replace(/^- Reviewer: .*\n/m, '') }))).toEqual(["the review record has no 'Reviewer:' line"]);
    expect(checkReviewRecord(facts({ record: record(SAFETY_FILES).replace('- Verdict: approve', '- Verdict: approve\n- Verdict: reject') }))).toEqual([
      "the review record has 2 'Verdict:' lines; exactly one is allowed",
    ]);
    expect(checkReviewRecord(facts({ record: record(SAFETY_FILES).replace('## Safety paths reviewed', '## Paths') }))).toEqual([
      "the review record has no '## Safety paths reviewed' section",
    ]);
  });

  it('reads paths only from the paths section', () => {
    const text = record(['packages/safety/src/index.ts']).replace('Checked the change', '- .github/workflows/safety-review.yml\n\nChecked the change');
    expect(parseReviewRecord(text).record?.paths).toEqual(['packages/safety/src/index.ts']);
  });
});

describe('the record is bound to the head tree', () => {
  const unbound = (c: unknown): string[] => checkReviewRecord(facts({ compare: c }));

  it('refuses when there is no comparison', () => {
    expect(unbound(undefined)[0]).toMatch(/not bound to the head commit: no comparison/);
    expect(unbound(null)[0]).toMatch(/not bound to the head commit: no comparison/);
  });

  it('refuses a safety change pushed after the review (the head is the reviewed tree plus more than the record)', () => {
    const later = compare(HEAD, { ahead_by: 2, total_commits: 2, commits: [{ sha: 'd'.repeat(40) }, { sha: HEAD }], files: [{ filename: RECORD_PATH }, { filename: 'packages/safety/src/index.ts' }] });
    expect(unbound(later)).toEqual([
      `the review record is not bound to the head commit: files changed after the reviewed commit ${REVIEWED}: packages/safety/src/index.ts; review the current head and record that commit`,
    ]);
  });

  it('refuses a rename after the review that moves a file away', () => {
    const renamed = compare(HEAD, { files: [{ filename: RECORD_PATH }, { filename: 'docs/x.ts', previous_filename: 'packages/safety/src/index.ts' }] });
    expect(unbound(renamed)[0]).toMatch(/files changed after the reviewed commit .*docs\/x\.ts, packages\/safety\/src\/index\.ts/);
  });

  it('refuses a reviewed commit that is not an ancestor of the head (diverged, behind or identical)', () => {
    for (const status of ['diverged', 'behind', 'identical']) expect(unbound(compare(HEAD, { status }))[0]).toMatch(/not strictly ahead/);
    expect(unbound(compare(HEAD, { behind_by: 1 }))[0]).toMatch(/not strictly ahead/);
  });

  it('refuses a comparison from another commit, one that does not end at the head, or a truncated one', () => {
    expect(unbound(compare(HEAD, { base_commit: { sha: 'e'.repeat(40) } }))[0]).toMatch(/not from the reviewed commit/);
    expect(unbound(compare('f'.repeat(40)))[0]).toMatch(/does not end at the head commit/);
    expect(unbound(compare(HEAD, { total_commits: 300 }))[0]).toMatch(/does not list every commit/);
    expect(unbound(compare(HEAD, { files: undefined }))[0]).toMatch(/lists no files/);
  });

  it('refuses when the record was not added after the reviewed commit', () => {
    expect(unbound(compare(HEAD, { files: [] }))).toEqual(['the review record is not bound to the head commit: the record itself was not added after the reviewed commit']);
  });
});

describe('restoring two approvals is a one-line change', () => {
  it('changing the one line to 2 makes the CLI require two write-access approvals again, with nothing else changed', { timeout: 60_000 }, () => {
    const repo = ScratchRepo.create();
    try {
      const source = readFileSync(join(repo.root, POLICY_FILE), 'utf8');
      const two = source.replace(POLICY_LINE, 'export const REQUIRED_SAFETY_APPROVALS: number = 2;');
      const changed = source.split('\n').filter((line, i) => line !== two.split('\n')[i]);
      expect(changed.length).toBeLessThanOrEqual(1);
      repo.write(POLICY_FILE, two);

      const file = (name: string, content: string): string => {
        const path = join(repo.base, name);
        writeFileSync(path, content);
        return path;
      };
      const review = (login: string): object => ({ user: { login }, state: 'APPROVED', commit_id: HEAD, author_association: 'MEMBER', submitted_at: '2026-11-01T10:00:00Z' });
      const answer = (login: string): object => ({ permission: 'write', role_name: 'write', user: { login, type: 'User', permissions: { push: true } } });
      const args = (reviewers: string[]): string[] => [
        '--files', file('files.json', JSON.stringify([[{ filename: 'packages/safety/src/index.ts' }, { filename: RECORD_PATH }]])),
        '--reviews', file('reviews.json', JSON.stringify([reviewers.map(review)])),
        '--permissions', file('permissions.json', JSON.stringify(reviewers.map(answer))),
        '--body-file', file('body.md', TICKED),
        '--author', 'owner',
        '--head-sha', HEAD,
        '--pr', String(PR_NUMBER),
        '--record', file('record.md', record(['packages/safety/src/index.ts'])),
        '--record-compare', file('compare.json', JSON.stringify(compare(HEAD))),
      ];
      const none = repo.gate('tools/gates/src/review/cli.ts', args([]));
      expect(none.status, none.output).toBe(1);
      expect(none.output).toContain('2 are required for safety-review paths');
      expect(repo.gate('tools/gates/src/review/cli.ts', args(['bob'])).status).toBe(1);
      const both = repo.gate('tools/gates/src/review/cli.ts', args(['bob', 'carol']));
      expect(both.status, both.output).toBe(0);

      // And at 0 (D40) the owner's PR passes with the record alone.
      repo.write(POLICY_FILE, source.replace(POLICY_LINE, 'export const REQUIRED_SAFETY_APPROVALS: number = 0;'));
      const sole = repo.gate('tools/gates/src/review/cli.ts', args([]));
      expect(sole.status, sole.output).toBe(0);
    } finally {
      repo.dispose();
    }
  });
});
