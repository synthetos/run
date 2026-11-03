/**
 * DEV ONLY. Re-signs firmware/releases.json from firmware/releases.unsigned.json,
 * and regenerates the run Worker's copy of the GitHub-released entries,
 * workers/run/src/firmwareAssets.ts (OD-10).
 *
 *   pnpm sign:releases --key /path/outside/the/repo/key.pkcs8.pem --kid <key id>
 *
 * The key file must live outside the repository (it is refused otherwise),
 * and its public half must be listed in packages/protocol/src/releaseKeys.ts
 * under the same kid, authorised for each manifest's environment, or the app
 * rejects it. Staging is signed with the owner's bench key; production stays
 * out of the file until the owner signs it with the offline release key
 * (docs/ops/firmware-releases.md).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { importPrivateKey } from './approvedBuilds.ts';
import { renderSignedReleases, renderWorkerFirmwareAssets, signReleases, WORKER_FIRMWARE_ASSETS_PATH, type UnsignedReleases } from './firmwareReleases.ts';
import { isOutsideRepo } from './keyPath.ts';

const root = resolve(import.meta.dirname, '../../../..');
const { values } = parseArgs({ options: { key: { type: 'string' }, kid: { type: 'string' } } });
if (values.key === undefined || values.kid === undefined) {
  process.stderr.write('usage: pnpm sign:releases --key <pkcs8.pem outside the repo> --kid <key id>\n');
  process.exit(2);
}
const keyPath = resolve(values.key);
if (!isOutsideRepo(root, keyPath)) {
  process.stderr.write('sign:releases: refusing a key file inside the repository\n');
  process.exit(2);
}
const unsigned = JSON.parse(readFileSync(resolve(root, 'firmware/releases.unsigned.json'), 'utf8')) as UnsignedReleases;
const key = await importPrivateKey(readFileSync(keyPath, 'utf8'));
const signed = await signReleases(unsigned, key, values.kid);
writeFileSync(resolve(root, 'firmware/releases.json'), renderSignedReleases(signed));
writeFileSync(resolve(root, WORKER_FIRMWARE_ASSETS_PATH), renderWorkerFirmwareAssets(signed));
process.stdout.write(`sign:releases: signed ${signed.manifests.length} manifest(s) with ${values.kid}; wrote ${WORKER_FIRMWARE_ASSETS_PATH}\n`);
