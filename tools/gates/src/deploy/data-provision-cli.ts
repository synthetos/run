import { readFileSync, writeFileSync } from 'node:fs';
import { provisionData } from './dataProvision.ts';
import { dataDeployConfig } from './dataConfig.ts';
try {
  const account=process.env['CLOUDFLARE_ACCOUNT_ID'] ?? '';
  const run=JSON.parse(readFileSync('workers/run/wrangler.deploy.json','utf8')) as {account_id:string};
  if (run.account_id !== account) throw new Error('CLOUDFLARE_ACCOUNT_ID differs from the reviewed account');
  const id=await provisionData(account,process.env['CLOUDFLARE_API_TOKEN'] ?? '',process.env['CLOUDFLARE_D1_API_TOKEN'] ?? '');
  writeFileSync('workers/run-data/wrangler.deploy.json',JSON.stringify(dataDeployConfig(account,id),null,2)+'\n',{flag:'wx'});
  process.stdout.write('Staging data resources ready; migration and attested deployment required.\n');
} catch(e) { process.stderr.write(`${e instanceof Error ? e.message : 'Data provisioning failed'}\n`); process.exitCode=1; }
