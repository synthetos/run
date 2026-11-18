/**
 * The setup wizard's layout against the owner's staging pictures (docs/design/WIZARD_FIXES.md): the C1 checklist
 * opened from inside the frame (145), the radio cards (148), the catalog as a whole page (147). Geometry is measured
 * in the built app with its real stylesheet, in both themes, at 1280 and at 960 (the full-screen frame).
 * RUN_SCREENSHOTS=1 writes the pictures to docs/design/screenshots/wizard-fixes/.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { setupRecord } from './accountRecords.ts';
import { connect, next, open, shot as shotIn, step, wizard } from './wizardPage.ts';

const SHOT_DIR = new URL('../../../docs/design/screenshots/wizard-fixes/', import.meta.url).pathname;
const WALK_DIR = new URL('../../../docs/design/screenshots/setup-wizard/', import.meta.url).pathname;
const shot = (page: Page, name: string): Promise<void> => shotIn(page, SHOT_DIR, name);

/** Nothing in the step body runs off sideways, and no step text is centred (owner 145, 148). */
async function expectTidy(page: Page): Promise<void> {
  const g = await page.locator('.wizard-body').evaluate((body) => ({
    overflow: body.scrollWidth - body.clientWidth,
    centred: [...body.querySelectorAll('p, li, label, strong, h3, td, th, summary')].filter((el) => getComputedStyle(el).textAlign === 'center').map((el) => el.textContent?.slice(0, 40)),
    wide: [...body.querySelectorAll('input[type="checkbox"], input[type="radio"]')].filter((el) => el.getBoundingClientRect().width > 20).length,
  }));
  expect(g.overflow).toBeLessThanOrEqual(1);
  expect(g.centred).toEqual([]);
  expect(g.wide).toBe(0);
}

const C1_LINES = [
  'A hardwired E-stop that removes motor and spindle power is installed and I tested it today.',
  'Limit switches or soft limits are configured, or I will keep moves small.',
  'The work area is clear of people, tools and loose items.',
  'I am wearing eye and ear protection.',
  'I will not leave the machine unattended while it is powered.',
];

/**
 * The C1 dialog exactly as ConnectNotice renders it for `entry.step === 'c1'` (views/run/connect.ts with
 * live/ConnectChecklist.ts; connectNoticeC1.test.ts pins that structure), placed where ConnectNotice puts it: inside
 * the step's connect region. C1 cannot be reached on 127.0.0.1, because the advisory refusal comes first there.
 */
async function showC1(page: Page): Promise<void> {
  // The page enforces Trusted Types, so the copy is built with DOM calls, not an HTML string.
  await wizard(page).locator('[data-region="connect"]').evaluate((region, lines) => {
    const el = (tag: string, attrs: Record<string, string>, ...kids: (Node | string)[]): HTMLElement => {
      const node = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      node.append(...kids);
      return node;
    };
    const boxes = lines.map((line, i) => el('label', { class: 'c1-box' }, el('input', { type: 'checkbox', name: `c1-${i}`, required: '', 'aria-label': line }), ` ${line}`));
    const actions = el('div', { class: 'c1-actions' }, el('button', { type: 'submit', class: 'button', 'data-action': 'confirm' }, 'Confirm and choose port'), el('button', { type: 'button', class: 'button', 'data-action': 'cancel' }, 'Cancel'));
    const form = el('form', { class: 'live-entry c1', 'data-entry': 'c1', 'data-c1-form': 'full', 'data-safety': 'C1' }, el('p', {}, 'Before connecting, confirm:'), ...boxes, actions);
    const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'c1-title' }, el('div', { class: 'dialog-head' }, el('h2', { id: 'c1-title' }, 'Before you connect')), form);
    region.append(el('div', { class: 'dialog-wrap', role: 'presentation', 'data-test': 'c1' }, dialog));
  }, C1_LINES);
}

interface C1Geometry { readonly boxes: readonly { readonly boxLeft: number; readonly boxRight: number; readonly boxWidth: number; readonly textLeft: number }[]; readonly dialog: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }; readonly viewport: { readonly w: number; readonly h: number }; readonly onTop: boolean; readonly headAlign: string }

