import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from './fixtures.ts';
import { setupRecord } from './accountRecords.ts';
import { SEED_TOOLS } from '../../../apps/web/src/workspace/librarySeed.ts';
import type { CloudRecord } from '../../../packages/contracts/src/records.ts';
const localTool = { ...SEED_TOOLS[0]!.tool, id: 'mine.browser', name: 'Browser end mill' };
const accountTool = { ...SEED_TOOLS[0]!.tool, id: 'mine.account', name: 'Account end mill' };
/** Spec §5.5: a signed-in page shows account records only; what was in this browser is never copied up. */
for (const theme of ['light', 'dark']) test(`account library shows account records only and saved state (${theme})`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(({ tool, theme }) => {
    if (localStorage.getItem('run.ws.tools.v2') === null) localStorage.setItem('run.ws.tools.v2', JSON.stringify({ v: 1, value: [{ tool, number: 8, store: null }] }));
    localStorage.setItem('run.theme', theme);
  }, { tool: localTool, theme });
  // An account with no machine would open the setup wizard over the page (spec §6.1); this account dismissed it.
  const records = new Map<string, CloudRecord>([
    ['mine.account', { id: 'mine.account', kind: 'tool', rev: 1, archivedAt: null, content: accountTool, sha256: 'a'.repeat(64) }],
    ['setup', setupRecord({ dismissed: true })],
  ]);
  let writes = 0;
  await page.route('**/api/session', route => route.fulfill({ json: { account: { subject: 'usr_alice', display: '@alice', canConnect: true }, signIn: true } }));
  await page.route('**/api/identity', route => route.fulfill({ json: { identity: { provider: 'run-session', subject: 'usr_alice' } } }));
  await page.route('**/api/records/**', async route => {
    const path = new URL(route.request().url()).pathname.split('/'); const kind = path[3] as 'tool' | 'material' | 'setup';
    if (route.request().method() === 'GET') return route.fulfill({ json: { records: [...records.values()].filter(r => r.kind === kind) } });
    writes++; return route.fulfill({ status: 500, json: { error: 'unexpected write' } });
  });
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
  await expect(page.locator('[data-dialog="library-import"]')).toHaveCount(0);
  await page.locator('[data-region="rail"] [data-view="library"]').click();
  await page.locator('#library-tab-tools').click();
  await expect(page.locator('.tools-view .sync-line')).toHaveText('Saved to your account');
  await expect(page.locator('.tools-view')).toContainText('Account end mill');
  await expect(page.locator('.tools-view')).not.toContainText('Browser end mill');
  const screens = resolve('../../screens'); await mkdir(screens, { recursive: true });
  await page.screenshot({ path: `${screens}/library-saved-${theme}.png` });
  expect(writes).toBe(0);
  const local = await page.evaluate(() => localStorage.getItem('run.ws.tools.v2'));
  expect(JSON.parse(local!).value[0].tool.name).toBe('Browser end mill');
});
