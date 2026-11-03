/**
 * The `safety-review` pull-request check (ROADMAP P0-03, SAFETY §8).
 *
 * When a PR touches a safety-review path (shared/safetyPaths.ts), it passes
 * only if:
 * - the PR description carries the SAFETY §8 checklist from the PR template
 *   with every item, 1 to 40, ticked;
 * - the PR carries its recorded independent review
 *   (`docs/safety/reviews/pr-<N>.md`, reviewRecord.ts), complete, approving,
 *   covering every safety path touched and bound to the head tree (D40); and
 * - at least `REQUIRED_SAFETY_APPROVALS` (reviewPolicy.ts: zero while there
 *   is a single maintainer, D40; two again when a second maintainer joins)
 *   distinct reviewers other than the
 *   author have approved the PR's head commit, counting each reviewer's
 *   latest decisive review (a later "changes requested" or a dismissal
 *   cancels an approval; plain comments do not count either way), and only
 *   reviewers whose CURRENT effective permission on this repository is
 *   write, maintain or admin, as answered by GET
 *   /repos/{owner}/{repo}/collaborators/{username}/permission. The
 *   repository is public: anyone with a GitHub account can submit an
 *   "approving" review. `author_association` is not evidence: it describes a
 *   relationship (an organisation MEMBER may hold read, triage or no access
 *   to this repository). No answer, read, triage, none or a bot account: the
 *   approval does not count.
 *
 * This check is a SECONDARY control. Its workflow runs on pull_request, so a
 * PR can rewrite the workflow that runs it. The primary control is GitHub's
 * native branch protection (docs/ops/branch-protection.md).
 *
 * A PR that touches no such path passes; branch protection's own review
 * rules apply to it (none while D40's single maintainer is the only one). Owner review of the CODEOWNERS paths is
 * enforced by GitHub itself ("Require review from Code Owners").
 *
 * Dependency-free and pure: the CLI feeds it the GitHub API's answers.
 */
import { matches } from '../shared/glob.ts';
import { SAFETY_REVIEW_PATHS } from '../shared/safetyPaths.ts';
import { REQUIRED_SAFETY_APPROVALS, reviewRecordPath } from './reviewPolicy.ts';
import { checkReviewRecord } from './reviewRecord.ts';

export { REQUIRED_SAFETY_APPROVALS } from './reviewPolicy.ts';

/** What the check requires; the default is the committed policy (reviewPolicy.ts). */
export interface SafetyReviewPolicy {
  readonly requiredApprovals: number;
}
export const COMMITTED_POLICY: SafetyReviewPolicy = { requiredApprovals: REQUIRED_SAFETY_APPROVALS };

/**
 * The `permission` values of the permission endpoint that include push access
 * (maintain is reported as write, triage as read; custom roles as their base).
 */
export const WRITE_PERMISSIONS: readonly string[] = ['admin', 'write'];

/** One reviewer's current permission on this repository, from the API. */
export interface ReviewerPermission {
  readonly login: string;
  readonly permission: string;
  /** `user.permissions.push` when the answer carries it. */
  readonly push: boolean | undefined;
  readonly bot: boolean;
}

/** Reviewer permissions by lower-case login. */
export type ReviewerPermissions = ReadonlyMap<string, ReviewerPermission>;

/**
 * Reads the permission endpoint's answers (one object per reviewer). Throws
 * on anything malformed, or on two answers for one login, instead of
 * guessing; a reviewer with no answer simply has no evidence.
 */
