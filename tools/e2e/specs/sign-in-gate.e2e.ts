/**
 * The sign-in front door (docs/superpowers/specs/2026-11-16-first-run-design.md §5): a visitor without a session sees
 * the workspace dimmed under one dialog and can reach nothing behind it. RUN_SCREENSHOTS=1 writes the walkthrough
 * pictures to docs/design/screenshots/sign-in-gate/.
 */
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';
const SCREENSHOTS = process.env['RUN_SCREENSHOTS'] === '1';
const SHOT_DIR = new URL('../../../docs/design/screenshots/sign-in-gate/', import.meta.url).pathname;

for (const theme of ['light', 'dark'] as const) {
  test(`signed-out visitors see the dialog and cannot use the workspace (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.route('**/api/session', (route) => route.fulfill({ json: { account: null, signIn: true } }));
    await page.goto('/'); await ready(page);
    const dialog = page.locator('[data-gate="sign-in"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading')).toHaveText('Sign in to use Run');
    await expect(dialog.locator('[data-action="sign-in"]')).toHaveAttribute('href', '/auth/login');
    await expect(dialog.locator('[data-action="sign-in"]')).toBeFocused();
    await expect(page.locator('.app')).toHaveAttribute('inert', '');
    await page.keyboard.press('Tab'); await expect(dialog.getByRole('link', { name: 'What we store' })).toBeFocused();
    await page.keyboard.press('Tab'); await expect(dialog.getByRole('link', { name: /Read the overview/ })).toBeFocused();
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.closest('.app') ?? null)).toBeNull();
    }
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 740 : 800 });
      await expect(dialog).toBeVisible();
      if (SCREENSHOTS) await page.screenshot({ path: `${SHOT_DIR}gate-${theme}-${width}.png`, fullPage: false });
    }
  });
}
test('a signed-in account sees no gate', async ({ page }) => {
  await page.route('**/api/session', (route) => route.fulfill({ json: { account: { subject: 'usr_owner', display: '@owner', canConnect: true }, signIn: true } }));
  await page.goto('/'); await ready(page);
  await expect(page.locator('[data-gate]')).toHaveCount(0);
  await expect(page.locator('[inert]')).toHaveCount(0);
});
test('where sign-in is not offered the local page stays open', async ({ page }) => {
  await page.route('**/api/session', (route) => route.fulfill({ json: { account: null, signIn: false } }));
  await page.goto('/'); await ready(page);
  await expect(page.locator('[data-gate]')).toHaveCount(0);
});
