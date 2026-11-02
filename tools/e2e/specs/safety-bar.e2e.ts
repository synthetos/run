/**
 * ROADMAP P0-05 acceptance: "Playwright: the safety bar is visible at 320 px
 * and on desktop; axe-core passes; no requests leave the origin." Also: the
 * bar is sticky and needs no JavaScript, the workspace shows W7 NOT CONNECTED,
 * the version chip and the disabled stop button labelled W2, and the safety
 * bar and stop button look the same in both themes and unlike anything
 * themed.
 *
 * Screenshots for the visual review (light and dark, 320 and 1280 px) are
 * written to docs/design/screenshots/p0-05/ when RUN_SCREENSHOTS=1.
 */
import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { STOP_TEXT, w1, w2Label, w7 } from '../../../packages/safety/src/strings.ts';
import { guardContext } from './fixtures.ts';
import { PAGES, ready } from './helpers.ts';

const WIDTHS = [320, 1280] as const;
const THEMES = ['light', 'dark'] as const;
const SCREENSHOTS = process.env['RUN_SCREENSHOTS'] === '1';
const SHOT_DIR = new URL('../../../docs/design/screenshots/p0-05/', import.meta.url).pathname;

async function expectBarInView(page: Page): Promise<void> {
  const bar = page.locator('[data-region="safety-bar"]');
  await expect(bar).toBeVisible();
  await expect(bar.locator('[data-safety="W1"]')).toHaveText(w1());
  const box = await bar.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box?.y ?? 99)).toBeLessThanOrEqual(1);
  const viewport = page.viewportSize();
  expect((box?.x ?? -1) >= 0 && (box?.width ?? 0) <= (viewport?.width ?? 0) + 0.5).toBe(true);
}

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test.describe(`${width} px, ${theme}`, () => {
      test.use({ viewport: { width, height: width === 320 ? 640 : 900 }, colorScheme: theme });

      for (const path of PAGES) {
        test(`${path}: safety bar visible and sticky, no horizontal scroll, axe clean, no external request`, async ({ page }) => {
          await page.goto(path);
          await ready(page);
          await expectBarInView(page);

          // No horizontal page scroll at any width.
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(overflow).toBeLessThanOrEqual(0);

          // The theme in effect is the one the OS asks for.
          const paper = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim());
          expect(paper).toBe(theme === 'dark' ? '#0d161d' : '#f6f8f9');

          if (SCREENSHOTS && path !== '/no-such-page') {
            const name = path === '/' ? 'workspace' : path.replaceAll('/', '');
            await page.screenshot({ path: `${SHOT_DIR}${name}-${theme}-${width}.png`, fullPage: true });
          }

          // Sticky: still at the top after scrolling to the end.
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await expectBarInView(page);

          const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
          expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
          // No external request: the origin guard checks it after the test.
        });
      }

      test('workspace: W7 NOT CONNECTED in the machine strip, the version, and Pause (W2) and Stop job disabled with the reason', async ({ page }) => {
        await page.goto('/');
        await ready(page);
        const bar = page.locator('[data-region="machine-strip"]');
        await expect(bar.locator('[data-safety="W7"]')).toHaveText(w7());
        await expect(bar.locator('[data-safety="W7"]')).toBeVisible();
        await expect(page.locator('[data-version]')).toHaveText(/^v\d+\.\d+\.\d+ · [0-9a-f]{12}(-dirty)?$/);
        const stopJob = bar.getByRole('button', { name: STOP_TEXT.stopJob, exact: true });
        await expect(stopJob).toBeVisible();
        await expect(stopJob).toBeDisabled();
        const stop = bar.getByRole('button', { name: w2Label(), exact: true });
        await expect(stop).toBeVisible();
        await expect(stop).toBeDisabled();
        await expect(stop).toHaveAttribute('title', 'Available when a machine is connected');
        await expect(stop).toHaveAccessibleDescription('Available when a machine is connected');
        // A click does nothing and changes nothing.
        await stop.click({ force: true });
        await expect(bar.locator('[data-safety="W7"]')).toHaveText(w7());
      });
    });
  }
}

/** The safety-bar colour set (tokens.css, the same in both themes): signal orange, black, white. */
const SAFETY_BAR_COLOURS = ['rgb(255, 158, 27)', 'rgb(17, 17, 17)', 'rgb(255, 255, 255)'] as const;

test('the safety bar, Pause and Stop job keep their exact colours in both themes, and nothing themed uses them', async ({ page }) => {
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    await ready(page);
    const colours = await page.evaluate(() => {
      const bar = document.querySelector('[data-region="safety-bar"]') as HTMLElement;
      const stops = document.querySelector('[data-region="stop-controls"]') as HTMLElement;
      const look = (el: Element): { bg: string; border: string; fg: string } => ({ bg: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopColor, fg: getComputedStyle(el).color });
      const outside = [...document.querySelectorAll('body *')].filter((el) => !bar.contains(el) && !stops.contains(el));
      return {
        bar: getComputedStyle(bar).backgroundColor,
        stripes: getComputedStyle(bar, '::before').backgroundImage,
        pause: look(document.querySelector('[data-region="stop-controls"] [data-safety="W2"]') as Element),
        stop: look(document.querySelector('[data-region="stop-controls"] [data-action="stop-job"]') as Element),
        outside: [...new Set(outside.flatMap((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).borderTopColor]))],
      };
    });
    expect(colours.bar, theme).toBe('rgb(255, 158, 27)');
    expect(colours.stripes, theme).toContain('repeating-linear-gradient');
    // Quiet (nothing can be moving: not connected): white with a black frame, in both themes.
    expect(colours.pause, theme).toEqual({ bg: 'rgb(255, 255, 255)', border: 'rgb(17, 17, 17)', fg: 'rgb(17, 17, 17)' });
    expect(colours.stop, theme).toEqual({ bg: 'rgb(255, 255, 255)', border: 'rgb(17, 17, 17)', fg: 'rgb(17, 17, 17)' });
    for (const c of [colours.pause, colours.stop]) for (const v of Object.values(c)) expect(SAFETY_BAR_COLOURS, theme).toContain(v);
    expect(colours.outside, theme).not.toContain('rgb(255, 158, 27)');
    expect(colours.outside, theme).not.toContain('rgb(17, 17, 17)');
  }
});

test('without JavaScript the safety bar, W1, W7 and the disabled stop button are still there', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 640 } });
  const guard = await guardContext(context, baseURL);
  const page = await context.newPage();
  for (const path of ['/', '/safety/']) {
    await page.goto(path);
    await expect(page.locator('[data-safety="W1"]')).toHaveText(w1());
  }
  await page.goto('/');
  await expect(page.locator('[data-safety="W7"]')).toHaveText(w7());
  await expect(page.getByRole('button', { name: w2Label(), exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: STOP_TEXT.stopJob, exact: true })).toBeDisabled();
  await guard.assertClean();
  await context.close();
});

test('the theme toggle switches theme and remembers it; the safety bar does not change', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/safety/');
  await ready(page);
  const barColour = (): Promise<string> => page.evaluate(() => getComputedStyle(document.querySelector('[data-region="safety-bar"]') as HTMLElement).backgroundColor);
  const before = await barColour();
  await page.getByRole('button', { name: 'Toggle day/night mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sheet').trim())).toBe('#131f28');
  expect(await barColour()).toBe(before);
  await page.goto('/');
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
