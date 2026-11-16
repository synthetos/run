/** Live controls use acknowledged firmware values, never optimistic button state. */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { connect, open, phase, start, zigzag } from './jobFlow.ts';

async function screens(page: Page, name: string): Promise<void> {
  const dir = process.env['RUN_SCREENSHOTS_DIR'];
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    await page.screenshot({ path: join(dir, `${name}-${theme}.png`), fullPage: true });
  }
}

test('feed +20% and spindle -20% are confirmed while running, and spindle cap is shown', async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await connect(page, { build: { fb: 450.06, fv: 0.97, hv: 8, layout: 10003 }, eeprom: { __layout: 10003, p1csh: 12000 } });
  await open(page, zigzag(100, [], ['M3 S10000']), 'overrides.nc');
  await start(page);
  await expect.poll(() => phase(worker)).toBe('running');
  const controls = page.locator('[data-region="overrides"]');
  const feed = controls.locator('[data-override="feed"]');
  const spindle = controls.locator('[data-override="spindle"]');
  for (const value of [110, 120]) {
    await feed.getByRole('button', { name: 'Feed plus 10%' }).click();
    await expect(feed).toContainText(`${value}% requested`);
  }
  for (const value of [90, 80]) {
    await spindle.getByRole('button', { name: 'Spindle minus 10%' }).click();
    await expect(spindle).toContainText(`${value}% requested`);
  }
  await expect(feed).toContainText('120% in effect');
  await expect(spindle).toContainText('80% in effect');
  await screens(page, 'overrides-running');
  await spindle.getByRole('button', { name: 'Spindle 100%' }).click();
  await expect(spindle).toContainText('100% requested');
  for (const value of [110, 120, 130, 140, 150]) {
    await spindle.getByRole('button', { name: 'Spindle plus 10%' }).click();
    await expect(spindle).toContainText(`${value}% requested`);
  }
  await expect(spindle).toContainText('held at a speed limit');
  await expect(spindle.getByRole('button', { name: 'Spindle plus 10%' })).toBeDisabled();
  await screens(page, 'overrides-capped');
});


test('permissions left by an earlier program disable both controls without changing the request', async ({ page }) => {
  const worker = await connect(page, { build: { fb: 450.06, fv: 0.97, hv: 8, layout: 10003 }, start: 'ready', overrideProgram: { feed: false, spindle: false } });
  await open(page, zigzag(100), 'program-locked.nc');
  await start(page);
  await expect.poll(() => phase(worker)).toBe('running');
  const controls = page.locator('[data-region="overrides"]');
  await expect(controls.getByText('locked by the program', { exact: true })).toHaveCount(2);
  for (const button of await controls.getByRole('button').all()) await expect(button).toBeDisabled();
  await screens(page, 'overrides-locked');
});
