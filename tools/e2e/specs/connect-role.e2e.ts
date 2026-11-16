/** Role display in the built app. Worker tests cover real session validation and response policy. */
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';

for (const theme of ['light', 'dark'] as const) {
  test(`a member sees the tester notice instead of Connect (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    await page.route('**/api/session', route => route.fulfill({ json: {
      account: { subject: 'usr_member', display: '@member', canConnect: false }, signIn: true,
    } }));
    await page.goto('/');
    await ready(page);
    const notice = page.locator('[data-region="strip-connection"] [data-connect="role-required"]');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText('Connecting is open to testers for now.');
    await expect(page.locator('[data-action="connect"]')).toHaveCount(0);
    await expect(page.locator('[data-account="first-visit"]')).toHaveCount(0);
    const axe = await new AxeBuilder({ page }).include('[data-region="connect"]').analyze();
    expect(axe.violations).toEqual([]);
    const screenshots = process.env['RUN_ROLE_SCREENSHOTS'];
    if (screenshots !== undefined) await page.screenshot({ animations: 'disabled', path: resolve(screenshots, `run-connect-member-${theme}.png`) });
  });
}
