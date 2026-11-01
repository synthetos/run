/**
 * A valid D40 review record and the GitHub compare answer that binds it to
 * the head, for the safety-review tests. Each test breaks one thing.
 */
export const PR_NUMBER = 42;
export const RECORD_PATH = `docs/safety/reviews/pr-${PR_NUMBER}.md`;
export const REVIEWED = 'c'.repeat(40);

export function record(paths: readonly string[], overrides: Partial<Record<'pr' | 'commit' | 'reviewer' | 'verdict' | 'open', string>> = {}): string {
  return [
    `# Independent safety review: PR #${overrides.pr ?? PR_NUMBER}`,
    '',
    `- PR: ${overrides.pr ?? PR_NUMBER}`,
    `- Reviewed commit: ${overrides.commit ?? REVIEWED}`,
    `- Reviewer: ${overrides.reviewer ?? 'independent-reviewer'}`,
    `- Verdict: ${overrides.verdict ?? 'approve'}`,
    `- Open findings: ${overrides.open ?? 'none'}`,
    '',
    '## Safety paths reviewed',
    '',
    ...paths.map((p) => `- ${p}`),
    '',
    '## Notes',
    '',
    'Checked the change against SAFETY §8.',
    '',
  ].join('\n');
}

/** GET /compare/{reviewed}...{head}: the head is the reviewed commit plus the record. */
export function compare(head: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'ahead',
    ahead_by: 1,
    behind_by: 0,
    total_commits: 1,
    base_commit: { sha: REVIEWED },
    merge_base_commit: { sha: REVIEWED },
    commits: [{ sha: head }],
    files: [{ filename: RECORD_PATH, status: 'added' }],
    ...overrides,
  };
}
