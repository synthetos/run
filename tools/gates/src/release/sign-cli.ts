/**
 * DEV ONLY. Re-signs firmware/approved-builds.json from
 * firmware/approved-builds.unsigned.json.
 *
 *   pnpm sign:builds --key /path/outside/the/repo/release.pkcs8.pem --kid <key id>
 *
 * The key file must live outside the repository (it is refused otherwise),
 * and its public half must be listed in packages/protocol/src/releaseKeys.ts
 * under the same kid, authorised for each channel's environment, or the app
 * will reject the channel. See docs/ops/release-key.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { importPrivateKey, renderSignedManifest, signManifest } from './approvedBuilds.ts';
import type { UnsignedManifest } from './approvedBuilds.ts';

const root = resolve(import.meta.dirname, '../../../..');
const { values } = parseArgs({ options: { key: { type: 'string' }, kid: { type: 'string' } } });
if (values.key === undefined || values.kid === undefined) {
  process.stderr.write('usage: pnpm sign:builds --key <pkcs8.pem outside the repo> --kid <key id>\n');
  process.exit(2);
}
const keyPath = resolve(values.key);
if (!relative(root, keyPath).startsWith('..')) {
  process.stderr.write('sign:builds: refusing a key file inside the repository\n');
  process.exit(2);
}
const unsigned = JSON.parse(readFileSync(resolve(root, 'firmware/approved-builds.unsigned.json'), 'utf8')) as UnsignedManifest;
const key = await importPrivateKey(readFileSync(keyPath, 'utf8'));
const signed = await signManifest(unsigned, key, values.kid);
writeFileSync(resolve(root, 'firmware/approved-builds.json'), renderSignedManifest(signed));
process.stdout.write(`sign:builds: signed ${signed.channels.length} channel(s) with ${values.kid}\n`);
