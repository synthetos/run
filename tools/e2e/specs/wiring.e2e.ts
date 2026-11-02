/**
 * ROADMAP TB-05 (old P1-12 Playwright acceptance, keyboard path): build a
 * small TinyG diagram with the keyboard only, see the E-stop watermark go
 * away once a compliant E-stop is wired, accept a switch key through the
 * typed confirmation (Cancel writes nothing), and pass axe-core.
 */
import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';

async function addPart(page: Page, kind: string, label: string): Promise<void> {
  await page.locator('#wiring-kind').focus();
  await page.locator('#wiring-kind').selectOption(kind);
  await page.locator('#wiring-label').focus();
  await page.keyboard.type(label);
  await page.locator('[data-action="add-part"]').focus();
  await page.keyboard.press('Enter');
}

async function connect(page: Page, fromLabel: string, toLabel: string): Promise<void> {
  await page.locator('#wiring-from').focus();
  await page.locator('#wiring-from').selectOption({ label: fromLabel });
  await page.locator('#wiring-to').focus();
  await page.locator('#wiring-to').selectOption({ label: toLabel });
  await page.locator('[data-action="connect"]').focus();
  await page.keyboard.press('Enter');
}

test('wiring: keyboard-only build, watermark off with a compliant E-stop, typed confirmation, axe clean', async ({ page }) => {
  await page.goto('/wiring/');
  await ready(page);
  await addPart(page, 'mains', 'Mains');
  await addPart(page, 'psu', 'PSU');
  await addPart(page, 'switch', 'Xmin switch');
  await connect(page, 'Mains · L', 'PSU · L');
  await connect(page, 'Mains · N', 'PSU · N');
  await connect(page, 'Mains · PE', 'PSU · PE');
  await connect(page, 'PSU · +V', 'Board J1.2 · Vmot');
  await connect(page, 'PSU · -V', 'Board J1.1 · GND');
  await connect(page, 'Xmin switch · NO/NC', 'Board J7.3 · Xmin');
  await connect(page, 'Xmin switch · COM', 'Board J7.1 · GND');
  await expect(page.locator('[data-wire-row]')).toHaveCount(7);
  await expect(page.locator('.wiring-canvas svg [data-pin="J7.3"]')).toHaveCount(1);
  await expect(page.locator('[data-watermark="w14"]').first()).toBeVisible();

  // Put an E-stop in the mains feed: L -> E-stop -> PSU.
  await addPart(page, 'estop', 'E-stop');
  await page.locator('[data-wire-row]').filter({ hasText: 'Mains · L' }).locator('[data-action="remove-wire"]').click();
  await connect(page, 'Mains · L', 'E-stop · NC1 a');
  await connect(page, 'E-stop · NC1 b', 'PSU · L');
  await expect(page.locator('[data-watermark="w14"]')).toHaveCount(0);

  // A switch key needs the typed word; Cancel writes nothing.
  await page.locator('[data-accept="st"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-action="cancel"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-draft]')).toHaveText('Settings draft: empty');
  await page.locator('[data-accept="st"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('#wiring-confirm-input').fill('SWITCH');
  await page.locator('[data-action="confirm"]').click();
  await expect(page.locator('[data-draft]')).toHaveText('Settings draft: st=1');

  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
});
