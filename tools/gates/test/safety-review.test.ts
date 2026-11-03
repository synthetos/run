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
  parsePermissions,
  type PullRequestFacts,
  REQUIRED_SAFETY_APPROVALS,
  type Review,
  touchedSafetyPaths,
} from '../src/review/safetyReview.ts';
import { checkTemplate, safetyChecklistItems, templateItems } from '../src/review/template.ts';
import { compare, PR_NUMBER, record } from './reviewRecordFixture.ts';
import { REPO_ROOT, ScratchRepo } from './scratch.ts';

const SAFETY = readFileSync(join(REPO_ROOT, 'SAFETY.md'), 'utf8');
const TEMPLATE = readFileSync(join(REPO_ROOT, '.github/pull_request_template.md'), 'utf8');
const TICKED = TEMPLATE.replace(/^- \[ \] /gm, '- [x] ');
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);

const approve = (user: string, commitId = HEAD, at = '2026-11-01T10:00:00Z', association = 'COLLABORATOR'): Review => ({
  user,
  state: 'APPROVED',
  commitId,
  association,
  submittedAt: at,
});

/** Permission answers (GET .../collaborators/{user}/permission): these reviewers hold write access now. */
const writers = (...logins: string[]): ReturnType<typeof parsePermissions> =>
  parsePermissions(logins.map((login) => ({ permission: 'write', role_name: 'write', user: { login, type: 'User', permissions: { push: true } } })));
const WRITERS = writers('alice', 'bob', 'carol', 'dave');

function pr(overrides: Partial<PullRequestFacts>): PullRequestFacts {
  const changedFiles = overrides.changedFiles ?? ['packages/safety/src/index.ts'];
  return {
    author: 'alice',
    headSha: HEAD,
    body: TICKED,
    changedFiles,
    reviews: [approve('bob'), approve('carol')],
    permissions: WRITERS,
    prNumber: PR_NUMBER,
    reviewRecord: record(touchedSafetyPaths(changedFiles)),
    recordCompare: compare(HEAD),
    ...overrides,
  };
}

/** The two-approval rule SAFETY §8 asks for, which returns when a second maintainer joins (reviewPolicy.ts, D40). */
const TWO_MAINTAINERS = { requiredApprovals: 2 };

describe('the PR template', () => {
  it('carries items 1 to 45, unticked, with 22 to 45 verbatim from SAFETY.md §8', () => {
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
    const grown = SAFETY.replace('45. ☐ (amendment 2026-11-02) Homing', '46. ☐ A new rule.\n45. ☐ (amendment 2026-11-02) Homing');
    expect(checkTemplate(TEMPLATE, grown)).toContain('SAFETY.md §8 item 46 is not in the checklist the safety-review check reads');
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
    expect(touchedSafetyPaths(['apps/web/src/shell/Shell.ts', 'README.md', 'packages/wiring/src/index.ts', 'workers/run/test/routes.test.ts'])).toEqual([]);
  });

  it('MACHINING_ASSISTANT §6.4: covers the advisor (the override envelope), not the library records', () => {
    expect(touchedSafetyPaths(['packages/advisor/src/envelope.ts', 'packages/library/src/types.ts'])).toEqual(['packages/advisor/src/envelope.ts']);
  });

  it('P1-00: covers the Worker modules that pick the header set, the machine worker and the build channel', () => {
    const files = ['workers/run/src/index.ts', 'workers/run/src/routes.ts', 'apps/web/src/machine-worker/transport.ts', 'apps/web/src/channel/bench.ts'];
    expect([...touchedSafetyPaths(files)].sort()).toEqual([...files].sort());
  });
});

