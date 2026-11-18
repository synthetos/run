/**
 * Shared steps for the setup wizard browser specs (setup-wizard.fake-serial.ts, setup-wizard-layout.fake-serial.ts):
 * open the page as a signed-in account at a given step, connect the fake board from the worker, and write the
 * walkthrough screenshots when RUN_SCREENSHOTS=1.
 */
import type { Locator, Page, Worker } from '@playwright/test';
import { expect } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';
import { fakeRecords, stubAccount, type FakeAccount } from './accountRecords.ts';

export const SCREENSHOTS = process.env['RUN_SCREENSHOTS'] === '1';
const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;

export const wizard = (page: Page): Locator => page.locator('.wizard[role="dialog"]');
export const step = (page: Page, n: number): Locator => page.locator(`[data-wizard-step="${n}"]`);
export const next = (page: Page): Locator => page.locator('[data-action="wizard-next"]');

/** Writes `<dir><name>.png` when RUN_SCREENSHOTS=1. */
export async function shot(page: Page, dir: string, name: string): Promise<void> {
  if (SCREENSHOTS) await page.screenshot({ path: `${dir}${name}.png`, fullPage: false });
}

/** Opens the page as a signed-in account and waits for the wizard at `at`. */
export async function open(page: Page, seed: Parameters<typeof fakeRecords>[1] = [], at = 1): Promise<{ account: FakeAccount; worker: Worker }> {
  await stubAccount(page);
  const account = await fakeRecords(page, seed);
  const worker = await machineWorker(page);
  // The shared handlers click inside the app (W29, the update offer); the app is inert under the wizard, so they
  // would wait forever. Both modals stay behind the scrim and change nothing the wizard shows.
  await page.removeLocatorHandler(page.locator('[data-action="dismiss-w29"]'));
  await page.removeLocatorHandler(page.locator('[data-action="firmware-offer-later"]'));
  await expect(step(page, at)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.app')).toHaveAttribute('inert', '');
  return { account, worker };
}

export async function base(worker: Worker): Promise<string> {
  return ((await request(worker, { v: 3, kind: 'status' })) as { readonly status: { readonly session: { readonly base: string } } }).status.session.base;
}

/** Opens the fake board from the worker, optionally on another build, and waits until it is identified. */
export async function connect(worker: Worker, build?: Record<string, unknown>): Promise<void> {
  if (build !== undefined) {
    await worker.evaluate((b) => {
      const scope = globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: unknown[]; next?: unknown } };
      scope.__RUN_FAKE_SERIAL__ ??= { ports: [] };
      scope.__RUN_FAKE_SERIAL__.next = { build: b };
    }, build);
  }
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  // The board is identified once the session is at rest (the needed board stays CONNECTED_UNKNOWN, read-only).
  await expect.poll(() => base(worker), { timeout: 15_000 }).toMatch(/^(IDLE_UNHOMED|CONNECTED_UNKNOWN)$/);
}
