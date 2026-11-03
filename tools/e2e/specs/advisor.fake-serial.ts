import { expect, test } from './fixtures.ts';

test('sample advisor shows inputs, three levels, guarded preview and a non-blocking job check', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('run.ws.machines', JSON.stringify({ v: 1, value: [{ id: 'advisor-test', name: 'Advisor test machine', templateId: 'custom', drive: 'belt', travel: { x: 300, y: 300, z: 100 }, spindle: 'Test spindle', createdAt: '2026-11-03' }] }));
    localStorage.setItem('run.ws.machine-selected', JSON.stringify({ v: 1, value: 'advisor-test' }));
  });
  await page.reload();
  await page.locator('[data-sample="test-square"]').click();
  await page.locator('[data-job-step="check"]').click();
  await expect(page.locator('[data-preview="summary"]')).toBeVisible();
  await page.locator('[data-job-step="run"]').click();
  await expect(page.locator('[data-job="advisor"]')).toContainText('Feeds: needs review');
  await expect(page.locator('[data-action="start-job"]')).toBeDisabled();
  await page.locator('[data-job-panel="run"] [data-action="advisor-open"]').click();
  const view = page.locator('[data-screen="analyze"]');
  await expect(view).toBeVisible();
  await expect(view.locator('[data-advisor="table"]')).toHaveCount(2); // plunge and XY feed
  for (const [key, value] of Object.entries({ frame: 'medium', spindle: 'vfd' })) await view.locator(`[data-advisor-field="${key}"]`).selectOption(value);
  for (const [key, value] of Object.entries({ minRpm: '6000', maxRpm: '24000', powerKw: '1.5', xy: '5000', z: '1000', accel: '100', junction: '0.05' })) await view.locator(`[data-advisor-field="${key}"]`).fill(value);
  for (const op of await view.locator('[data-advisor-operation]').all()) {
    await op.locator('[data-advisor-field="tool"]').selectOption('1');
    await op.locator('[data-advisor-field="kind"]').selectOption('pocket');
    await op.locator('[data-advisor-field="ap"]').fill('1');
    await op.locator('[data-advisor-field="ae"]').fill('1');
    await op.locator('[data-advisor-field="coolant"]').selectOption('air');
    await expect(op.locator('[data-advisor="placeholder"]')).toContainText('not advice');
    await expect(op.locator('[data-advisor="table"]')).not.toContainText('Unavailable');
    await expect(op.locator('[data-advisor="achievable"]')).toContainText('(estimate;');
  }
  await view.locator('[data-action="advisor-engine"]').selectOption('mock-ai');
  await expect(view.locator('[data-advisor="table"]').first()).toContainText('canned example, not advice');
  await expect(view.locator('[data-advisor="table"]').first().locator('tbody tr').nth(1)).toContainText('1,200');
  const size = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth }));
  expect(size.h).toBeLessThanOrEqual(size.ih);
  expect(size.w).toBeLessThanOrEqual(size.iw);
  await view.locator('details.panel > summary').click();
  await view.locator('.scroll-region').evaluate((el) => { el.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath('analyze.png') });
  await page.locator('[data-region="rail"] [data-view="job"]').click();
  await expect(page.locator('[data-job="advisor"]')).toContainText('placeholder data; not advice');
  await expect(page.locator('[data-action="start-job"]')).toBeDisabled();
  await page.locator('[data-region="job"] [data-preview="file"]').setInputFiles({ name: 'second.nc', mimeType: 'text/plain', buffer: Buffer.from('G21 G90 G17 G94\nS12000 M3\nG1 X10 F600\nM5\nM30\n') });
  await expect(page.locator('[data-job="advisor"]')).toContainText('needs review'); // no inputs carried from previous file
});
