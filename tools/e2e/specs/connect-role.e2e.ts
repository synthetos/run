/**
 * Role display in the built app. Worker tests cover real session validation and response policy. The same signed-in
 * stub shows the GitHub picture in the top-right account button (owner, 2026-11-18): the page asks only its own
 * origin (`/api/avatar`), stubbed here with a small PNG. RUN_SCREENSHOTS=1 writes the walkthrough pictures to
 * docs/design/screenshots/job-page-cleanup/.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';

const SCREENSHOTS = process.env['RUN_SCREENSHOTS'] === '1';
const SHOT_DIR = new URL('../../../docs/design/screenshots/job-page-cleanup/', import.meta.url).pathname;
const PNG = readFileSync(new URL('../../../apps/web/public/icons/icon-32.png', import.meta.url));

for (const theme of ['light', 'dark'] as const) {
  test(`a member sees the tester notice instead of Connect, and their GitHub picture in the account button (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    await page.route('**/api/session', route => route.fulfill({ json: {
      account: { subject: 'usr_member', display: '@member', canConnect: false }, signIn: true,
    } }));
    await page.route('**/api/avatar', route => route.fulfill({ body: PNG, contentType: 'image/png', headers: { 'cache-control': 'private, max-age=86400' } }));
    await page.goto('/');
    await ready(page);
    const notice = page.locator('[data-region="strip-connection"] [data-connect="role-required"]');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText('Connecting is open to testers for now.');
    await expect(page.locator('[data-action="connect"]')).toHaveCount(0);
    // The picture: same-origin, round, over the cloud icon; the menu head shows it larger.
    const picture = page.locator('.account-button img.avatar-image');
    await expect(picture).toBeVisible();
    await expect(picture).toHaveAttribute('src', '/api/avatar');
    await expect(picture).toHaveAttribute('alt', '');
    expect(await picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await picture.evaluate((img) => getComputedStyle(img).borderRadius)).toBe('50%');
    if (SCREENSHOTS) await page.locator('.topbar').screenshot({ path: `${SHOT_DIR}account-button-${theme}.png` });
    await page.locator('.account-button').click();
    const menu = page.locator('#account-menu');
    await expect(menu.locator('.account-id img.avatar-image')).toBeVisible();
    await expect(menu).toContainText('Signed in as @member');
    await expect(menu).not.toContainText('never need');
    if (SCREENSHOTS) await page.screenshot({ path: `${SHOT_DIR}account-menu-${theme}.png`, clip: { x: 760, y: 0, width: 520, height: 330 } });
    await page.keyboard.press('Escape');
    const axe = await new AxeBuilder({ page }).include('[data-region="connect"]').include('.account').analyze();
    expect(axe.violations).toEqual([]);
    const screenshots = process.env['RUN_ROLE_SCREENSHOTS'];
    if (screenshots !== undefined) await page.screenshot({ animations: 'disabled', path: resolve(screenshots, `run-connect-member-${theme}.png`) });
  });
}

test('a failed picture leaves the cloud icon, never a broken image', async ({ page }) => {
  await page.route('**/api/session', route => route.fulfill({ json: { account: { subject: 'usr_member', display: '@member', canConnect: false }, signIn: true } }));
  await page.route('**/api/avatar', route => route.fulfill({ status: 404, json: { error: 'not_found' } }));
  await page.goto('/');
  await ready(page);
  await expect(page.locator('.account-button img.avatar-image')).toBeHidden();
  await expect(page.locator('.account-button .avatar svg')).toBeVisible();
});
