/**
 * The suite tests what is on disk, byte for byte (ROADMAP P0-06: "runs
 * Playwright against wrangler dev serving the attested artifact").
 *
 * In artifact mode the served site tree is the extracted, manifest-verified
 * artifact; in source mode it is apps/web/dist. Either way, every file is
 * served unchanged at its path, `_headers` is never served, and a not-found
 * response is the built 404.html. So the headers, CSP and origin results of
 * every other spec hold for exactly these bytes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { servedPath, siteFiles } from '../src/served.ts';
import { expect, test } from './fixtures.ts';

test('every file of the served site tree is served unchanged at its path', async ({ request, served }) => {
  const files = siteFiles(served.siteDir);
  expect(files).toContain('index.html');
  let compared = 0;
  for (const file of files) {
    const path = servedPath(file);
    if (path === undefined) continue;
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(200);
    expect(Buffer.from(await res.body()).equals(readFileSync(join(served.siteDir, file))), `${path} differs from ${file} on disk`).toBe(true);
    compared++;
  }
  expect(compared).toBe(files.length - 2);
});

test('_headers is not served, and a not-found response is the built 404.html', async ({ request, served }) => {
  const notFound = readFileSync(join(served.siteDir, '404.html'));
  for (const path of ['/_headers', '/no-such-page']) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(404);
    expect(Buffer.from(await res.body()).equals(notFound), path).toBe(true);
  }
});
