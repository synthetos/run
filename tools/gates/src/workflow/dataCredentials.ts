/** Exact staging steps only: new permissions cannot escape to arbitrary commands. */
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
export function dataStep(step:readonly Line[], job:string, expected:readonly string[]):boolean {
 return job==='deploy-staging' && step.length===expected.length && step.every((line,i)=>!line.inBlock && line.text===expected[i] && line.indent===(i===0?6:i===1||i===expected.length-1?8:10));
}
