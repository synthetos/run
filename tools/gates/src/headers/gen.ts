/**
 * Writes apps/web/public/_headers from src/headers.ts (ROADMAP P0-04).
 *
 *   pnpm gen:headers
 *
 * The file is committed. tools/gates/test/headers-file.test.ts fails
 * whenever the committed file and this generator disagree, and the bundle
 * scan refuses a build whose `_headers` differs, so the asset headers can
 * never drift from the Worker headers.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HEADERS_FILE_MAX_LINE, renderHeadersFile } from '../../../../workers/run/src/headers.ts';

const target = resolve(import.meta.dirname, '../../../../apps/web/public/_headers');
const text = renderHeadersFile();
const long = text.split('\n').find((line) => line.length > HEADERS_FILE_MAX_LINE);
if (long !== undefined) {
  process.stderr.write(`gen-headers: a line exceeds Cloudflare's ${HEADERS_FILE_MAX_LINE}-character limit: ${long.slice(0, 60)}...\n`);
  process.exitCode = 1;
} else {
  writeFileSync(target, text);
  process.stdout.write(`gen-headers: wrote ${target}\n`);
}
