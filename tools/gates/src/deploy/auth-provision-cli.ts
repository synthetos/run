import { readFileSync } from 'node:fs';
import { provisionDatabase } from './authProvision.ts';
import { parseJsonc } from './wranglerConfig.ts';
try {
  const account = process.env['CLOUDFLARE_ACCOUNT_ID'] ?? '';
  const config = parseJsonc(readFileSync('workers/run/wrangler.jsonc', 'utf8')) as { account_id?: string };
  if (config.account_id !== account) throw new Error('Account mismatch');
  const id = await provisionDatabase(account, process.env['CLOUDFLARE_D1_API_TOKEN'] ?? '');
  process.stdout.write(`run-auth database id: ${id}\nSubmit this id in a reviewed PR; nothing has been deployed.\n`);
} catch { process.stderr.write('RUN_AUTH provisioning failed. Check the reviewed account and CLOUDFLARE_D1_API_TOKEN (D1: Edit).\n'); process.exitCode = 1; }
