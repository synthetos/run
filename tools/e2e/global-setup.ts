/**
 * The suite tests the BUILT shell (apps/web/dist), as served by the asset
 * layer of `wrangler dev`. Refuse to start against a missing build instead of
 * testing wrangler's empty-directory behaviour. Run `pnpm e2e` from the root,
 * which builds first.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export default function globalSetup(): void {
  const dist = join(import.meta.dirname, '../../apps/web/dist');
  for (const file of ['index.html', 'safety/index.html', 'privacy/index.html', '404.html', '_headers', 'manifest.webmanifest']) {
    if (!existsSync(join(dist, file))) {
      throw new Error(`e2e: ${join(dist, file)} is missing. Build first: pnpm build (or run pnpm e2e from the repository root).`);
    }
  }
}
