/**
 * D39 and D40 are carried into the repository (docs/ops/owner-decisions.md).
 * Nothing that configures or deploys run may still describe the superseded
 * dedicated D34 account, and the ops pages must give the D40 ruleset and
 * the accounts-binding rule the other repositories must match.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_ID_PLACEHOLDER } from '../src/deploy/wranglerConfig.ts';
import { REPO_ROOT } from './scratch.ts';

const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

/** Files that configure, gate or describe run's deploys today (not decision history). */
const CURRENT = [
  'workers/run/wrangler.jsonc',
  'tools/gates/src/deploy/wranglerConfig.ts',
  'tools/gates/src/deploy/preflight.ts',
  '.github/workflows/ci.yml',
  '.github/workflows/safety-review.yml',
  '.github/CODEOWNERS',
  '.github/pull_request_template.md',
  'README.md',
  'RELEASES.md',
  'docs/ops/access.md',
  'docs/ops/worker.md',
  'docs/ops/ci.md',
];

describe('D39: the current account, not a dedicated one', () => {
  it('the placeholder no longer names D34, and the committed config carries the D39 one or a real id', () => {
    expect(ACCOUNT_ID_PLACEHOLDER).toBe('RUN_ACCOUNT_ID_PLACEHOLDER');
    for (const path of [...CURRENT, 'docs/ops/account.md', 'docs/ops/branch-protection.md']) {
      expect(read(path), path).not.toContain('D34_RUN_ACCOUNT_ID_PLACEHOLDER');
    }
  });

  it('no current configuration or ops page describes a dedicated run account', () => {
    const offenders = CURRENT.filter((path) => /dedicated (run )?(Cloudflare )?account|dedicated account|account D34|D34 account/i.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it('the account page describes the D39 lockdown', () => {
    for (const path of ['docs/ops/account.md']) {
      const text = read(path);
      expect(text, path).toMatch(/current\*{0,2} Cloudflare account/);
      expect(text, path).toMatch(/hardware(-| )(security )?key/);
      expect(text, path).toMatch(/[Aa]udit-log alerts/);
      expect(text, path).toContain('RUN_ACCOUNT_ID_PLACEHOLDER');
    }
    expect(read('docs/ops/account.md')).toMatch(/no local `wrangler login`/i);
  });

  it('the account page records the matching accounts-binding rule for the accounts and site repositories', () => {
    const text = read('docs/ops/account.md');
    expect(text).toContain('**accounts repository**');
    expect(text).toContain('**site repository (synthetos.com) and forumbot**');
    expect(text).toMatch(/refuse any\s+wrangler configuration that binds `accounts`/);
  });
});

describe('D40: the ruleset for a single maintainer', () => {
  it('the branch protection ruleset requires zero approvals and no Code Owner or last-push approval, and keeps safety-review required', () => {
    const text = read('docs/ops/branch-protection.md');
    const json = /```json\n([\s\S]*?)\n```/.exec(text.slice(text.indexOf('**Ruleset for `main`**')))?.[1];
    const ruleset = JSON.parse(json ?? 'null') as { bypass_actors: unknown[]; rules: { type: string; parameters?: Record<string, unknown> }[] };
    const pr = ruleset.rules.find((r) => r.type === 'pull_request')?.parameters;
    expect(pr?.['required_approving_review_count']).toBe(0);
    expect(pr?.['require_code_owner_review']).toBe(false);
    expect(pr?.['require_last_push_approval']).toBe(false);
    expect(pr?.['dismiss_stale_reviews_on_push']).toBe(true);
    expect(ruleset.bypass_actors).toEqual([]);
    const checks = ruleset.rules.find((r) => r.type === 'required_status_checks')?.parameters?.['required_status_checks'] as { context: string }[];
    expect(checks.map((c) => c.context)).toEqual(['verify', 'build', 'e2e', 'e2e-fake-serial', 'safety-review']);
  });

  it('the branch protection page names native protection as the real control and gives the way back to two approvals', () => {
    const text = read('docs/ops/branch-protection.md');
    expect(text).toContain('Required approvals: **0** (D40)');
    expect(text).toContain('### When a second maintainer joins');
    expect(text).toContain('export const REQUIRED_SAFETY_APPROVALS: number = 2;');
    expect(text).toMatch(/The `safety-review` check is a \*\*secondary\*\* control/);
  });
});
