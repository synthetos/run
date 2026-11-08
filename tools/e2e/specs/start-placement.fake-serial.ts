/**
 * Start never covers the checks it waits for (first-time walk 2026-11-08, S5), in the built app (fake-serial
 * TEST build): in the Job panel's Run step, at 1280 × 720 and on a phone, the Start button sits below the work
 * zero row, every confirmation, W5 and the attestation, and overlaps none of them, wherever the panel is scrolled.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { connect, open, zigzag } from './jobFlow.ts';

/** Each check's box against Start's, in the same scroll position. */
async function overlaps(page: Page): Promise<{ readonly what: string; readonly startTop: number; readonly bottom: number; readonly overlap: boolean }[]> {
  return page.locator('[data-job="steps"]').evaluate((steps) => {
    const start = steps.querySelector('[data-action="start-job"]');
    if (start === null) return [];
    const s = start.getBoundingClientRect();
    const checks = [...steps.querySelectorAll('.job-prep > *')];
    return checks.map((el) => {
      const r = el.getBoundingClientRect();
      const overlap = r.width > 0 && r.height > 0 && r.left < s.right && r.right > s.left && r.top < s.bottom && r.bottom > s.top;
      return { what: (el.getAttribute('data-job') ?? el.getAttribute('data-safety') ?? el.tagName).slice(0, 40), startTop: s.top, bottom: r.bottom, overlap };
    });
  });
}

for (const [width, height] of [[1280, 720], [390, 844]] as const) {
  test(`Start sits after the checks and covers none of them (${width} × ${height})`, async ({ page }) => {
    test.setTimeout(90_000);
    await connect(page);
    await page.locator('[data-action="ui-level-simple"]').click();
    await open(page, zigzag(10, [], ['M3 S12000']).replace('M30', 'M5\nM30'));
    await page.setViewportSize({ width, height });
    await page.locator('[data-job-step="run"]').click();
    await expect(page.locator('[data-job="confirm-attended"]')).toHaveCount(1);
    for (const at of ['top', 'middle', 'bottom'] as const) {
      await page.locator('[data-job="steps"]').evaluate((el, where) => {
        const scroller = el.closest('.job-work-panel, .scroll-region, [data-job-panel]') ?? el.parentElement;
        let p: HTMLElement | null = el as HTMLElement;
        while (p !== null && p.scrollHeight <= p.clientHeight) p = p.parentElement;
        const box = p ?? (scroller as HTMLElement | null);
        if (box !== null) box.scrollTop = where === 'top' ? 0 : where === 'middle' ? box.scrollHeight / 2 : box.scrollHeight;
      }, at);
      await page.waitForTimeout(100);
      for (const c of await overlaps(page)) {
        expect(c.overlap, `Start overlaps ${c.what} (scrolled to the ${at})`).toBe(false);
        expect(c.bottom, `${c.what} ends above Start`).toBeLessThanOrEqual(c.startTop + 0.5);
      }
    }
  });
}
