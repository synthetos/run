/**
 * The review policy the `safety-review` check enforces (ROADMAP P0-03,
 * SAFETY §8, DECISIONS D40).
 *
 * D40 (owner, 2026-11-01): the owner is the only maintainer for now. GitHub
 * never lets authors approve their own pull requests, so a rule that needs
 * approvals from someone other than the author would block every safety-path
 * PR. While there is one maintainer:
 * - the number of approvals the check requires is zero;
 * - every safety-path PR instead carries a recorded independent review
 *   (reviewRecord.ts), committed in the PR as `docs/safety/reviews/pr-<N>.md`
 *   and bound to the PR's head tree;
 * - the required status checks, the signed and attested artifact, the
 *   protected `production` environment and CODEOWNERS do the rest
 *   (docs/ops/branch-protection.md).
 *
 * WHEN A SECOND MAINTAINER JOINS: change the one line below to 2. Nothing
 * else in this repository changes; the ruleset change on GitHub is listed in
 * docs/ops/branch-protection.md §1 ("When a second maintainer joins").
 * tools/gates/test/review-policy.test.ts keeps this a single line.
 */
export const REQUIRED_SAFETY_APPROVALS: number = 0;

/** Where a PR's independent review record lives, relative to the repository root. */
export const REVIEW_RECORD_DIR = 'docs/safety/reviews/';

/** The record path for pull request `pr` (a positive integer). */
export function reviewRecordPath(pr: number): string {
  if (!Number.isSafeInteger(pr) || pr < 1) throw new Error(`not a pull request number: ${String(pr)}`);
  return `${REVIEW_RECORD_DIR}pr-${pr}.md`;
}
