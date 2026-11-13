/** Owner option C, 2026-11-13: exact provisioning and attested private-Worker deploy steps only. */
interface Line { readonly text: string; readonly indent: number; readonly inBlock: boolean }
export function backupProvision(environment: string): string[] {
  return ['- name: Provision private backup resources', 'env:',
    'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
    'CLOUDFLARE_D1_API_TOKEN: ${{ secrets.CLOUDFLARE_D1_API_TOKEN }}',
    'CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}',
    `run: node tools/backups/provision-worker.mjs ${environment}`];
}
export const BACKUP_DEPLOY = ['- name: Deploy attested private backup Worker', 'env:',
  'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
  'CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}',
  'run: ci/deploy-toolchain/node_modules/.bin/wrangler deploy worker/backup/index.mjs --no-bundle --config workers/backup/wrangler.deploy.json'];
export function backupStep(step: readonly Line[], job: string, deploy = false): boolean {
  if (!['deploy-staging', 'deploy-production'].includes(job)) return false;
  const expected = deploy ? BACKUP_DEPLOY : backupProvision(job.slice(7));
  return step.length === expected.length && step.every((line, i) => !line.inBlock && line.text === expected[i] && line.indent === (i === 0 ? 6 : i === 1 || i === expected.length - 1 ? 8 : 10));
}
