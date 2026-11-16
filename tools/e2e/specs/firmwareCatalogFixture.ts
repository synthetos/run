/**
 * Deterministic public API metadata; browser tests never contact GitHub. The stub answers with the security headers of
 * the deployment the suite stands in for (production, or staging with serial granted: headers.staging.ts checks every
 * subresource), which fixtures.ts reads from the suite's metadata.
 */
import { securityHeadersFor } from '../../../workers/run/src/headers.ts';
import type { Page } from '@playwright/test';
import type { WorkerEnvironment } from '../src/served.ts';
export const FIRMWARE_CATALOG = {
  format: 'synthetos-run/github-releases@1',
  releases: [450.06, 450.05, 450.04, 450.03, 450.02].map(fb => ({
    repo: 'synthetos/TinyG', tag: fb.toFixed(2), file: `tinyg-${fb.toFixed(2)}.hex`,
    date: '2026-11-15T00:00:00Z', notes: 'Release notes from GitHub.', prerelease: true,
    sha256: 'a'.repeat(64), size: 1000, unavailable: null,
  })),
};
export async function stubFirmwareCatalog(page: Page, catalog: unknown = FIRMWARE_CATALOG, environment: WorkerEnvironment = 'production'): Promise<void> {
  const headers = securityHeadersFor(environment === 'staging');
  await page.route('**/api/firmware/releases', route => route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(catalog) }));
}