describe('the decision', () => {
  it('passes a PR that touches no safety path, with no checklist and no approvals', () => {
    const result = evaluateSafetyReview(pr({ changedFiles: ['README.md'], body: '', reviews: [] }));
    expect(result.problems).toEqual([]);
  });

  it('passes a safety PR with the full checklist and two approvals of the head commit (two-maintainer rule)', () => {
    const result = evaluateSafetyReview(pr({}), TWO_MAINTAINERS);
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

  it('fails a safety PR with one approval (two-maintainer rule)', () => {
    const problems = evaluateSafetyReview(pr({ reviews: [approve('bob')] }), TWO_MAINTAINERS).problems;
    expect(problems).toEqual(['1 approval(s) of the head commit from reviewers other than the author with write access to this repository; 2 are required for safety-review paths']);
  });

  it('flags a PR that only moves a file out of a safety path', () => {
    // The CLI passes both the new and the old path of a rename (see the CLI test).
    expect(touchedSafetyPaths(['packages/other/stopJob.ts', 'packages/machine/src/stopJob.ts'])).toEqual(['packages/machine/src/stopJob.ts']);
  });
});

describe('counting approvals', () => {
  it("ignores the author's own approval", () => {
    expect(approversOfHead([approve('alice'), approve('bob')], 'alice', HEAD, WRITERS)).toEqual(['bob']);
    expect(approversOfHead([approve('Alice')], 'alice', HEAD, WRITERS)).toEqual([]);
  });

  it('ignores approvals of an older commit', () => {
    expect(approversOfHead([approve('bob', OLD), approve('carol')], 'alice', HEAD, WRITERS)).toEqual(['carol']);
  });

  it('a later change request or dismissal cancels an approval; a later comment does not', () => {
    const reviews: Review[] = [
      approve('bob', HEAD, '2026-11-01T10:00:00Z'),
      { user: 'bob', state: 'CHANGES_REQUESTED', commitId: HEAD, association: 'COLLABORATOR', submittedAt: '2026-11-01T11:00:00Z' },
      approve('carol', HEAD, '2026-11-01T10:00:00Z'),
      { user: 'carol', state: 'COMMENTED', commitId: HEAD, association: 'COLLABORATOR', submittedAt: '2026-11-01T12:00:00Z' },
      approve('dave', HEAD, '2026-11-01T10:00:00Z'),
      { user: 'dave', state: 'DISMISSED', commitId: HEAD, association: 'COLLABORATOR', submittedAt: '2026-11-01T12:00:00Z' },
    ];
    expect(approversOfHead(reviews, 'alice', HEAD, WRITERS)).toEqual(['carol']);
  });

  it('counts only reviewers with write access now, whatever their author_association (the repository is public)', () => {
    // review-permission.test.ts covers each permission level, revocation and bots.
    const reviews = [
      approve('mallory', HEAD, '2026-11-01T10:00:00Z', 'NONE'),
      approve('trudy', HEAD, '2026-11-01T10:00:00Z', 'CONTRIBUTOR'),
      approve('owner', HEAD, '2026-11-01T10:00:00Z', 'OWNER'),
      approve('member', HEAD, '2026-11-01T10:00:00Z', 'MEMBER'),
    ];
    const permissions = parsePermissions([
      { permission: 'read', user: { login: 'mallory' } },
      { permission: 'write', user: { login: 'trudy' } },
      { permission: 'admin', user: { login: 'owner' } },
      { permission: 'read', user: { login: 'member' } },
    ]);
    expect(approversOfHead(reviews, 'alice', HEAD, permissions)).toEqual(['owner', 'trudy']);
    expect(evaluateSafetyReview(pr({ reviews: [reviews[0] as Review, reviews[3] as Review], permissions }), TWO_MAINTAINERS).problems).toEqual([
      '0 approval(s) of the head commit from reviewers other than the author with write access to this repository; 2 are required for safety-review paths',
    ]);
  });

  it('counts each reviewer once', () => {
    expect(approversOfHead([approve('bob'), approve('bob', HEAD, '2026-11-02T00:00:00Z')], 'alice', HEAD, WRITERS)).toEqual(['bob']);
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
      // A rename OUT of the machine path: only previous_filename is a safety path.
      writeFileSync(files, JSON.stringify([[{ filename: 'docs/old-stop.ts', previous_filename: 'packages/machine/src/stopJob.ts' }]]));
      const review = (login: string, association = 'MEMBER'): object => ({
        user: { login },
        state: 'APPROVED',
        commit_id: HEAD,
        author_association: association,
        submitted_at: '2026-11-01T10:00:00Z',
      });
      writeFileSync(reviews, JSON.stringify([[review('bob')], [review('carol')]]));
      writeFileSync(body, TICKED);
      const permissions = join(repo.base, 'permissions.json');
      writeFileSync(
        permissions,
        JSON.stringify(['bob', 'carol'].map((login) => ({ permission: 'write', role_name: 'write', user: { login, type: 'User', permissions: { push: true } } }))),
      );
      const recordFile = join(repo.base, 'review-record.md');
      const compareFile = join(repo.base, 'review-compare.json');
      writeFileSync(recordFile, record(['packages/machine/src/stopJob.ts']));
      writeFileSync(compareFile, JSON.stringify(compare(HEAD)));
      const args = ['--files', files, '--reviews', reviews, '--permissions', permissions, '--body-file', body, '--author', 'alice', '--head-sha', HEAD];
      const recordArgs = ['--pr', String(PR_NUMBER), '--record', recordFile, '--record-compare', compareFile];
      const all = [...args, ...recordArgs];
      // The committed policy decides how many approvals are needed (D40: zero with one maintainer).
      const expectedFor = (approvals: number): number => (approvals >= REQUIRED_SAFETY_APPROVALS ? 0 : 1);
      const ok = repo.gate('tools/gates/src/review/cli.ts', all);
      expect(ok.status, ok.output).toBe(0);
      expect(ok.output).toContain('approvals of the head commit: bob, carol');
      expect(ok.output).toContain('packages/machine/src/stopJob.ts');

      writeFileSync(reviews, JSON.stringify([[review('bob')], [review('mallory', 'NONE')]]));
      const outsider = repo.gate('tools/gates/src/review/cli.ts', all);
      expect(outsider.output).toContain('approvals of the head commit: bob\n');
      expect(outsider.status, outsider.output).toBe(expectedFor(1));

      writeFileSync(reviews, JSON.stringify([[review('bob')]]));
      const one = repo.gate('tools/gates/src/review/cli.ts', all);
      expect(one.status, one.output).toBe(expectedFor(1));

      // D40: the recorded independent review is required whatever the approvals.
      writeFileSync(reviews, JSON.stringify([[review('bob')], [review('carol')]]));
      writeFileSync(recordFile, '');
      const noRecord = repo.gate('tools/gates/src/review/cli.ts', all);
      expect(noRecord.status, noRecord.output).toBe(1);
      expect(noRecord.output).toContain(`no independent review record: commit docs/safety/reviews/pr-${PR_NUMBER}.md`);
      writeFileSync(recordFile, record(['packages/machine/src/stopJob.ts']));
      writeFileSync(compareFile, 'null');
      expect(repo.gate('tools/gates/src/review/cli.ts', all).status).toBe(1);
      writeFileSync(compareFile, JSON.stringify(compare(HEAD)));

      // The record arguments are required: without them the check cannot run.
      expect(repo.gate('tools/gates/src/review/cli.ts', args).status).toBe(2);
      expect(repo.gate('tools/gates/src/review/cli.ts', [...args, '--pr', '0', '--record', recordFile, '--record-compare', compareFile]).status).toBe(2);

      writeFileSync(files, JSON.stringify([[]]));
      expect(repo.gate('tools/gates/src/review/cli.ts', all).status).toBe(2);
    } finally {
      repo.dispose();
    }
  });
});
