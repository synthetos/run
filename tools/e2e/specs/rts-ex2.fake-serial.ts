/**
 * A board left on RTS/CTS flow control (`$ex=2`) is controlled as usual (OD-33, 2026-11-10; TinyG B-FC-1 on 450.02
 * and edge-next), in the built app (fake-serial TEST build): the port's RTS is turned on right after the open (and
 * DTR left alone, rts.ts), the session is full, not read only, and a jog step moves the board.
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';
import { PORT } from './jobFlow.ts';

interface Session {
  readonly base: string;
  readonly overlays: readonly string[];
  readonly reports: { readonly phase: string };
  readonly live: { readonly ex?: number };
  readonly classification: { readonly mode: string; readonly reason: string } | null;
}

async function session(worker: Worker): Promise<Session> {
  return ((await request(worker, { v: 3, kind: 'status' })) as { readonly status: { readonly session: Session } }).status.session;
}

/** The simulated port's setSignals calls and its output signals now (testkit MockSerialPort). */
function signals(worker: Worker): Promise<{ readonly log: readonly object[]; readonly now: object }> {
  return worker.evaluate(() => {
    interface Port {
      readonly signalLog: readonly object[];
      outputSignals(): object;
    }
    const port = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: Port[] } }).__RUN_FAKE_SERIAL__?.ports.at(-1);
    return { log: port?.signalLog ?? [], now: port?.outputSignals() ?? {} };
  });
}

/** The simulated board's position. */
function position(worker: Worker): Promise<readonly number[]> {
  return worker.evaluate(() => {
    const port = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { device: { snapshot(): { position: number[] } } } }[] } }).__RUN_FAKE_SERIAL__?.ports.at(-1);
    return port?.endpoint.device.snapshot().position ?? [];
  });
}

async function connectEx2(page: Page): Promise<Worker> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const worker = await machineWorker(page);
  await worker.evaluate(() => {
    const scope = globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: unknown[]; next?: unknown } };
    scope.__RUN_FAKE_SERIAL__ ??= { ports: [] };
    scope.__RUN_FAKE_SERIAL__.next = { eeprom: { __layout: 10002, ex: 2 } };
  });
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await page.locator('[data-action="ui-level-advanced"]').click();
  await expect.poll(async () => (await session(worker)).base, { timeout: 10_000 }).toBe('IDLE_UNHOMED');
  await expect.poll(async () => (await session(worker)).reports.phase, { timeout: 10_000 }).toBe('done');
  return worker;
}

test('an ex = 2 board: RTS on after the open, DTR untouched, a full session, and a jog step moves it', async ({ page }) => {
  const worker = await connectEx2(page);
  const s = await session(worker);
  expect(s.live.ex).toBe(2);
  expect(s.classification).toMatchObject({ mode: 'full', reason: 'en-approved' });
  expect(s.overlays).toEqual([]);
  const rts = await signals(worker);
  expect(rts.log).toEqual([{ requestToSend: true }]);
  expect(rts.now).toEqual({ dataTerminalReady: false, requestToSend: true, break: false });
  await expect(page.locator('[data-region="position"] [data-region="control-block"]')).toHaveCount(0);

  await page.locator('[data-tab="jog"]').click();
  await expect(page.locator('#insp-pane-jog')).toBeVisible();
  await page.locator('.sec-jog [aria-label="Step size"] button', { hasText: /^1$/ }).click();
  await page.getByRole('button', { name: 'X+', exact: true }).click();
  await expect.poll(async () => (await position(worker))[0] ?? 0, { timeout: 15_000 }).toBeCloseTo(1, 3);
  await expect.poll(async () => (await session(worker)).base, { timeout: 15_000 }).toMatch(/^IDLE_/);
});
