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
    'env:',
    D1_TOKEN_LINE,
    'CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}',
    migrationCommand(environment),
  ];
  const indents = [6, 8, 10, 10, 8];
  return step.length === expected.length && step.every((line, index) => !line.inBlock && line.text === expected[index] && line.indent === indents[index]);
}
