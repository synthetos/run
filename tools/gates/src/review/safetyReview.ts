/**
 * The `safety-review` pull-request check (ROADMAP P0-03, SAFETY §8).
 *
 * When a PR touches a safety-review path (shared/safetyPaths.ts), it passes
 * only if:
 * - the PR description carries the SAFETY §8 checklist from the PR template
 *   with every item, 1 to 40, ticked; and
 * - at least `REQUIRED_SAFETY_APPROVALS` distinct reviewers other than the
 *   author have approved the PR's head commit, counting each reviewer's
 *   latest decisive review (a later "changes requested" or a dismissal
 *   cancels an approval; plain comments do not count either way), and only
 *   reviewers with write access to the repository (author_association
 *   OWNER, MEMBER or COLLABORATOR). The repository is public: anyone with a
 *   GitHub account can submit an "approving" review.
 *
 * A PR that touches no such path passes; branch protection's single
 * required review applies to it. Owner review of the CODEOWNERS paths is
 * enforced by GitHub itself ("Require review from Code Owners").
 *
 * Dependency-free and pure: the CLI feeds it the GitHub API's answers.
 */
import { matches } from '../shared/glob.ts';
import { SAFETY_REVIEW_PATHS } from '../shared/safetyPaths.ts';

export const REQUIRED_SAFETY_APPROVALS = 2;

/** GitHub `author_association` values of people who hold write access, whose approvals count. */
export const TRUSTED_ASSOCIATIONS: readonly string[] = ['OWNER', 'MEMBER', 'COLLABORATOR'];

/** Item numbers of the SAFETY §8 checklist (OLD-S 1–21 plus SAFETY 22–40). */
export const CHECKLIST_ITEMS: readonly number[] = Array.from({ length: 40 }, (_, i) => i + 1);

export interface Review {
  readonly user: string;
  /** GitHub review state: APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING. */
  readonly state: string;
  readonly commitId: string;
  /** GitHub author_association of the reviewer (OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE, ...). */
  readonly association: string;
  /** ISO timestamp; reviews are ordered by it. */
  readonly submittedAt: string;
}

export interface PullRequestFacts {
  readonly author: string;
  readonly headSha: string;
  readonly body: string;
  /** Every changed path, including the old path of a rename. */
  readonly changedFiles: readonly string[];
  readonly reviews: readonly Review[];
}

export interface SafetyReviewResult {
  readonly safetyPaths: readonly string[];
  readonly approvers: readonly string[];
  readonly problems: readonly string[];
}

export function touchedSafetyPaths(files: readonly string[], patterns: readonly string[] = SAFETY_REVIEW_PATHS): string[] {
  return files.filter((file) => patterns.some((pattern) => matches(pattern, file))).sort();
}

/** Checklist item numbers in `body`, split into ticked and unticked. */
export function checklistState(body: string): { ticked: Set<number>; unticked: Set<number> } {
  const ticked = new Set<number>();
  const unticked = new Set<number>();
  for (const match of body.matchAll(/^\s*[-*] \[([ xX])\] (\d+)\. /gm)) {
    const n = Number(match[2]);
    if (match[1] === ' ') unticked.add(n);
    else ticked.add(n);
  }
  return { ticked, unticked };
}

/** Reviewers (not the author, with write access) whose latest decisive review approves `headSha`. */
export function approversOfHead(reviews: readonly Review[], author: string, headSha: string): string[] {
  const latest = new Map<string, Review>();
  const ordered = [...reviews].sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : 0));
  for (const review of ordered) {
    if (review.user.toLowerCase() === author.toLowerCase()) continue;
    if (review.state === 'COMMENTED' || review.state === 'PENDING') continue;
    latest.set(review.user.toLowerCase(), review);
  }
  return [...latest.values()]
    .filter((r) => r.state === 'APPROVED' && r.commitId === headSha && TRUSTED_ASSOCIATIONS.includes(r.association))
    .map((r) => r.user)
    .sort();
}

export function evaluateSafetyReview(pr: PullRequestFacts): SafetyReviewResult {
  const safetyPaths = touchedSafetyPaths(pr.changedFiles);
  const approvers = approversOfHead(pr.reviews, pr.author, pr.headSha);
  if (safetyPaths.length === 0) return { safetyPaths, approvers, problems: [] };

  const problems: string[] = [];
  const { ticked, unticked } = checklistState(pr.body);
  const missing = CHECKLIST_ITEMS.filter((n) => !ticked.has(n) && !unticked.has(n));
  const open = CHECKLIST_ITEMS.filter((n) => unticked.has(n) && !ticked.has(n));
  if (missing.length === CHECKLIST_ITEMS.length) {
    problems.push('the PR description has no SAFETY §8 checklist; copy it from .github/pull_request_template.md');
  } else {
    if (missing.length > 0) problems.push(`checklist items missing from the description: ${missing.join(', ')}`);
    if (open.length > 0) problems.push(`checklist items not ticked: ${open.join(', ')}`);
  }
  if (approvers.length < REQUIRED_SAFETY_APPROVALS) {
    problems.push(
      `${approvers.length} approval(s) of the head commit from reviewers other than the author; ` +
        `${REQUIRED_SAFETY_APPROVALS} are required for safety-review paths`,
    );
  }
  return { safetyPaths, approvers, problems };
}
