/**
 * The safety-review check and the PR template (ROADMAP P0-03: "PR template
 * with the SAFETY §8 checklist. It is required when the diff touches the
 * safety-path paths"; branch protection: "two [reviews] for safety paths").
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  approversOfHead,
  CHECKLIST_ITEMS,
  checklistState,
  evaluateSafetyReview,
  type PullRequestFacts,
  type Review,
  touchedSafetyPaths,
} from '../src/review/safetyReview.ts';
import { checkTemplate, safetyChecklistItems, templateItems } from '../src/review/template.ts';
import { REPO_ROOT, ScratchRepo } from './scratch.ts';

const SAFETY = readFileSync(join(REPO_ROOT, 'SAFETY.md'), 'utf8');
const TEMPLATE = readFileSync(join(REPO_ROOT, '.github/pull_request_template.md'), 'utf8');
const TICKED = TEMPLATE.replace(/^- \[ \] /gm, '- [x] ');
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);

const approve = (user: string, commitId = HEAD, at = '2026-11-01T10:00:00Z'): Review => ({ user, state: 'APPROVED', commitId, submittedAt: at });

function pr(overrides: Partial<PullRequestFacts>): PullRequestFacts {
  return { author: 'alice', headSha: HEAD, body: TICKED, changedFiles: ['packages/safety/src/index.ts'], reviews: [approve('bob'), approve('carol')], ...overrides };
}

describe('the PR template', () => {
  it('carries items 1 to 40, unticked, with 22 to 40 verbatim from SAFETY.md §8', () => {
    expect(checkTemplate(TEMPLATE, SAFETY)).toEqual([]);
    expect([...templateItems(TEMPLATE).keys()]).toEqual(CHECKLIST_ITEMS);
    expect([...safetyChecklistItems(SAFETY).keys()]).toEqual(CHECKLIST_ITEMS.slice(21));
  });

  it('fails when an item is reworded, removed or pre-ticked', () => {
    const reworded = TEMPLATE.replace('- [ ] 25. Library jobs are loaded fully', '- [ ] 25. Library jobs are loaded mostly');
    expect(checkTemplate(reworded, SAFETY)[0]).toMatch(/^item 25 differs from SAFETY\.md §8/);
    expect(checkTemplate(TEMPLATE.replace(/^- \[ \] 7\. .*\n/m, ''), SAFETY)).toEqual(['item 7 is missing from the PR template']);
    expect(checkTemplate(TEMPLATE.replace('- [ ] 1. ', '- [x] 1. '), SAFETY)).toEqual(['item 1 is pre-ticked in the PR template']);
  });

  it('fails when SAFETY.md §8 gains an item the check does not read', () => {
    const grown = SAFETY.replace('40. ☐ Console (MDI)', '41. ☐ A new rule.\n40. ☐ Console (MDI)');
    expect(checkTemplate(TEMPLATE, grown)).toContain('SAFETY.md §8 item 41 is not in the checklist the safety-review check reads');
  });
});

describe('which paths need the safety review', () => {
  it('includes the machine path, safety data, the gates and the supply chain', () => {
    const files = [
      'packages/machine/src/session.ts',
      'packages/protocol/src/dialects/en.ts',
      'packages/testkit/src/models/en.ts',
      'workers/run/src/headers.ts',
      'apps/web/src/cloud/client.ts',
      'SAFETY.md',
      '.github/workflows/ci.yml',
      'tools/gates/src/bundle/scan.ts',
      'apps/web/vite.config.ts',
      'pnpm-lock.yaml',
      'vendor/tinyg-hil-tables/den.json',
    ];
    expect(touchedSafetyPaths(files)).toEqual([...files].sort());
  });

  it('excludes ordinary UI and docs', () => {
    expect(touchedSafetyPaths(['apps/web/src/shell/Shell.tsx', 'README.md', 'packages/wiring/src/index.ts', 'workers/run/src/index.ts'])).toEqual([]);
  });
});

describe('the decision', () => {
  it('passes a PR that touches no safety path, with no checklist and no approvals', () => {
    const result = evaluateSafetyReview(pr({ changedFiles: ['README.md'], body: '', reviews: [] }));
    expect(result.problems).toEqual([]);
  });

  it('passes a safety PR with the full checklist and two approvals of the head commit', () => {
    const result = evaluateSafetyReview(pr({}));
    expect(result.problems).toEqual([]);
    expect(result.approvers).toEqual(['bob', 'carol']);
  });

  it('fails a safety PR without the checklist', () => {
    expect(evaluateSafetyReview(pr({ body: 'Small fix.' })).problems).toEqual([
      'the PR description has no SAFETY §8 checklist; copy it from .github/pull_request_template.md',
    ]);
  });

  it('fails a safety PR with an unticked or deleted item', () => {
    expect(evaluateSafetyReview(pr({ body: TICKED.replace('- [x] 33. ', '- [ ] 33. ') })).problems).toEqual(['checklist items not ticked: 33']);
    expect(evaluateSafetyReview(pr({ body: TICKED.replace(/^- \[x\] 12\. .*\n/m, '') })).problems).toEqual(['checklist items missing from the description: 12']);
  });

  it('fails a safety PR with one approval', () => {
    const problems = evaluateSafetyReview(pr({ reviews: [approve('bob')] })).problems;
    expect(problems).toEqual(['1 approval(s) of the head commit from reviewers other than the author; 2 are required for safety-review paths']);
  });

  it('counts a renamed file by its old path', () => {
    expect(touchedSafetyPaths(['packages/other/x.ts', 'packages/machine/src/stopJob.ts'])).toEqual(['packages/machine/src/stopJob.ts']);
  });
});

describe('counting approvals', () => {
  it("ignores the author's own approval", () => {
    expect(approversOfHead([approve('alice'), approve('bob')], 'alice', HEAD)).toEqual(['bob']);
    expect(approversOfHead([approve('Alice')], 'alice', HEAD)).toEqual([]);
  });

  it('ignores approvals of an older commit', () => {
    expect(approversOfHead([approve('bob', OLD), approve('carol')], 'alice', HEAD)).toEqual(['carol']);
  });

  it('a later change request or dismissal cancels an approval; a later comment does not', () => {
    const reviews: Review[] = [
      approve('bob', HEAD, '2026-11-01T10:00:00Z'),
      { user: 'bob', state: 'CHANGES_REQUESTED', commitId: HEAD, submittedAt: '2026-11-01T11:00:00Z' },
      approve('carol', HEAD, '2026-11-01T10:00:00Z'),
      { user: 'carol', state: 'COMMENTED', commitId: HEAD, submittedAt: '2026-11-01T12:00:00Z' },
      approve('dave', HEAD, '2026-11-01T10:00:00Z'),
      { user: 'dave', state: 'DISMISSED', commitId: HEAD, submittedAt: '2026-11-01T12:00:00Z' },
    ];
    expect(approversOfHead(reviews, 'alice', HEAD)).toEqual(['carol']);
  });

  it('counts each reviewer once', () => {
    expect(approversOfHead([approve('bob'), approve('bob', HEAD, '2026-11-02T00:00:00Z')], 'alice', HEAD)).toEqual(['bob']);
  });
});

describe('checklist parsing', () => {
  it('reads ticked and unticked items by number', () => {
    const { ticked, unticked } = checklistState('- [x] 1. a\n- [X] 2. b\n- [ ] 3. c\n* [x] 4. d\nnot - [x] 5. e\n');
    expect([...ticked]).toEqual([1, 2, 4]);
    expect([...unticked]).toEqual([3]);
  });
});

describe('the CLI, fed the GitHub API shapes', () => {
  it('passes and fails on real API-shaped input', { timeout: 60_000 }, () => {
    const repo = ScratchRepo.create();
    try {
      const files = join(repo.base, 'files.json');
      const reviews = join(repo.base, 'reviews.json');
      const body = join(repo.base, 'body.md');
      // --paginate --slurp: an array of pages.
      writeFileSync(files, JSON.stringify([[{ filename: 'packages/machine/src/stopNew.ts', previous_filename: 'packages/machine/src/old.ts' }]]));
      const review = (login: string): object => ({ user: { login }, state: 'APPROVED', commit_id: HEAD, submitted_at: '2026-11-01T10:00:00Z' });
      writeFileSync(reviews, JSON.stringify([[review('bob')], [review('carol')]]));
      writeFileSync(body, TICKED);
      const args = ['--files', files, '--reviews', reviews, '--body-file', body, '--author', 'alice', '--head-sha', HEAD];
      const ok = repo.gate('tools/gates/src/review/cli.ts', args);
      expect(ok.status, ok.output).toBe(0);
      expect(ok.output).toContain('approvals of the head commit: bob, carol');

      writeFileSync(reviews, JSON.stringify([[review('bob')]]));
      const one = repo.gate('tools/gates/src/review/cli.ts', args);
      expect(one.status, one.output).toBe(1);

      writeFileSync(files, JSON.stringify([[]]));
      expect(repo.gate('tools/gates/src/review/cli.ts', args).status).toBe(2);
    } finally {
      repo.dispose();
    }
  });
});
