/**
 * The committed static-assets `_headers` file is exactly what headers.ts
 * renders (ROADMAP P0-04). Cloudflare applies it to every asset response,
 * where the Worker never runs, so drift would serve the shell with weaker
 * headers than the API.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderHeadersFile } from '../../../workers/run/src/headers.ts';
import { REPO_ROOT } from './scratch.ts';

describe('apps/web/public/_headers', () => {
  it('is byte-identical to renderHeadersFile() (regenerate with `pnpm gen:headers`)', () => {
    expect(readFileSync(join(REPO_ROOT, 'apps/web/public/_headers'), 'utf8')).toBe(renderHeadersFile());
  });
});
