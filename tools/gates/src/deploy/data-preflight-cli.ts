/** Prepare only reviewed production data resources; placeholders never reach wrangler. No API calls. */
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { productionDataConfig } from './dataConfig.ts';
import { parseJsonc } from './wranglerConfig.ts';
try {
  if (readdirSync(process.cwd()).some(name => /^\.env(\.|$)/i.test(name))) throw new Error('A dotenv file is not allowed in the deployment directory');
  const account = process.env['CLOUDFLARE_ACCOUNT_ID'] ?? '';
  const config = productionDataConfig(parseJsonc(readFileSync('workers/run-data/wrangler.jsonc', 'utf8')), account);
  if (config !== null) {
    if (process.env['RUN_DATA_MIGRATIONS_READY'] !== 'true') throw new Error('Production data requires CLOUDFLARE_D1_API_TOKEN for migrations');
    writeFileSync('workers/run-data/wrangler.deploy.json', JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
  }
  const output = process.env['GITHUB_OUTPUT'];
  if (output !== undefined) appendFileSync(output, `ready=${config !== null}\n`);
  process.stdout.write(config === null ? 'Production storage off: reviewed data resource placeholders remain.\n' : 'Production data configured; migrations and attested Worker deployment required before Run.\n');
} catch (error) {
  process.stderr.write(`Data preflight refused: ${error instanceof Error ? error.message : 'invalid configuration'}\n`);
  process.exitCode = 1;
}
