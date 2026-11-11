/** A separate D1-only credential, confined to the one reviewed migration command in a deploy step. */
export const D1_SECRET = 'CLOUDFLARE_D1_API_TOKEN';
export const D1_TOKEN_LINE = `CLOUDFLARE_API_TOKEN: \${{ secrets.${D1_SECRET} }}`;

interface StepLine {
  readonly no: number;
  readonly text: string;
  readonly indent: number;
  readonly inBlock: boolean;
}

export function migrationCommand(environment: string): string {
  return `run: ci/deploy-toolchain/node_modules/.bin/wrangler d1 migrations apply RUN_AUTH --remote --config workers/run/wrangler.deploy.json${environment === 'staging' ? ' --env staging' : ''}`;
}

/** No shell block, extra command, inherited token or action is admitted with this credential. */
export function d1StepIsConfined(step: readonly StepLine[], environment: string): boolean {
  const expected = [
    '- name: Apply the reviewed RUN_AUTH migrations before the code (A1-07)',
    "if: steps.config.outputs.run_auth == 'true'",
    'env:',
    D1_TOKEN_LINE,
    'CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}',
    migrationCommand(environment),
  ];
  const indents = [6, 8, 8, 10, 10, 8];
  return step.length === expected.length && step.every((line, index) => !line.inBlock && line.text === expected[index] && line.indent === indents[index]);
}

/** Only a presence boolean reaches preflight; the credential itself stays in the migration step. */
export function d1ReadinessIsConfined(step: readonly StepLine[], environment: string): boolean {
  const expected = [
    '- name: Preflight (account D39, workers.dev and preview URLs off H45)',
    'id: config',
    'env:',
    'CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}',
    "RUN_AUTH_MIGRATIONS_READY: ${{ secrets.CLOUDFLARE_D1_API_TOKEN != '' }}",
    `run: node tools/gates/src/deploy/preflight.ts workers/run/wrangler.jsonc ${environment} --write workers/run/wrangler.deploy.json`,
  ];
  const indents = [6, 8, 8, 10, 10, 8];
  return step.length === expected.length && step.every((line, index) => !line.inBlock && line.text === expected[index] && line.indent === indents[index]);
}
