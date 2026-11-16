import type { CloudRecord, RecordKind } from '../../../packages/contracts/src/records.ts';
import { SEED_TOOLS } from '../../../apps/web/src/workspace/librarySeed.ts';
import { BUILTIN_MATERIALS } from '../../../packages/library/src/index.ts';
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';

for (const theme of ['light', 'dark']) test(`browser copy includes four kinds and uploads project files first (${theme})`, async ({ page }, testInfo) => {
  const tool = { ...SEED_TOOLS[0]!.tool, id: 'browser.tool', name: 'Browser end mill' };
  const material = { ...BUILTIN_MATERIALS[0]!, id: 'browser.material', name: 'Browser material' };
  const machine = { id: 'browser.machine', name: 'Workshop router', templateId: 'custom', drive: 'any', travel: { x: 500, y: 400, z: 100 }, spindle: '', createdAt: '2026-11-16T12:00:00Z' };
  await page.addInitScript(({ tool, material, machine, theme }) => {
    const save = (key: string, value: unknown) => localStorage.setItem(`run.ws.${key}`, JSON.stringify({ v: 1, value }));
    if (localStorage.getItem('run.ws.machines') === null) { save('machines', [machine]); save('tools.v2', [{ tool, number: 8, store: null }]); save('materials.own.v1', [material]); }
    localStorage.setItem('run.theme', theme);
  }, { tool, material, machine, theme });
  let signedIn = false;
  await page.route('**/api/session', route => route.fulfill({ json: { account: signedIn ? { subject: 'sync-test', display: '@alice' } : null, signIn: true } }));
  await page.route('**/api/identity', route => route.fulfill({ json: { identity: { provider: 'run-session', subject: 'sync-test' } } }));
  const records = new Map<string, CloudRecord>(); const requests: string[] = [];
  await page.route('**/api/records/**', route => {
    const parts = new URL(route.request().url()).pathname.split('/'); const kind = parts[3] as RecordKind;
    if (route.request().method() === 'GET') return route.fulfill({ json: { records: [...records.values()].filter(r => r.kind === kind) } });
    const body = route.request().postDataJSON() as { parent_rev: number | null; content: unknown };
    requests.push(`record:${kind}`);
    const record: CloudRecord = { kind, id: parts[4]!, rev: (body.parent_rev ?? 0) + 1, content: body.content, archivedAt: null, sha256: 'a'.repeat(64) };
    records.set(`${kind}:${record.id}`, record); return route.fulfill({ json: { record } });
  });
  await page.route('**/api/files/**', route => {
    expect(route.request().method()).toBe('PUT'); requests.push('file');
    expect(route.request().postDataBuffer()?.toString()).toBe('G0 X1\n');
    return route.fulfill({ status: 201, json: { ok: true } });
  });
  await page.goto('/'); await ready(page);
  await page.locator('[data-region="rail"] [data-view="projects"]').click();
  await page.locator('[data-action="project-new"]').click();
  await page.locator('[data-project="file-input"]').setInputFiles({ name: 'plate.nc', mimeType: 'text/plain', buffer: Buffer.from('G0 X1\n') });
  await expect(page.locator('[data-project-file="plate.nc"]')).toBeVisible();
  signedIn = true; await page.reload(); await ready(page);
  const dialog = page.locator('[data-dialog="library-import"]');
  await expect(dialog.locator('[data-import-counts]')).toHaveText('1 tool, 1 material, 1 machine, 1 project');
  expect(requests).toEqual([]);
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.locator('[data-region="rail"] [data-view="projects"]').click();
  await expect(page.locator('[data-project-saved]')).toHaveText('Saved to your account');
  expect(requests.indexOf('file')).toBeLessThan(requests.indexOf('record:project'));
  expect(requests.filter(r => r.startsWith('record:'))).toHaveLength(4);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath(`projects-sync-${theme}.png`), fullPage: true });
  await page.reload(); await ready(page); await expect(dialog).toHaveCount(0);
  await page.locator('[data-region="rail"] [data-view="projects"]').click();
  await expect(page.locator('[data-project-file="plate.nc"]')).toBeVisible();
  expect(requests.filter(r => r.startsWith('record:'))).toHaveLength(4);
});
