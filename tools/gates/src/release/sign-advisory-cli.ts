/**
 * DEV ONLY. Re-signs apps/web/public/safety-advisory.json from
 * apps/web/advisory/safety-advisory.unsigned.json.
 *
 *   pnpm sign:advisory --key /path/outside/the/repo/release.pkcs8.pem --kid <key id>
 *
 * Same key rules as sign:builds (docs/ops/release-key.md): the key file must
 * live outside the repository, and its public half must be in
 * packages/protocol/src/releaseKeys.ts, authorised for each environment.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isOutsideRepo } from './keyPath.ts';
import { importPrivateKey } from './approvedBuilds.ts';
import { renderSignedAdvisory, signAdvisory } from './safetyAdvisory.ts';
import type { UnsignedAdvisory } from './safetyAdvisory.ts';

const root = resolve(import.meta.dirname, '../../../..');
const { values } = parseArgs({ options: { key: { type: 'string' }, kid: { type: 'string' } } });
if (values.key === undefined || values.kid === undefined) {
  process.stderr.write('usage: pnpm sign:advisory --key <pkcs8.pem outside the repo> --kid <key id>\n');
  process.exit(2);
}
const keyPath = resolve(values.key);
if (!isOutsideRepo(root, keyPath)) {
  process.stderr.write('sign:advisory: refusing a key file inside the repository\n');
  process.exit(2);
}
const unsigned = JSON.parse(readFileSync(resolve(root, 'apps/web/advisory/safety-advisory.unsigned.json'), 'utf8')) as UnsignedAdvisory;
const key = await importPrivateKey(readFileSync(keyPath, 'utf8'));
const signed = await signAdvisory(unsigned, key, values.kid);
writeFileSync(resolve(root, 'apps/web/public/safety-advisory.json'), renderSignedAdvisory(signed));
process.stdout.write(`sign:advisory: signed ${signed.advisories.length} environment(s) with ${values.kid}\n`);
