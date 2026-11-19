/**
 * The coolant control (owner, 2026-11-18, pictures 151 and 152; docs/design/WIZARD_FIXES.md): one toggle on the Job
 * page named by what the machine says is wired to the board's coolant output, its "?" on the same line; Board → the
 * coolant pin saves that choice on the machine. Simulated board only. RUN_SCREENSHOTS=1 writes the pictures.
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';
import { shot } from './wizardPage.ts';

const SHOT_DIR = new URL('../../../docs/design/screenshots/wizard-fixes/', import.meta.url).pathname;
const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const MACHINE = { id: 'm-1', name: 'Bench router', templateId: 'custom', drive: 'any', travel: { x: 300, y: 300, z: 80 }, spindle: '', createdAt: '2026-11-18T00:00:00.000Z' };

/** The machine (and its coolant choice) in this browser's library, chosen on the Job page. */
async function seedMachine(page: Page, coolant: string | null): Promise<void> {
  await page.addInitScript((m) => {
    localStorage.setItem('run.ws.machines', JSON.stringify({ v: 1, value: [m] }));
    localStorage.setItem('run.ws.machine-selected', JSON.stringify({ v: 1, value: 'm-1' }));
  }, coolant === null ? MACHINE : { ...MACHINE, coolant });
}

async function connect(page: Page): Promise<Worker> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => ((await request(worker, { v: 3, kind: 'status' })) as { status: { session: { reports: { phase: string } } } }).status.session.reports.phase, { timeout: 10_000 }).toBe('done');
  return worker;
}

function writes(worker: Worker): Promise<string[]> {
  return worker.evaluate(() => {
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { transcript: { entries(): readonly { kind: string; data: Uint8Array }[] } } }[] } }).__RUN_FAKE_SERIAL__;
    return (registry?.ports.at(-1)?.endpoint.transcript.entries() ?? []).filter((e) => e.kind === 'host-write').map((e) => String.fromCharCode(...e.data)).filter((w) => /^M[789]\b/.test(w));
  });
}

function boardCoolant(worker: Worker): Promise<{ mist: boolean; flood: boolean }> {
  return worker.evaluate(() => {
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { device: { snapshot(): { coolant: { mist: boolean; flood: boolean } } } } }[] } }).__RUN_FAKE_SERIAL__;
    return registry?.ports.at(-1)?.endpoint.device.snapshot().coolant ?? { mist: false, flood: false };
  });
}

/** The toggle, its "?" and the link sit on one line, and the toggle is sized to its word. */
async function expectOneLine(page: Page): Promise<void> {
  const g = await page.locator('.coolant-row').first().evaluate((row) => {
    const mid = (el: Element | null): number => { const r = (el as Element).getBoundingClientRect(); return r.top + r.height / 2; };
    const toggle = row.querySelector('[data-machine-control="coolant"]');
    return { toggle: mid(toggle), help: mid(row.querySelector('.help-trigger')), width: (toggle as Element).getBoundingClientRect().width };
  });
  expect(Math.abs(g.toggle - g.help)).toBeLessThanOrEqual(3);
  expect(g.width).toBeLessThanOrEqual(110);
}

for (const theme of ['light', 'dark'] as const) {
  test(`151/152: a machine that says mist gets one "Mist" toggle: M7 on, M9 off (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await seedMachine(page, 'mist');
    const worker = await connect(page);
    const toggle = page.getByRole('button', { name: 'Mist', exact: true });
    await expect(toggle).toBeVisible();
    await expect(page.locator('[data-machine-control="coolant"]')).toHaveCount(1);
    await expectOneLine(page);
    await toggle.click();
    await expect.poll(async () => (await boardCoolant(worker)).mist).toBe(true);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });
    await expect(page.locator('[data-region="machine-strip"] [data-readout="Coolant"]')).toHaveText('Mist on');
    await shot(page, SHOT_DIR, `coolant-mist-${theme}`);
    await toggle.click();
    await expect.poll(async () => (await boardCoolant(worker)).mist).toBe(false);
    expect(await writes(worker)).toEqual(['M7\n', 'M9\n']);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`152: no choice yet: "Coolant" (M8) and "Set what is wired" opens Board → J6.6, where the choice renames the toggle (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await seedMachine(page, null);
    await connect(page);
    await expect(page.getByRole('button', { name: 'Coolant', exact: true })).toBeVisible();
    await expectOneLine(page);
    await shot(page, SHOT_DIR, `coolant-unset-${theme}`);
    await page.locator('[data-action="coolant-set-wiring"]').click();
    const card = page.locator('[data-pin-card="J6.6"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Wired to');
    await expect(card).toContainText('Saved with the machine Bench router. TinyG does not know what is wired to its output.');
    await card.getByLabel('Flood coolant').check();
    await shot(page, SHOT_DIR, `board-coolant-wired-${theme}`);
    await page.locator('[data-region="rail"] [data-view="job"]').click();
    await expect(page.getByRole('button', { name: 'Flood', exact: true })).toBeVisible();
    await expect(page.locator('[data-action="coolant-set-wiring"]')).toHaveCount(0);
  });
}

test('152: no machine chosen: the Board pin says to choose one first and offers no choice', async ({ page }) => {
  await connect(page);
  await page.locator('[data-action="coolant-set-wiring"]').click();
  const card = page.locator('[data-pin-card="J6.6"]');
  await expect(card).toContainText('Choose a machine on the Job page first.');
  await expect(card.locator('input[type="radio"]')).toHaveCount(0);
});

test('152: a machine that says nothing is wired shows no coolant row, and the strip drops the readout', async ({ page }) => {
  await seedMachine(page, 'none');
  await connect(page);
  await expect(page.locator('.sec-spindle').first()).toBeVisible();
  await expect(page.locator('[data-machine-control="coolant"]')).toHaveCount(0);
  await expect(page.locator('[data-region="machine-strip"] .ro-coolant')).toHaveClass(/is-off/);
});