function measureC1(page: Page): Promise<C1Geometry> {
  return page.evaluate(() => {
    const wrap = document.querySelector('[data-test="c1"]') as HTMLElement;
    const dialog = wrap.querySelector('.dialog') as HTMLElement;
    const boxes = [...wrap.querySelectorAll('.c1-box')].map((label) => {
      const input = (label.querySelector('input') as HTMLInputElement).getBoundingClientRect();
      const node = [...label.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '') as Text;
      const range = document.createRange();
      range.setStart(node, node.data.length - node.data.trimStart().length);
      range.setEnd(node, node.data.length);
      return { boxLeft: input.left, boxRight: input.right, boxWidth: input.width, textLeft: range.getClientRects()[0]?.left ?? 0 };
    });
    const d = dialog.getBoundingClientRect();
    const hit = document.elementFromPoint(d.left + d.width / 2, d.top + d.height / 2);
    return { boxes, dialog: { left: d.left, top: d.top, right: d.right, bottom: d.bottom }, viewport: { w: innerWidth, h: innerHeight }, onTop: hit !== null && dialog.contains(hit), headAlign: getComputedStyle(dialog.querySelector('h2') as HTMLElement).textAlign };
  });
}

function expectC1Layout(g: C1Geometry): void {
  expect(g.boxes).toHaveLength(5);
  const left = g.boxes[0]?.boxLeft ?? 0;
  const textLeft = g.boxes[0]?.textLeft ?? 0;
  for (const b of g.boxes) {
    expect(b.boxWidth).toBeLessThanOrEqual(20);
    expect(b.boxRight).toBeLessThan(b.textLeft);
    expect(Math.abs(b.boxLeft - left)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.textLeft - textLeft)).toBeLessThanOrEqual(1);
    expect(b.textLeft - b.boxRight).toBeLessThanOrEqual(16);
  }
  expect(g.dialog.left).toBeGreaterThanOrEqual(0);
  expect(g.dialog.top).toBeGreaterThanOrEqual(0);
  expect(g.dialog.right).toBeLessThanOrEqual(g.viewport.w);
  expect(g.dialog.bottom).toBeLessThanOrEqual(g.viewport.h);
  expect(g.onTop).toBe(true);
  expect(g.headAlign).not.toBe('center');
}

