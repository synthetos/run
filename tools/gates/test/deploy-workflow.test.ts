/**
 * Workflow policy for the deploy and review fixes (P0-03/P0-04 review):
 * - `deploy-config`: each deploy job's preflight writes the allowlisted
 *   deployment configuration, and every wrangler invocation in the job uses
 *   that file, never the checkout's wrangler.jsonc (custom builds run under
 *   --no-bundle with the deploy token).
 * - `smoke-credentials`: every smoke-test step in a deploy job, the staging
 *   pre-deploy Access check included, is given CLOUDFLARE_API_TOKEN and
 *   CLOUDFLARE_ACCOUNT_ID in its own env (a step's env is not inherited by
 *   the next step; without them the positive Access check refuses every
 *   staging deploy).
 * - `safety-review-job`: safety-review.yml runs the base commit's gate with
 *   the reviewers' actual repository permissions. This is a consistency
 *   check of the file as committed: a PR can edit this policy as well, so
 *   the primary control is GitHub's native branch protection
 *   (docs/ops/branch-protection.md).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkWorkflow } from '../src/workflow/policy.ts';
import { REPO_ROOT } from './scratch.ts';

const CI = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
const REVIEW = readFileSync(join(REPO_ROOT, '.github/workflows/safety-review.yml'), 'utf8');

function mutate(source: string, from: string, to: string, all = false): string {
  expect(source.includes(from), `test fixture: '${from}' not found`).toBe(true);
  return all ? source.split(from).join(to) : source.replace(from, to);
}
const rules = (source: string, file = 'ci.yml'): string[] => [...new Set(checkWorkflow(file, source).map((f) => f.rule))];

describe('the committed workflows', () => {
  it('pass every rule', () => {
    expect(checkWorkflow('ci.yml', CI)).toEqual([]);
    expect(checkWorkflow('safety-review.yml', REVIEW)).toEqual([]);
  });

  it('the deploy steps hand wrangler the written deployment configuration only', () => {
    for (const env of ['staging', 'production']) {
      expect(CI).toContain(`run: node tools/gates/src/deploy/preflight.ts workers/run/wrangler.jsonc ${env} --write workers/run/wrangler.deploy.json`);
    }
    const deploys = CI.split('\n').filter((l) => /wrangler deploy /.test(l));
    expect(deploys).toHaveLength(2);
    for (const l of deploys) {
      expect(l).toContain('--config workers/run/wrangler.deploy.json');
      expect(l).not.toContain('wrangler.jsonc');
    }
  });
});

describe('deploy-config', () => {
  it('fails when a deploy step hands wrangler the checkout configuration (the original deploy command)', () => {
    const bad = mutate(CI, '--config workers/run/wrangler.deploy.json --env staging', '--config workers/run/wrangler.jsonc --env staging');
    expect(rules(bad)).toContain('deploy-config');
  });

  it('fails when a deploy step names no configuration at all (wrangler would find wrangler.jsonc itself)', () => {
    const bad = mutate(CI, ' --config workers/run/wrangler.deploy.json --assets deploy-site', ' --assets deploy-site');
    expect(rules(bad)).toContain('deploy-config');
  });

  // wrangler resolves --config after --cwd and loads its environment from --env-file or the
  // working directory's dotenv files, so the configuration must be the exact token and those
  // options are refused (P0-04 review, adversarial pass).
  for (const [label, to] of [
    ['a configuration path that merely starts with the written one', '--config workers/run/wrangler.deploy.json.x --env staging'],
    ['--cwd (another working directory: other dotenv files, the configuration resolved elsewhere)', '--config workers/run/wrangler.deploy.json --cwd /tmp/x --env staging'],
    ['--env-file (an environment file of the checkout)', '--config workers/run/wrangler.deploy.json --env-file .env.x --env staging'],
    ['a second configuration option', '--config=workers/run/wrangler.jsonc --config workers/run/wrangler.deploy.json --env staging'],
    ['the short configuration option', '-c workers/run/wrangler.deploy.json --env staging'],
  ] as const) {
    it(`fails when a wrangler invocation uses ${label}`, () => {
      const bad = mutate(CI, '--config workers/run/wrangler.deploy.json --env staging', to);
      expect(rules(bad)).toContain('deploy-config');
    });
  }

  it('fails when the preflight no longer writes the deployment configuration', () => {
    const bad = mutate(CI, 'wrangler.jsonc production --write workers/run/wrangler.deploy.json', 'wrangler.jsonc production');
    expect(rules(bad)).toContain('deploy-config');
  });

  it('fails when another step writes or edits the deployment configuration', () => {
    const bad = mutate(
      CI,
      '      - name: Deploy the attested artifact to staging\n',
      '      - name: Tweak\n        run: echo "{}" > workers/run/wrangler.deploy.json\n      - name: Deploy the attested artifact to staging\n',
    );
    expect(rules(bad)).toContain('deploy-config');
  });

  it('fails when the deploy runs before the preflight', () => {
    const preflightStep =
      '      - name: Preflight (dedicated account D34, workers.dev and preview URLs off H45)\n        env:\n          CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}\n        run: node tools/gates/src/deploy/preflight.ts workers/run/wrangler.jsonc production --write workers/run/wrangler.deploy.json\n';
    const without = mutate(CI, preflightStep, '');
    const moved = mutate(without, '      - name: Post-deploy smoke test (headers, preview URLs, health, DNSSEC, CAA, certificate)\n        env:\n          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n          CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}\n          RUN_WORKERS_DEV_SUBDOMAIN: ${{ vars.RUN_WORKERS_DEV_SUBDOMAIN }}\n        run: node tools/gates/src/smoke/cli.ts --env production\n', `${preflightStep}      - name: Post-deploy smoke test (headers, preview URLs, health, DNSSEC, CAA, certificate)\n        env:\n          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}\n          CLOUDFLARE_ACCOUNT_ID: \${{ vars.CLOUDFLARE_ACCOUNT_ID }}\n          RUN_WORKERS_DEV_SUBDOMAIN: \${{ vars.RUN_WORKERS_DEV_SUBDOMAIN }}\n        run: node tools/gates/src/smoke/cli.ts --env production\n`);
    expect(rules(moved)).toContain('deploy-config');
  });
});

describe('smoke-credentials', () => {
  const preDeploy = '      - name: Staging must already be behind Cloudflare Access (D31)\n';

  it('fails on the regression: the pre-deploy Access check without the token and account', () => {
    const bad = mutate(
      CI,
      `${preDeploy}        env:\n          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}\n          CLOUDFLARE_ACCOUNT_ID: \${{ vars.CLOUDFLARE_ACCOUNT_ID }}\n`,
      preDeploy,
    );
    const findings = checkWorkflow('ci.yml', bad).filter((f) => f.rule === 'smoke-credentials');
    expect(findings.length).toBe(2);
    expect(findings.map((f) => f.message).join('\n')).toMatch(/CLOUDFLARE_API_TOKEN/);
    expect(findings.map((f) => f.message).join('\n')).toMatch(/CLOUDFLARE_ACCOUNT_ID/);
  });

  it('fails when only the account is missing, or when the token comes from the wrong place', () => {
    const noAccount = mutate(
      CI,
      `${preDeploy}        env:\n          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}\n          CLOUDFLARE_ACCOUNT_ID: \${{ vars.CLOUDFLARE_ACCOUNT_ID }}\n`,
      `${preDeploy}        env:\n          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}\n`,
    );
    expect(rules(noAccount)).toContain('smoke-credentials');
    const wrongToken = mutate(
      CI,
      `${preDeploy}        env:\n          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}\n`,
      `${preDeploy}        env:\n          CLOUDFLARE_API_TOKEN: \${{ vars.CLOUDFLARE_API_TOKEN }}\n`,
    );
    expect(rules(wrongToken)).toContain('smoke-credentials');
  });

  it('fails when a post-deploy smoke step loses its credentials', () => {
    const bad = mutate(
      CI,
      '        env:\n          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n          CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}\n          RUN_WORKERS_DEV_SUBDOMAIN: ${{ vars.RUN_WORKERS_DEV_SUBDOMAIN }}\n        run: node tools/gates/src/smoke/cli.ts --env production\n',
      '        env:\n          RUN_WORKERS_DEV_SUBDOMAIN: ${{ vars.RUN_WORKERS_DEV_SUBDOMAIN }}\n        run: node tools/gates/src/smoke/cli.ts --env production\n',
    );
    expect(rules(bad)).toContain('smoke-credentials');
  });

  it('every staging deploy job still runs the pre-deploy Access check', () => {
    const bad = mutate(CI, '        run: node tools/gates/src/smoke/cli.ts --env staging --pre-deploy\n', '        run: "true"\n');
    expect(rules(bad)).toContain('smoke-credentials');
  });
});

describe('safety-review-job', () => {
  it("fails on the reviewer's reproduction: the final enforcement step replaced with run: true", () => {
    const index = REVIEW.lastIndexOf('        run: |');
    const bad = `${REVIEW.slice(0, index)}        run: true\n`;
    expect(rules(bad, 'safety-review.yml')).toContain('safety-review-job');
  });

  it('fails when the gate runs from the PR head instead of the base commit', () => {
    const bad = mutate(REVIEW, 'ref: ${{ github.event.pull_request.base.sha }}', 'ref: ${{ github.event.pull_request.head.sha }}');
    expect(rules(bad, 'safety-review.yml')).toContain('safety-review-job');
  });

  it('fails when the reviewers’ repository permissions are not fetched or not passed', () => {
    const noFetch = mutate(REVIEW, '/permission"', '/nothing"');
    expect(rules(noFetch, 'safety-review.yml')).toContain('safety-review-job');
    const noPass = mutate(REVIEW, '            --permissions "$RUNNER_TEMP/permissions.json" \\\n', '');
    expect(rules(noPass, 'safety-review.yml')).toContain('safety-review-job');
  });

  it('fails when the D40 review record is not fetched, not bound to the head, or not passed to the gate', () => {
    const otherPath = mutate(REVIEW, 'record="docs/safety/reviews/pr-$PR_NUMBER.md"', 'record="docs/safety/reviews/any.md"');
    expect(rules(otherPath, 'safety-review.yml')).toContain('safety-review-job');
    const noFetch = mutate(REVIEW, '/contents/$record?ref=$HEAD_SHA"', '/contents/$record?ref=main"');
    expect(rules(noFetch, 'safety-review.yml')).toContain('safety-review-job');
    const noCompare = mutate(REVIEW, '/compare/$reviewed...$HEAD_SHA"', '/compare/$reviewed...$reviewed"');
    expect(rules(noCompare, 'safety-review.yml')).toContain('safety-review-job');
    const noRecord = mutate(REVIEW, '            --record "$RUNNER_TEMP/review-record.md" \\\n', '');
    expect(rules(noRecord, 'safety-review.yml')).toContain('safety-review-job');
    const noBinding = mutate(REVIEW, '            --record-compare "$RUNNER_TEMP/review-compare.json"\n', '');
    expect(rules(noBinding, 'safety-review.yml')).toContain('safety-review-job');
  });

  it('applies to the workflow file however it is named on the command line', () => {
    const index = REVIEW.lastIndexOf('        run: |');
    const bad = `${REVIEW.slice(0, index)}        run: true\n`;
    expect(rules(bad, '.github/workflows/safety-review.yml')).toContain('safety-review-job');
  });
});

describe('the staging pre-deploy Access check without credentials (the regression, end to end)', () => {
  /** Runs the real CLI with outbound fetch replaced by a stub that records and refuses. */
  function preDeploy(env: Record<string, string>): { status: number | null; output: string; apiCalls: number } {
    const stub = [
      "let n = 0;",
      "globalThis.fetch = async (url) => { if (String(url).startsWith('https://api.cloudflare.com/')) n += 1; throw new Error('test: outbound blocked'); };",
      "process.on('exit', () => process.stderr.write(`\\nAPI-CALLS=${n}\\n`));",
    ].join('\n');
    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
    for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) if (!(key in env)) delete childEnv[key];
    const r = spawnSync(
      process.execPath,
      ['--import', `data:text/javascript,${encodeURIComponent(stub)}`, join(REPO_ROOT, 'tools/gates/src/smoke/cli.ts'), '--env', 'staging', '--pre-deploy'],
      { encoding: 'utf8', env: childEnv },
    );
    const output = `${r.stdout}${r.stderr}`;
    return { status: r.status, output, apiCalls: Number(/API-CALLS=(\d+)/.exec(output)?.[1] ?? 'NaN') };
  }

  it('refuses (exit 1), names each missing variable and the step that must pass it, and calls no API', () => {
    const none = preDeploy({});
    expect(none.status).toBe(1);
    expect(none.output).toContain('CLOUDFLARE_API_TOKEN is not set');
    expect(none.output).toContain('CLOUDFLARE_ACCOUNT_ID is not set');
    expect(none.output).toMatch(/env: of this workflow step/);
    expect(none.apiCalls).toBe(0);
    const tokenOnly = preDeploy({ CLOUDFLARE_API_TOKEN: 'x' });
    expect(tokenOnly.status).toBe(1);
    expect(tokenOnly.output).not.toContain('CLOUDFLARE_API_TOKEN is not set');
    expect(tokenOnly.output).toContain('CLOUDFLARE_ACCOUNT_ID is not set');
    expect(tokenOnly.apiCalls).toBe(0);
  });

  it('with both set, it asks the API (and still fails closed when the API is unreachable)', () => {
    const r = preDeploy({ CLOUDFLARE_API_TOKEN: 'x', CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef' });
    expect(r.status).toBe(1);
    expect(r.apiCalls).toBeGreaterThan(0);
    expect(r.output).toContain('could not complete');
  });
});

describe('file naming', () => {
  it('the ci.yml rules apply when the file is named by its path', () => {
    const bad = mutate(CI, '--config workers/run/wrangler.deploy.json --env staging', '--config workers/run/wrangler.jsonc --env staging');
    expect(rules(bad, '.github/workflows/ci.yml')).toContain('deploy-config');
  });
});
