/**
 * Shared steps for the job specs (fake-serial TEST build): connect the simulated board, open a file in the Run
 * view, tick the stepper and Start. Taken from jobs.fake-serial.ts so the job card layout spec drives the same flow.
 */
import type { Page, Worker } from '@playwright/test';
import { expect } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';

export const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;

export interface Job {
  readonly phase: string;
  readonly total: number;
  readonly sent: number;
  readonly acked: number;
  readonly message: string | null;
  readonly refused: { readonly line: number } | null;
}

export interface Session {
  readonly base: string;
  readonly overlays: readonly string[];
  readonly footerRev: number | null;
  readonly fault: { readonly cause: string } | null;
  readonly reports: { readonly phase: string };
  readonly rxm: { readonly busy: boolean; readonly current: number | null; readonly pending: boolean; readonly leftAsFound: boolean; readonly memoryKnown: boolean };
  readonly job: Job | null;
}

export async function session(worker: Worker): Promise<Session> {
  return ((await request(worker, { v: 3, kind: 'status' })) as { status: { session: Session } }).status.session;
}

export async function phase(worker: Worker): Promise<string | undefined> {
  return (await session(worker)).job?.phase;
}

export async function connect(page: Page, board?: Record<string, unknown>): Promise<Worker> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const worker = await machineWorker(page);
  if (board !== undefined) {
    await worker.evaluate((o) => {
      const scope = globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: unknown[]; next?: unknown } };
      scope.__RUN_FAKE_SERIAL__ ??= { ports: [] };
      scope.__RUN_FAKE_SERIAL__.next = o;
    }, board);
  }
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  // This spec drives the Advanced pane (tabs, the DRO sources); Simple is the default (OD-13).
  await page.locator('[data-action="ui-level-advanced"]').click();
  await expect.poll(async () => (await session(worker)).reports.phase, { timeout: 10_000 }).toBe('done');
  await expect.poll(async () => (await session(worker)).base, { timeout: 10_000 }).toBe('IDLE_UNHOMED');
  return worker;
}

/** A job of `n` short moves back and forth (each about 0.4 s on the simulated board), then `tail`. */
export function zigzag(n: number, tail: readonly string[] = [], head: readonly string[] = []): string {
  const lines = ['G21 G90', ...head, 'G0 X0 Y0'];
  for (let i = 0; i < n; i++) lines.push(`G1 X${i % 2 === 0 ? 5 : 0} Y${(i * 0.5).toFixed(1)} F800`);
  return `${[...lines, ...tail, 'M30'].join('\n')}\n`;
}

/** Opens `text` in the Run view and waits until the worker has checked it with the board. */
export async function open(page: Page, text: string, name = 'job.nc'): Promise<void> {
  await page.locator('[data-job-step="run"]').click();
  await page.locator('[data-region="job"] [data-preview="file"]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.locator('[data-ready-item="file"]')).toHaveAttribute('data-mark', 'done', { timeout: 15_000 });
}

/**
 * The Run step's one tick (owner, 2026-11-09: it confirms what applies, C31, C36, C32 and the attestation), then
 * Start; the travel question (C40 or C41) answered with Start anyway when it is asked; then C30.
 */
export async function start(page: Page): Promise<void> {
  const tick = page.locator('[data-job="confirm-start-box"]');
  if ((await tick.count()) > 0) await tick.check();
  await expect(page.locator('[data-ready-item][data-mark="blocked"], [data-ready-item][data-mark="waiting"]')).toHaveCount(0);
  const button = page.locator('[data-action="start-job"]');
  await expect(button).toBeEnabled();
  await button.click();
  const travel = page.locator('[data-action="travel-start"]');
  await expect(travel.or(page.locator('[data-safety="C30"]')).first()).toBeVisible();
  if ((await travel.count()) > 0) await travel.click();
  await expect(page.locator('[data-safety="C30"]')).toBeVisible();
  await page.locator('[data-safety="C30"] [data-action="motion-confirm"]').click();
}
