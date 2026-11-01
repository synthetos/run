/**
 * The suite tests a BUILT shell, as served by the asset layer of `wrangler
 * dev`. Refuse to start against a missing build instead of testing
 * wrangler's empty-directory behaviour. In source mode run `pnpm e2e` from
 * the root, which builds first; in artifact mode the Worker directory must
 * hold the built modules as well (src/served.ts).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REQUIRED_SITE_FILES, REQUIRED_WORKER_FILES, servedMode } from './src/served.ts';

export default function globalSetup(): void {
  const mode = servedMode(process.env, process.cwd());
  const missing: string[] = [];
  for (const file of REQUIRED_SITE_FILES) if (!existsSync(join(mode.siteDir, file))) missing.push(join(mode.siteDir, file));
  if (mode.kind === 'artifact') {
    for (const file of REQUIRED_WORKER_FILES) if (!existsSync(join(mode.workerDir, file))) missing.push(join(mode.workerDir, file));
  }
  if (missing.length > 0) {
    const hint =
      mode.kind === 'source'
        ? 'Build first: pnpm build (or run pnpm e2e from the repository root).'
        : mode.kind === 'fake-serial'
          ? 'Build the test artifact first: pnpm build:fake-serial (or run pnpm e2e:fake-serial from the repository root).'
          : 'Extract and verify the artifact first (docs/ops/ci.md).';
    throw new Error(`e2e (${mode.kind} mode): missing ${missing.join(', ')}. ${hint}`);
  }
  process.stdout.write(`e2e: ${mode.kind} mode, serving ${mode.siteDir}${mode.kind === 'artifact' ? ` with the Worker in ${mode.workerDir}` : ''}\n`);
}
