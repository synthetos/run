/**
 * Trusted approvals for the safety-review check (P0-03 review follow-up).
 *
 * `author_association` says how someone relates to the repository, not what
 * they may do in it: an organisation MEMBER can hold read, triage or no
 * access to this repository. An approval counts only with evidence of the
 * reviewer's CURRENT effective permission on this repository (GET
 * /repos/{owner}/{repo}/collaborators/{username}/permission) at write,
 * maintain or admin level. No evidence, read, triage, none, a revoked
 * permission or a bot account: the approval does not count.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  approversOfHead,
  evaluateSafetyReview,
  parsePermissions,
  type PullRequestFacts,
  type Review,
  type ReviewerPermissions,
} from '../src/review/safetyReview.ts';
import { REPO_ROOT, ScratchRepo } from './scratch.ts';

const TEMPLATE = readFileSync(join(REPO_ROOT, '.github/pull_request_template.md'), 'utf8');
const TICKED = TEMPLATE.replace(/^- \[ \] /gm, '- [x] ');
const HEAD = 'a'.repeat(40);

const approve = (user: string, association = 'MEMBER'): Review => ({ user, state: 'APPROVED', commitId: HEAD, association, submittedAt: '2026-11-01T00:00:00Z' });

/** The permission endpoint's answer for one user. */
const answer = (login: string, permission: string, roleName = permission, type = 'User'): Record<string, unknown> => ({
  permission,
  role_name: roleName,
  user: { login, type, permissions: { admin: permission === 'admin', push: permission === 'admin' || permission === 'write', pull: permission !== 'none' } },
});

const perms = (...entries: Record<string, unknown>[]): ReviewerPermissions => parsePermissions(entries);

function pr(reviews: Review[], permissions: ReviewerPermissions): PullRequestFacts {
  return { author: 'owner', headSha: HEAD, body: TICKED, changedFiles: ['packages/safety/src/index.ts'], reviews, permissions };
}

describe("the reviewer's reproduction", () => {
  it('two read-only organisation MEMBERs no longer satisfy the check', () => {
    const reviews = ['readonly-org-member-1', 'readonly-org-member-2'].map((u) => approve(u));
    // With no permission evidence at all: nothing counts.
    expect(evaluateSafetyReview(pr(reviews, perms())).problems).toEqual([
      '0 approval(s) of the head commit from reviewers other than the author with write access to this repository; 2 are required for safety-review paths',
    ]);
    // With the actual answer (read): nothing counts either.
    const readOnly = perms(answer('readonly-org-member-1', 'read'), answer('readonly-org-member-2', 'read'));
    expect(evaluateSafetyReview(pr(reviews, readOnly)).approvers).toEqual([]);
  });
});

describe('which approvals count', () => {
  it.each([
    ['admin', 'admin', true],
    ['maintain', 'write', true],
    ['write', 'write', true],
    ['triage', 'read', false],
    ['read', 'read', false],
    ['none', 'none', false],
  ])('role %s (permission %s): counts = %s', (role, permission, counts) => {
    const p = perms(answer('rev', permission, role));
    expect(approversOfHead([approve('rev', 'NONE')], 'owner', HEAD, p)).toEqual(counts ? ['rev'] : []);
  });

  it('association is not evidence either way: OWNER/MEMBER/COLLABORATOR without write do not count, write access counts whatever the association', () => {
    const p = perms(answer('o', 'read'), answer('m', 'none'), answer('c', 'read'), answer('w', 'write'));
    expect(approversOfHead([approve('o', 'OWNER'), approve('m', 'MEMBER'), approve('c', 'COLLABORATOR'), approve('w', 'CONTRIBUTOR')], 'owner', HEAD, p)).toEqual(['w']);
  });

  it('a revoked permission (the current answer is read or none) cancels an earlier approval', () => {
    const before = perms(answer('bob', 'write'), answer('carol', 'write'));
    const reviews = [approve('bob'), approve('carol')];
    expect(evaluateSafetyReview(pr(reviews, before)).problems).toEqual([]);
    const after = perms(answer('bob', 'write'), answer('carol', 'none'));
    expect(evaluateSafetyReview(pr(reviews, after)).approvers).toEqual(['bob']);
  });

  it('bots never count, even with write access', () => {
    const p = perms(answer('helper[bot]', 'write', 'write', 'Bot'), answer('app-user', 'write', 'write', 'Bot'), answer('bob', 'write'));
    expect(approversOfHead([approve('helper[bot]'), approve('app-user'), approve('bob')], 'owner', HEAD, p)).toEqual(['bob']);
  });

  it('logins match case-insensitively, and the author never counts', () => {
    const p = perms(answer('Bob', 'write'), answer('owner', 'admin'));
    expect(approversOfHead([approve('bob'), approve('OWNER')], 'owner', HEAD, p)).toEqual(['bob']);
  });
});

describe('parsePermissions (the API answers)', () => {
  it('refuses malformed answers instead of guessing', () => {
    expect(() => parsePermissions([{ permission: 'write' }])).toThrow(/login/);
    expect(() => parsePermissions([{ user: { login: 'bob' } }])).toThrow(/permission/);
    expect(() => parsePermissions([answer('bob', 'write'), answer('BOB', 'read')])).toThrow(/twice/);
  });

  it('does not trust an answer whose permission and push flag disagree', () => {
    const forged = { permission: 'write', role_name: 'write', user: { login: 'bob', type: 'User', permissions: { push: false } } };
    expect(approversOfHead([approve('bob')], 'owner', HEAD, parsePermissions([forged]))).toEqual([]);
  });
});

describe('the CLI, fed the API shapes', () => {
  it('requires --permissions and counts only write-level reviewers', { timeout: 60_000 }, () => {
    const repo = ScratchRepo.create();
    try {
      const files = join(repo.base, 'files.json');
      const reviews = join(repo.base, 'reviews.json');
      const body = join(repo.base, 'body.md');
      const permissions = join(repo.base, 'permissions.json');
      writeFileSync(files, JSON.stringify([[{ filename: 'packages/safety/src/index.ts' }]]));
      const review = (login: string): object => ({ user: { login }, state: 'APPROVED', commit_id: HEAD, author_association: 'MEMBER', submitted_at: '2026-11-01T10:00:00Z' });
      writeFileSync(reviews, JSON.stringify([[review('bob'), review('carol')]]));
      writeFileSync(body, TICKED);
      const base = ['--files', files, '--reviews', reviews, '--body-file', body, '--author', 'alice', '--head-sha', HEAD];

      expect(repo.gate('tools/gates/src/review/cli.ts', base).status).toBe(2);

      writeFileSync(permissions, JSON.stringify([answer('bob', 'write'), answer('carol', 'read')]));
      const one = repo.gate('tools/gates/src/review/cli.ts', [...base, '--permissions', permissions]);
      expect(one.status, one.output).toBe(1);
      expect(one.output).toContain('approvals of the head commit: bob');

      writeFileSync(permissions, JSON.stringify([answer('bob', 'write'), answer('carol', 'admin')]));
      const two = repo.gate('tools/gates/src/review/cli.ts', [...base, '--permissions', permissions]);
      expect(two.status, two.output).toBe(0);
      expect(two.output).toContain('approvals of the head commit: bob, carol');
    } finally {
      repo.dispose();
    }
  });
});
