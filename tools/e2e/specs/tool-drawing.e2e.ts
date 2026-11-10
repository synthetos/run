/**
 * The tool drawn to scale in Library → Tools → Details (owner, 2026-11-09: "similar to how Fusion does it"):
 * typing a stickout moves its dimension and the holder face as you type; the field's meaning shows under the
 * drawing; flutes longer than the stickout are drawn as typed and flagged; choosing a dimension on the drawing
 * focuses its field. With RUN_SCREENSHOTS_DIR set, an end mill, a ball nose, a V-bit and a drill are captured in
 * light and dark, at 1280 and at 390 px.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';

const SHOTS = process.env['RUN_SCREENSHOTS_DIR'];

async function tools(page: Page): Promise<void> {
  await page.goto('/');
  await ready(page);
  await page.locator('[data-region="rail"] [data-view="library"]').click();
  await page.locator('#library-tab-tools').click();
}

/** The drawn length of a dimension line, px. */
function dimLength(page: Page, key: string): Promise<number> {
  return page.locator(`[data-dim="${key}"] .tf-dimline`).evaluate((el) => {
    const b = el.getBoundingClientRect();
    return Math.round(Math.max(b.width, b.height));
  });
}

test('typing a stickout moves its dimension live; impossible numbers are drawn and flagged; a dimension focuses its field', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await tools(page);
  const inspector = page.locator('.tools-view [aria-label="Selected tool"]');
  await page.locator('.tools-view tr[data-tool-row="2"] .row-link').click();
  await expect(inspector.locator('h2')).toHaveText('T2 · 6 mm 3-flute ZrN');
  const figure = inspector.locator('[data-tool-figure]');
  await expect(figure.locator('[data-dim="stickout"] text')).toHaveText('Stickout: out of the holder 26');
  const before = await dimLength(page, 'stickout');

  // Typing (before Enter) redraws: the dimension grows and is highlighted, and its meaning shows.
  const stickout = inspector.locator('[data-tool-field="stickout"]');
  await stickout.click();
  await expect(figure.locator('[data-tool-meaning]')).toHaveText('Stickout: how far the tool sticks out of the collet. Shorter is stiffer.');
  await expect(figure.locator('[data-dim="stickout"]')).toHaveClass(/active/);
  await stickout.fill('40');
  await expect(figure.locator('[data-dim="stickout"] text')).toHaveText('Stickout: out of the holder 40');
  expect(await dimLength(page, 'stickout')).toBeGreaterThan(before);

  // Shorter than the flutes: drawn as typed and flagged inline, on the field too.
  await stickout.fill('12');
  await expect(figure.locator('[data-tool-issues]')).toContainText('The flutes go into the collet');
  await expect(inspector.locator('[data-tool-field="fluteLength"]')).toHaveAttribute('aria-invalid', 'true');
  await expect(figure.locator('[data-dim="fluteLength"]')).toHaveClass(/warn/);
  await stickout.fill('26');
  await stickout.press('Enter');
  await expect(figure.locator('[data-tool-issues]')).toHaveCount(0);

  // Hovering a field highlights its dimension; choosing a dimension focuses its field.
  await inspector.locator('[data-tool-field="diameter"]').hover();
  await expect(figure.locator('[data-dim="diameter"]')).toHaveClass(/active/);
  await figure.locator('[data-dim="overallLength"] text').click();
  await expect(inspector.locator('[data-tool-field="overallLength"]')).toBeFocused();

  // The list icons are the same drawing at thumbnail size.
  await expect(page.locator('.tools-view tr[data-tool-row="2"] .tool-thumb')).toHaveCount(1);
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1280, 390] as const) {
    test(`walkthrough: an end mill, a ball nose, a V-bit and a drill, ${width} px (${theme})`, async ({ page }) => {
      test.skip(SHOTS === undefined, 'RUN_SCREENSHOTS_DIR is not set');
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await tools(page);
      const inspector = page.locator('.tools-view [aria-label="Selected tool"]');
      for (const [row, name] of [['2', 'end-mill'], ['3', 'ball'], ['4', 'v-bit'], ['5', 'drill']] as const) {
        await page.locator(`.tools-view tr[data-tool-row="${row}"] .row-link`).click();
        const figure = inspector.locator('[data-tool-figure]');
        await inspector.locator('[data-tool-field="stickout"]').focus();
        // On a phone the page scrolls to the field: bring the drawing back into view (the field keeps focus).
        await figure.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        // It fits: nothing sticks out sideways.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        const box = await figure.boundingBox();
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 1);
        await page.waitForTimeout(150);
        await inspector.locator('.tool-editor').screenshot({ path: `${SHOTS as string}/tool-${name}-${width}-${theme}.png` });
      }
    });
  }
}
