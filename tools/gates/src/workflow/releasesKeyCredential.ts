/**
 * The read-only GitHub key for the TinyG release list (owner 2026-11-19: GitHub
 * refuses keyless calls from Cloudflare's shared addresses). It reaches the run
 * Worker only as a secret uploaded with the deploy, so it is confined to the
 * exact reviewed Worker deploy step of each environment: no other step, job,
 * command or action is admitted with it.
 */
import { D1_SECRET } from './d1Credentials.ts';

/** Every deploy-job credential rule in one import for policy.ts (its file length is capped by the modularity baseline). */
export { D1_SECRET, d1ReadinessIsConfined, d1StepIsConfined } from './d1Credentials.ts';

export const RELEASES_KEY_SECRET = 'RUN_GITHUB_RELEASES_TOKEN';

interface StepLine {
  readonly text: string;
  readonly indent: number;
  readonly inBlock: boolean;
}

const SECRETS_FILE = '"$RUNNER_TEMP/run-worker-keys.json"';

/** The reviewed deploy step, line by line (block lines without their indentation). */
export function releasesKeyDeployStep(environment: string): readonly string[] {
  return [
    `- name: Deploy the attested artifact to ${environment}`,
    'id: deploy',
    'env:',
    'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
    'CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}',
    `${RELEASES_KEY_SECRET}: \${{ secrets.${RELEASES_KEY_SECRET} }}`,
    'run: |',
    `node tools/gates/src/deploy/releasesKey-cli.ts ${SECRETS_FILE}`,
    'set --',
    `if [ -f ${SECRETS_FILE} ]; then set -- --secrets-file ${SECRETS_FILE}; fi`,
    `ci/deploy-toolchain/node_modules/.bin/wrangler deploy worker/index.mjs --no-bundle --config workers/run/wrangler.deploy.json${environment === 'staging' ? ' --env staging' : ''} --assets deploy-site "$@"`,
    `rm -f ${SECRETS_FILE}`,
  ];
}

/** Whether a deploy-job secret other than the deploy token is admitted here: the D1 token by its own rules, this key only in its step. */
export function confinedSecret(name: string | undefined, step: readonly StepLine[], environment: string, d1Admits: () => boolean): boolean {
  if (name === D1_SECRET) return d1Admits();
  // `undefined`: the bare word in wrangler's `--secrets-file` flag, admitted only inside this pinned step.
  return (name === RELEASES_KEY_SECRET || name === undefined) && releasesKeyIsConfined(step, environment);
}

/** True only for the exact reviewed deploy step of this environment. */
export function releasesKeyIsConfined(step: readonly StepLine[], environment: string): boolean {
  const expected = releasesKeyDeployStep(environment);
  const lines = step.filter(line => line.text !== '');
  const indents = [6, 8, 8, 10, 10, 10, 8];
  return lines.length === expected.length && lines.every((line, index) => line.text === expected[index] && (index < indents.length ? !line.inBlock && line.indent === indents[index] : line.inBlock));
}