export function parsePermissions(answers: readonly unknown[]): ReviewerPermissions {
  const out = new Map<string, ReviewerPermission>();
  for (const answer of answers) {
    const a = (typeof answer === 'object' && answer !== null ? answer : {}) as Record<string, unknown>;
    const user = (typeof a['user'] === 'object' && a['user'] !== null ? a['user'] : {}) as Record<string, unknown>;
    const login = user['login'];
    if (typeof login !== 'string' || login === '') throw new Error('permission answer without user.login');
    const permission = a['permission'];
    if (typeof permission !== 'string') throw new Error(`permission answer for ${login} without a permission`);
    const key = login.toLowerCase();
    if (out.has(key)) throw new Error(`permission answer for ${login} given twice`);
    const flags = user['permissions'];
    const push = typeof flags === 'object' && flags !== null ? (flags as Record<string, unknown>)['push'] : undefined;
    out.set(key, {
      login,
      permission,
      push: typeof push === 'boolean' ? push : undefined,
      bot: user['type'] === 'Bot' || /\[bot\]$/i.test(login),
    });
  }
  return out;
}

/** True only with evidence of push access now: write or admin, not contradicted by the push flag, not a bot. */
export function hasWriteAccess(login: string, permissions: ReviewerPermissions): boolean {
  if (/\[bot\]$/i.test(login)) return false;
  // No permission evidence at all (a caller that passed none) is the same as no answer: not counted.
  const p = (permissions as ReviewerPermissions | undefined)?.get(login.toLowerCase());
  if (p === undefined || p.bot) return false;
  return WRITE_PERMISSIONS.includes(p.permission) && p.push !== false;
}

/** Item numbers of the SAFETY §8 checklist (OLD-S 1–21 plus SAFETY 22–49; 41 is Phase 2 motion, 42 settings writes, 43–45 the push-driven state, report configuration, homing and offsets, 46–49 Phase 3 jobs). */
export const CHECKLIST_ITEMS: readonly number[] = Array.from({ length: 49 }, (_, i) => i + 1);

export interface Review {
  readonly user: string;
  /** GitHub review state: APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING. */
  readonly state: string;
  readonly commitId: string;
  /** GitHub author_association of the reviewer. Recorded for the log only: it is NOT evidence of permission. */
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
  /** Each reviewer's current permission on this repository (parsePermissions). */
  readonly permissions: ReviewerPermissions;
  /** The pull request number (names the review record). */
  readonly prNumber: number;
  /** The review record's text at the head (reviewRecord.ts), or undefined when the PR has none. */
  readonly reviewRecord: string | undefined;
  /** GitHub's compare of the record's reviewed commit with the head, or undefined when not fetched. */
  readonly recordCompare: unknown;
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

/** Reviewers (not the author, with write access now) whose latest decisive review approves `headSha`. */
export function approversOfHead(reviews: readonly Review[], author: string, headSha: string, permissions: ReviewerPermissions): string[] {
  const latest = new Map<string, Review>();
  const ordered = [...reviews].sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : 0));
  for (const review of ordered) {
    if (review.user.toLowerCase() === author.toLowerCase()) continue;
    if (review.state === 'COMMENTED' || review.state === 'PENDING') continue;
    latest.set(review.user.toLowerCase(), review);
  }
  return [...latest.values()]
    .filter((r) => r.state === 'APPROVED' && r.commitId === headSha && hasWriteAccess(r.user, permissions))
    .map((r) => r.user)
    .sort();
}

export function evaluateSafetyReview(pr: PullRequestFacts, policy: SafetyReviewPolicy = COMMITTED_POLICY): SafetyReviewResult {
  const required = policy.requiredApprovals;
  if (!Number.isSafeInteger(required) || required < 0) throw new Error(`invalid required approval count: ${String(required)}`);
  const safetyPaths = touchedSafetyPaths(pr.changedFiles);
  const approvers = approversOfHead(pr.reviews, pr.author, pr.headSha, pr.permissions);
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
  problems.push(
    ...checkReviewRecord({
      prNumber: pr.prNumber,
      recordPath: reviewRecordPath(pr.prNumber),
      author: pr.author,
      headSha: pr.headSha,
      safetyPaths,
      record: pr.reviewRecord,
      compare: pr.recordCompare,
    }),
  );
  if (approvers.length < required) {
    problems.push(
      `${approvers.length} approval(s) of the head commit from reviewers other than the author with write access to this repository; ` +
        `${required} are required for safety-review paths`,
    );
  }
  return { safetyPaths, approvers, problems };
}
