/**
 * Workflow policy (ROADMAP P0-03 acceptance):
 * - "A grep test shows that no job except the deploy jobs references the
 *   Cloudflare secret."
 * - "Deploy jobs cannot run on a PR": each deploy job's `if:` is a plain
 *   conjunction that is false for every pull_request context (the run logs
 *   on GitHub show the jobs skipped; see docs/ops/ci.md).
 * - "A PR runs verify and fails on a failing test": verify is unconditional,
 *   runs on pull_request and runs the unit tests with no continue-on-error.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkWorkflow,
  DEPLOY_JOBS,
  DEPLOY_SECRET,
  evaluateConjunction,
  parseConjunction,
  readJobs,
  readLines,
} from '../src/workflow/policy.ts';
import { REPO_ROOT } from './scratch.ts';

const CI = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
const REVIEW = readFileSync(join(REPO_ROOT, '.github/workflows/safety-review.yml'), 'utf8');

function mutate(source: string, from: string, to: string): string {
  expect(source.includes(from), `test fixture: '${from}' not found`).toBe(true);
  return source.replace(from, to);
}

const rules = (source: string, file = 'ci.yml'): string[] => [...new Set(checkWorkflow(file, source).map((f) => f.rule))];

describe('the real workflows', () => {
  it('pass the policy', () => {
    expect(checkWorkflow('ci.yml', CI)).toEqual([]);
    expect(checkWorkflow('safety-review.yml', REVIEW)).toEqual([]);
  });

  it('grep: only the deploy jobs mention the Cloudflare secret, and both do', () => {
    const jobs = readJobs(readLines(CI));
    expect(jobs.map((j) => j.name)).toEqual(['verify', 'build', 'e2e', 'attest', 'deploy-staging', 'deploy-production']);
    const mentioning = jobs.filter((j) => j.lines.some((l) => l.text.includes(DEPLOY_SECRET) || /\bsecrets\b/.test(l.text))).map((j) => j.name);
    expect(mentioning).toEqual([...DEPLOY_JOBS]);
    // Nothing outside the jobs block mentions it either (comments aside).
    const beforeJobs = CI.slice(0, CI.indexOf('\njobs:\n'));
    const code = beforeJobs.split('\n').filter((l) => !l.trimStart().startsWith('#'));
    expect(code.some((l) => l.includes(DEPLOY_SECRET) || /\bsecrets\b/.test(l))).toBe(false);
    expect(REVIEW.split('\n').filter((l) => !l.trimStart().startsWith('#')).some((l) => /\bsecrets\b|CLOUDFLARE/.test(l))).toBe(false);
  });

  it('deploy jobs evaluate to false for every pull_request context and true only for a push to main', () => {
    const jobs = readJobs(readLines(CI)).filter((j) => DEPLOY_JOBS.includes(j.name));
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      const condition = job.lines.find((l) => l.indent === 4 && l.text.startsWith('if:'))?.text.slice(3).trim() ?? '';
      const terms = parseConjunction(condition);
      expect(terms, job.name).toBeDefined();
      const t = terms ?? [];
      for (const ref of ['refs/pull/7/merge', 'refs/heads/main', 'refs/heads/feature']) {
        for (const enabled of ['true', 'false', '']) {
          const ctx = { 'github.event_name': 'pull_request', 'github.ref': ref, 'vars.RUN_DEPLOY_ENABLED': enabled };
          expect(evaluateConjunction(t, ctx), `${job.name} on PR ${ref}`).toBe(false);
        }
      }
      expect(evaluateConjunction(t, { 'github.event_name': 'push', 'github.ref': 'refs/heads/feature', 'vars.RUN_DEPLOY_ENABLED': 'true' })).toBe(false);
      expect(evaluateConjunction(t, { 'github.event_name': 'push', 'github.ref': 'refs/heads/main', 'vars.RUN_DEPLOY_ENABLED': '' })).toBe(false);
      expect(evaluateConjunction(t, { 'github.event_name': 'push', 'github.ref': 'refs/heads/main', 'vars.RUN_DEPLOY_ENABLED': 'true' })).toBe(true);
    }
  });
});

describe('secrets', () => {
  it('fails when the verify job references the Cloudflare secret', () => {
    const bad = mutate(CI, '      - name: Typecheck\n', '      - name: Typecheck\n        env:\n          T: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n');
    expect(rules(bad)).toEqual(['secret-outside-deploy']);
  });

  it('fails when the build job names the token even without secrets.', () => {
    const bad = mutate(CI, '      - name: Bundle scan\n', '      - name: Bundle scan\n        env:\n          CLOUDFLARE_API_TOKEN: x\n');
    expect(rules(bad)).toEqual(['secret-outside-deploy']);
  });

  it('fails on a workflow-level env that reads a secret', () => {
    const bad = mutate(CI, 'permissions:\n  contents: read\n\nconcurrency:', 'env:\n  X: ${{ secrets.ANY }}\n\npermissions:\n  contents: read\n\nconcurrency:');
    expect(rules(bad)).toEqual(['secret-outside-deploy']);
  });

  it('fails when a deploy job uses any other secret, or all of them', () => {
    expect(rules(mutate(CI, 'CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}', 'CLOUDFLARE_ACCOUNT_ID: ${{ secrets.OTHER }}'))).toEqual(['secret-outside-deploy']);
    expect(rules(mutate(CI, 'CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}', 'ALL: ${{ toJSON(secrets) }}'))).toEqual(['secret-outside-deploy']);
  });

  it('fails when a secret hides in a run script of another job', () => {
    const bad = mutate(CI, '        run: pnpm lint\n', '        run: |\n          echo "${SECRETS}" && curl -H "x: $(cat secrets.txt)" x\n');
    expect(rules(bad)).toEqual(['secret-outside-deploy']);
  });
});

describe('the deploy gate', () => {
  const GATE = "if: github.event_name == 'push' && github.ref == 'refs/heads/main' && vars.RUN_DEPLOY_ENABLED == 'true'\n    runs-on: ubuntu-24.04\n    timeout-minutes: 15\n    environment:\n      name: staging";

  it('fails without the main-branch condition', () => {
    expect(rules(mutate(CI, GATE, GATE.replace(" && github.ref == 'refs/heads/main'", '')))).toEqual(['deploy-gate']);
  });

  it('fails with an || that would let a PR through', () => {
    expect(rules(mutate(CI, GATE, GATE.replace(" && vars.RUN_DEPLOY_ENABLED == 'true'", " || github.event_name == 'pull_request'")))).toEqual(['deploy-gate']);
  });

  it('fails with a negation or a function in the condition', () => {
    expect(rules(mutate(CI, GATE, GATE.replace("github.event_name == 'push'", "!cancelled() && github.event_name == 'push'")))).toEqual(['deploy-gate']);
  });

  it('fails when the condition is removed', () => {
    expect(rules(mutate(CI, GATE, GATE.replace(/^if: .*\n/, '')))).toEqual(['deploy-gate']);
  });

  it('fails when a deploy job does not need e2e', () => {
    expect(rules(mutate(CI, 'needs: [verify, build, e2e, attest]\n', 'needs: [verify, build, attest]\n'))).toEqual(['deploy-gate']);
  });

  it('fails when a deploy job uses the wrong environment, or none', () => {
    expect(rules(mutate(CI, '      name: staging\n', '      name: production\n'))).toEqual(['deploy-gate']);
    expect(rules(mutate(CI, '    environment:\n      name: production\n      url: https://run.synthetos.com\n', ''))).toEqual(['deploy-gate']);
  });

  it('fails when another job uses an environment', () => {
    expect(rules(mutate(CI, '  e2e:\n    name: e2e\n', '  e2e:\n    name: e2e\n    environment: production\n'))).toEqual(['environment-outside-deploy']);
  });

  it('fails when a deploy job is renamed away', () => {
    expect(rules(mutate(CI, '  deploy-production:\n', '  ship-it:\n'))).toContain('deploy-gate');
  });
});

describe('verify', () => {
  it('fails when verify becomes conditional', () => {
    expect(rules(mutate(CI, '  verify:\n    name: verify\n', "  verify:\n    name: verify\n    if: github.event_name == 'push'\n"))).toEqual(['verify-job']);
  });

  it('fails when verify stops running the tests', () => {
    expect(rules(mutate(CI, '        run: pnpm -r test\n', '        run: echo skipped\n'))).toEqual(['verify-job']);
  });

  it('fails when CI no longer runs on pull requests', () => {
    expect(rules(mutate(CI, 'on:\n  pull_request:\n    branches: [main]\n', 'on:\n'))).toEqual(['verify-job']);
  });

  it('fails on continue-on-error anywhere', () => {
    expect(rules(mutate(CI, '        run: pnpm -r test\n', '        run: pnpm -r test\n        continue-on-error: true\n'))).toEqual(['continue-on-error']);
  });
});

describe('supply chain and injection', () => {
  it('fails on an action pinned by tag', () => {
    expect(rules(mutate(CI, 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1', 'actions/checkout@v7'))).toEqual(['unpinned-action']);
    expect(rules(mutate(CI, 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1', 'actions/checkout@3d3c42e'))).toEqual(['unpinned-action']);
  });

  it('fails on pull_request_target and workflow_run', () => {
    expect(rules(mutate(CI, 'on:\n  pull_request:\n', 'on:\n  pull_request_target:\n  pull_request:\n'))).toEqual(['banned-trigger']);
    expect(rules(mutate(REVIEW, 'on:\n', 'on:\n  workflow_run:\n    workflows: [ci]\n'), 'safety-review.yml')).toEqual(['banned-trigger']);
  });

  it('fails on ${{ }} inside a run script, single-line or block', () => {
    expect(rules(mutate(CI, '        run: pnpm lint\n', '        run: echo "${{ github.event.pull_request.title }}"\n'))).toEqual(['expression-in-run']);
    expect(rules(mutate(CI, '          mkdir -p artifact\n', '          mkdir -p artifact-${{ github.head_ref }}\n'))).toEqual(['expression-in-run']);
  });

  it('allows ${{ }} in env:, which is how values reach scripts', () => {
    expect(rules(REVIEW, 'safety-review.yml')).toEqual([]);
    expect(REVIEW).toContain('PR_BODY: ${{ github.event.pull_request.body }}');
  });

  it('fails on write permissions outside the attest job, and on write-all', () => {
    expect(rules(mutate(CI, '  build:\n    name: build\n    runs-on: ubuntu-24.04\n    timeout-minutes: 20\n    permissions:\n      contents: read\n', '  build:\n    name: build\n    runs-on: ubuntu-24.04\n    timeout-minutes: 20\n    permissions:\n      contents: read\n      id-token: write\n'))).toEqual(['write-permission']);
    expect(rules(mutate(CI, 'permissions:\n  contents: read\n\nconcurrency:', 'permissions: write-all\n\nconcurrency:'))).toEqual(['write-permission']);
    expect(rules(mutate(CI, 'permissions:\n  contents: read\n\nconcurrency:', 'permissions:\n  contents: write\n\nconcurrency:'))).toEqual(['write-permission']);
  });

  it('fails on YAML anchors, aliases and merge keys', () => {
    expect(rules(mutate(CI, '  verify:\n    name: verify\n', '  verify: &v\n    name: verify\n'))).toContain('yaml-subset');
    expect(rules(mutate(CI, '  e2e:\n    name: e2e\n', '  e2e:\n    <<: *v\n    name: e2e\n'))).toContain('yaml-subset');
  });

  it('fails on tabs', () => {
    expect(rules(mutate(CI, '        run: pnpm lint\n', '\t\trun: pnpm lint\n'))).toContain('yaml-subset');
  });
});

describe('the condition reader', () => {
  it('accepts only conjunctions of equalities', () => {
    expect(parseConjunction("github.event_name == 'push' && github.ref == 'refs/heads/main'")).toEqual([
      { path: 'github.event_name', value: 'push' },
      { path: 'github.ref', value: 'refs/heads/main' },
    ]);
    expect(parseConjunction("${{ github.ref == 'refs/heads/main' }}")).toEqual([{ path: 'github.ref', value: 'refs/heads/main' }]);
    for (const bad of ['', "a == 'x' || b == 'y'", "!(a == 'x')", "a != 'x'", "startsWith(github.ref, 'refs/heads/')", "a == b"]) {
      expect(parseConjunction(bad), bad).toBeUndefined();
    }
  });
});
