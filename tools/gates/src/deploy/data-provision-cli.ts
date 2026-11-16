import { readFileSync, writeFileSync } from 'node:fs';
import { provisionData } from './dataProvision.ts';
import { dataDeployConfig } from './dataConfig.ts';
import { isDeployEnvironment, parseJsonc } from './wranglerConfig.ts';
try {
  const environment = process.argv[2] ?? 'staging';
  if (!isDeployEnvironment(environment) || process.argv.length > 3) throw new Error('usage: data-provision-cli.ts [staging|production]');
  const account = process.env['CLOUDFLARE_ACCOUNT_ID'] ?? '';
  const file = environment === 'production' ? 'workers/run/wrangler.jsonc' : 'workers/run/wrangler.deploy.json';
  const run = parseJsonc(readFileSync(file, 'utf8')) as { account_id: string };
  if (run.account_id !== account) throw new Error('CLOUDFLARE_ACCOUNT_ID differs from the reviewed account');
  const id = await provisionData(account, process.env['CLOUDFLARE_API_TOKEN'] ?? '', process.env['CLOUDFLARE_D1_API_TOKEN'] ?? '', { environment });
  if (environment === 'production') {
    process.stdout.write(`run-data database id: ${id}\nrun-files bucket name: run-files\nSubmit both in a reviewed PR; nothing has been deployed.\n`);
  } else {
    writeFileSync('workers/run-data/wrangler.deploy.json', JSON.stringify(dataDeployConfig(account, id), null, 2) + '\n', { flag: 'wx' });
    process.stdout.write('Staging data resources ready; migration and attested deployment required.\n');
  }
} catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'Data provisioning failed'}\n`); process.exitCode = 1; }