for (const theme of ['light', 'dark'] as const) {
  test(`146: a board on 449.01 with a list whose newest is 450.06 is never "current" (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1280, height: 800 });
    const { worker } = await open(page, [setupRecord({ step: 3, done: [1, 2] })], 3);
    await page.removeLocatorHandler(page.locator('[data-action="firmware-offer-later"]'));
    await connect(worker, { fb: 449.01, fv: 0.97, hv: 8, layout: 10002 });
    await expect(page.locator('[data-firmware-step="text"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-firmware-step="current"]')).toHaveCount(0);
    await expect(wizard(page).locator('table.wizard-facts')).toContainText('TinyG 449.01');
    await expect(wizard(page).locator('table.wizard-facts')).toContainText('TinyG 450.06');
    await expect(page.locator('[data-action="wizard-skip"]')).toHaveCount(0);
    await shot(page, `step-3-449-${theme}-1280`);
  });

  for (const width of [1280, 960] as const) {
    test(`145: C1 opened from the wizard has its checkbox at the left of each line and sits above the frame (${theme}, ${width})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 700 });
      await open(page, [setupRecord({ step: 2, done: [1] })], 2);
      await showC1(page);
      expectC1Layout(await measureC1(page));
      await shot(page, `c1-in-wizard-${theme}-${width}`);
    });

    test(`148: radio cards put the radio at the left, level with the title (${theme}, ${width})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 700 });
      await open(page, [setupRecord({ step: 6, done: [1, 2, 3, 4, 5] })], 6);
      const cards = await page.locator('.wizard .wizard-pick').evaluateAll((labels) => labels.map((label) => {
        const r = (label.querySelector('input') as HTMLElement).getBoundingClientRect();
        const t = (label.querySelector('.wizard-pick-title') as HTMLElement).getBoundingClientRect();
        const d = (label.querySelector('.wizard-pick-text') as HTMLElement).getBoundingClientRect();
        return { radioLeft: r.left, radioRight: r.right, radioMid: r.top + r.height / 2, titleLeft: t.left, titleMid: t.top + t.height / 2, textLeft: d.left, width: label.getBoundingClientRect().width, cardLeft: label.getBoundingClientRect().left };
      }));
      expect(cards).toHaveLength(2);
      for (const c of cards) {
        expect(c.radioRight).toBeLessThan(c.titleLeft);
        expect(c.radioLeft - c.cardLeft).toBeLessThanOrEqual(20);
        expect(Math.abs(c.radioMid - c.titleMid)).toBeLessThanOrEqual(4);
        expect(Math.abs(c.textLeft - c.titleLeft)).toBeLessThanOrEqual(1);
        expect(c.width).toBeLessThanOrEqual(440);
      }
      await shot(page, `step-6-${theme}-${width}`);
    });

    test(`147: the catalog opens as a whole page, lists tools without a search, and adding one returns to the step (${theme}, ${width})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      const height = width === 1280 ? 800 : 700;
      await page.setViewportSize({ width, height });
      await open(page, [setupRecord({ step: 5, done: [1, 2, 3, 4] })], 5);
      await shot(page, `step-5-${theme}-${width}`);
      await page.locator('[data-action="wizard-catalog"]').click();
      const catalog = page.locator('.wizard-catalog');
      await expect(catalog.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });
      expect(await catalog.boundingBox()).toEqual({ x: 0, y: 0, width, height });
      expect(await catalog.locator('tbody tr').count()).toBeGreaterThan(10);
      await expect(catalog.getByLabel('Search catalog')).toHaveValue('');
      await expect(page.locator('[data-action="wizard-catalog-back"]')).toBeFocused();
      await shot(page, `step-5-catalog-${theme}-${width}`);
      await catalog.getByLabel('Search catalog').fill('1/4 2 flute');
      expect(await catalog.locator('tbody tr').count()).toBeGreaterThan(0);
      await catalog.locator('tbody tr').first().locator('[data-action="catalog-add"]').click();
      const modal = page.locator('.tool-modal');
      const box = await modal.boundingBox();
      expect(box !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height).toBe(true);
      await modal.locator('[data-action="save-tool"]').click();
      await expect(catalog).toHaveCount(0);
      await expect(wizard(page).locator('[data-wizard="tool"]')).toContainText('6.35 mm');
      await expect(page.locator('[data-wizard-step="5"]')).toBeVisible();
    });

    test(`every step is tidy with the board connected (${theme}, ${width})`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 700 });
      const tag = `${theme}-${width}`;
      const walk = (name: string): Promise<void> => (theme === 'light' && width === 1280 ? Promise.resolve() : shotIn(page, WALK_DIR, name));
      const { worker } = await open(page);
      await expectTidy(page);
      await walk(`step-1-${tag}`);
      await next(page).click();
      // 2 Machine: before and after the board connects.
      await expect(step(page, 2)).toBeVisible();
      await expectTidy(page);
      await connect(worker);
      await expect(page.locator('[data-wizard="board"]')).toBeVisible({ timeout: 15_000 });
      await expectTidy(page);
      await walk(`step-2-${tag}`);
      await next(page).click();
      // 3 Firmware: the simulated 450.02 against a list naming 450.06.
      await expect(page.locator('[data-firmware-step="text"]')).toBeVisible({ timeout: 15_000 });
      await expectTidy(page);
      await walk(`step-3-${tag}`);
      await next(page).click();
      // 4 Homing, with the no-switches card chosen (it shows Set machine zero).
      await expect(step(page, 4)).toBeVisible();
      await page.locator('input[name="wizard-homing"][value="none"]').check();
      await expect(wizard(page).locator('[data-region="home-quick"]')).toBeVisible();
      await expectTidy(page);
      await walk(`step-4-${tag}`);
      await next(page).click();
      await expect(step(page, 5)).toBeVisible();
      await expectTidy(page);
      await next(page).click();
      // 6 First project with "New project" chosen (its name field opens inside the card).
      await expect(step(page, 6)).toBeVisible();
      await page.locator('input[name="wizard-project"][value="new"]').check();
      await expect(page.locator('[data-wizard="project-name"]')).toBeVisible();
      await expectTidy(page);
      await walk(`step-6-new-${tag}`);
      await page.locator('input[name="wizard-project"][value="demo"]').check();
      await next(page).click();
      await expect(step(page, 7)).toBeVisible({ timeout: 30_000 });
      await expectTidy(page);
      await page.locator('.wizard details').first().locator('summary').click();
      await expectTidy(page);
      await walk(`step-7-${tag}`);
    });

    test(`147: Create a tool opens the editor above the frame, never cut to it (${theme}, ${width})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      const height = width === 1280 ? 800 : 700;
      await page.setViewportSize({ width, height });
      await open(page, [setupRecord({ step: 5, done: [1, 2, 3, 4] })], 5);
      await page.locator('[data-action="wizard-create-tool"]').click();
      const modal = page.locator('.tool-modal');
      await expect(modal).toBeVisible();
      const g = await modal.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 20);
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, onTop: hit !== null && el.contains(hit) };
      });
      expect(g.left).toBeGreaterThanOrEqual(0);
      expect(g.top).toBeGreaterThanOrEqual(0);
      expect(g.right).toBeLessThanOrEqual(width);
      expect(g.bottom).toBeLessThanOrEqual(height);
      expect(g.onTop).toBe(true);
      await shot(page, `step-5-create-${theme}-${width}`);
      await page.keyboard.press('Escape');
      await expect(modal).toHaveCount(0);
    });
  }
}
