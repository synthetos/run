/** Exact data steps only: new permissions cannot escape to arbitrary commands. */
interface Line { readonly text:string; readonly indent:number; readonly inBlock:boolean }
export const DATA_PROVISION = [
 '- name: Provision staging data resources', 'env:',
 'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
 'CLOUDFLARE_D1_API_TOKEN: ${{ secrets.CLOUDFLARE_D1_API_TOKEN }}',
 'CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}',
 'run: node tools/gates/src/deploy/data-provision-cli.ts',
];
export const DATA_MIGRATION = [
 '- name: Apply staging data migrations', 'env:',
 'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_D1_API_TOKEN }}',
 'CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}',
 'run: ci/deploy-toolchain/node_modules/.bin/wrangler d1 migrations apply RUN_DATA_DB --remote --config workers/run-data/wrangler.deploy.json',
];
export const DATA_DEPLOY = [
 '- name: Deploy attested staging data Worker', 'env:',
 'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
 'CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}',
 'run: ci/deploy-toolchain/node_modules/.bin/wrangler deploy worker/data/index.mjs --no-bundle --config workers/run-data/wrangler.deploy.json',
];
export const DATA_PREFLIGHT = [
 '- name: Prepare reviewed production data configuration', 'id: data_config', 'env:',
 'CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}',
 "RUN_DATA_MIGRATIONS_READY: ${{ secrets.CLOUDFLARE_D1_API_TOKEN != '' }}",
 'run: node tools/gates/src/deploy/data-preflight-cli.ts',
];
export function dataStep(step: readonly Line[], job: string, expected: readonly string[]): boolean {
 if (!['deploy-staging', 'deploy-production'].includes(job)) return false;
 const lines = [...expected];
 if (job === 'deploy-production' && expected !== DATA_PREFLIGHT) {
   if (expected === DATA_PROVISION) return false;
   lines[0] = lines[0]!.replace('staging', 'production');
   lines.splice(1, 0, "if: steps.data_config.outputs.ready == 'true'");
 }
 if (job === 'deploy-staging' && expected === DATA_PREFLIGHT) return false;
 return step.length === lines.length && step.every((line, i) => !line.inBlock && line.text === lines[i] && line.indent === (i === 0 ? 6 : /^(env:|id:|if:|run:)/.test(line.text) ? 8 : 10));
}
interface NumberedLine extends Line { readonly no: number }
/** Both pipelines must finish data deployment before the site, without bypassable conditions. */
export function dataOrder<T extends NumberedLine>(lines: readonly T[], job: string, step: (line: T) => readonly T[]): string[] {
 const first = job === 'deploy-staging' ? DATA_PROVISION : DATA_PREFLIGHT;
 const stages = [first, DATA_MIGRATION, DATA_DEPLOY].map(expected => lines.find(l => l.text === expected[expected.length - 1] && dataStep(step(l), job, expected))?.no);
 const site = lines.find(l => /wrangler deploy worker\/index.mjs /.test(l.text))?.no;
 const preflight = lines.find(l => l.text.startsWith('run: node tools/gates/src/deploy/preflight.ts '))?.no;
 if (stages.some(n => n === undefined) || site === undefined || preflight === undefined) return ['data preparation, migrations and attested deploy require their exact confined steps'];
 const [prepare, migrate, deploy] = stages as [number, number, number];
 if (migrate <= prepare || deploy <= migrate || site <= deploy || migrate <= preflight || (job === 'deploy-staging' ? prepare <= preflight : prepare >= preflight)) return ['data preparation, migrations and deploy must precede run deployment in order'];
 return [];
}

export function dataProvisionOrPreflight(step: readonly Line[], job: string): boolean {
 return dataStep(step, job, DATA_PROVISION) || dataStep(step, job, DATA_PREFLIGHT);
}
