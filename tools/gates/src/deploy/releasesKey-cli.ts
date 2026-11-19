/**
 * Writes the run Worker's secrets file when the deploy environment has a GitHub
 * releases key (releasesKey.ts). The key is never printed.
 *
 *   node tools/gates/src/deploy/releasesKey-cli.ts <secrets-file>
 */
import { writeFileSync } from 'node:fs';
import { releasesSecrets } from './releasesKey.ts';

const file = process.argv[2];
if (file === undefined) {
  process.stderr.write('usage: releasesKey-cli.ts <secrets-file>\n');
  process.exit(2);
}
const body = releasesSecrets(process.env['RUN_GITHUB_RELEASES_TOKEN']);
if (body === null) {
  process.stdout.write('releases key: none set; the Worker keeps its current key, if any\n');
} else {
  writeFileSync(file, body, { mode: 0o600 });
  process.stdout.write('releases key: uploading with this deploy\n');
}
