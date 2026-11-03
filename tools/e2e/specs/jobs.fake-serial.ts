/**
 * Phase 3 jobs in the built app (fake-serial TEST build, loopback: motion and jobs are on and the signed bench
 * channel approves the simulated edge-next board, which starts in character mode). SAFETY §4.4a, H70-H78; T-S118:
 *
 * - a file streamed to completion from the Check → Set zero → Start stepper, with the line mode set and put back;
 * - Pause and Resume; Stop job mid-job ("Stopped at line N");
 * - the manual tool-change flow (W37, C34, C35);
 * - a breakpoint (W43); a refused line (W38, Skip behind C33); a reset mid-job (FAULT, W40).
 *
 * The page is not LIVE here (the worker is opened directly, as in the other fake-serial specs), so Pause and Stop job
 * go to the worker as requests; the stepper, the cards and the G-code list are driven in the page. With
 * RUN_SCREENSHOTS_DIR set, a running job (planner view), the tool-change card and a refused line are captured at 1440.
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { machineWorker, request } from './machineWorker.ts';

const PORT = { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 } as const;
const SHOTS = process.env['RUN_SCREENSHOTS_DIR'];

interface Job {
  readonly phase: string;
  readonly total: number;
  readonly sent: number;
  readonly acked: number;
  readonly message: string | null;
  readonly refused: { readonly line: number } | null;
}

interface Session {
  readonly base: string;
  readonly overlays: readonly string[];
  readonly footerRev: number | null;
  readonly fault: { readonly cause: string } | null;
  readonly reports: { readonly phase: string };
  readonly rxm: { readonly busy: boolean; readonly current: number | null };
  readonly job: Job | null;
}

async function session(worker: Worker): Promise<Session> {
  return ((await request(worker, { v: 3, kind: 'status' })) as { status: { session: Session } }).status.session;
}

async function phase(worker: Worker): Promise<string | undefined> {
  return (await session(worker)).job?.phase;
}

function writes(worker: Worker): Promise<string[]> {
  return worker.evaluate(() => {
    interface Entry {
      readonly kind: string;
      readonly data: Uint8Array;
    }
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { transcript: { entries(): readonly Entry[] } } }[] } }).__RUN_FAKE_SERIAL__;
    return (registry?.ports.at(-1)?.endpoint.transcript.entries() ?? []).filter((e) => e.kind === 'host-write').map((e) => String.fromCharCode(...e.data));
  });
}

/** The simulated board's own state. */
function board(worker: Worker): Promise<{ position: number[]; hold: number; spindle: string }> {
  return worker.evaluate(() => {
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { device: { snapshot(): unknown } } }[] } }).__RUN_FAKE_SERIAL__;
    return registry?.ports.at(-1)?.endpoint.device.snapshot() as { position: number[]; hold: number; spindle: string };
  });
}

async function connect(page: Page): Promise<Worker> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const worker = await machineWorker(page);
  expect(await request(worker, { v: 3, kind: 'open', port: PORT })).toMatchObject({ ok: true });
  await expect.poll(async () => (await session(worker)).reports.phase, { timeout: 10_000 }).toBe('done');
  await expect.poll(async () => (await session(worker)).base, { timeout: 10_000 }).toBe('IDLE_UNHOMED');
  return worker;
}

/** A job of `n` short moves back and forth (each about 0.4 s on the simulated board), then `tail`. */
function zigzag(n: number, tail: readonly string[] = [], head: readonly string[] = []): string {
  const lines = ['G21 G90', ...head, 'G0 X0 Y0'];
  for (let i = 0; i < n; i++) lines.push(`G1 X${i % 2 === 0 ? 5 : 0} Y${(i * 0.5).toFixed(1)} F800`);
  return `${[...lines, ...tail, 'M30'].join('\n')}\n`;
}

/** Opens `text` in the Run view and waits until the worker has checked it with the board. */
async function open(page: Page, text: string, name = 'job.nc'): Promise<void> {
  await page.locator('[data-region="job"] [data-preview="file"]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.locator('[data-job="check"]')).toContainText('Checked with this board', { timeout: 15_000 });
}

/** Ticks what the stepper asks for (unhomed C36, work zero C31, spindle C32, the attestation), then Start and C30. */
async function start(page: Page): Promise<void> {
  for (const box of ['confirm-unhomed', 'confirm-zero', 'confirm-spindle', 'confirm-attended']) {
    const el = page.locator(`[data-job="${box}"]`);
    if ((await el.count()) > 0) await el.check();
  }
  await expect(page.locator('[data-job="blockers"]')).toHaveCount(0);
  const button = page.locator('[data-action="start-job"]');
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.locator('[data-safety="C30"]')).toBeVisible();
  await page.locator('[data-safety="C30"] [data-action="motion-confirm"]').click();
}

async function shot(page: Page, name: string, selector?: string): Promise<void> {
  if (SHOTS === undefined) return;
  await page.waitForTimeout(300);
  if (selector === undefined) await page.screenshot({ path: `${SHOTS}/${name}-1440.png` });
  else await page.locator(selector).screenshot({ path: `${SHOTS}/${name}-1440.png` });
}

test('a file streams to completion from the stepper; Start is enabled only when every blocker is gone; rxm set and put back', async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await connect(page);
  expect((await session(worker)).footerRev).toBe(2);
  await open(page, zigzag(24, [], ['M3 S12000']).replace('M30', 'M5\nM30'));
  // Every blocker named before the ticks; Start disabled.
  const blockers = page.locator('[data-job="blockers"] li');
  await expect(blockers.first()).toBeVisible();
  expect(await page.locator('[data-job="blockers"] [data-blocker]').evaluateAll((els) => els.map((e) => e.getAttribute('data-blocker')))).toEqual(['homed', 'zero', 'spindle', 'attended']);
  await expect(page.locator('[data-action="start-job"]')).toBeDisabled();
  const from = (await writes(worker)).length;
  await start(page);
  await expect.poll(() => phase(worker), { timeout: 10_000 }).toBe('running');
  await expect(page.locator('[data-job="status"]')).toBeVisible();
  await expect.poll(async () => (await session(worker)).job?.acked ?? 0, { timeout: 20_000 }).toBeGreaterThan(8);
  await shot(page, 'job-running');
  await page.locator('[data-tab="live"]').click();
  await expect(page.locator('[data-live="events"]')).toContainText('Streaming in line mode.');
  await shot(page, 'job-running-live');
  await expect.poll(() => phase(worker), { timeout: 60_000 }).toBe('done');
  await expect.poll(async () => (await session(worker)).footerRev, { timeout: 10_000 }).toBe(2);
  const w = (await writes(worker)).slice(from);
  expect(w.slice(0, 3)).toEqual(['{"rxm":null}\n', '{"rxm":1}\n', '{"rxm":null}\n']);
  expect(w.filter((x) => x.startsWith('N'))).toHaveLength((await session(worker)).job?.total as number);
  expect(w).toContain('{"rxm":0}\n');
  await expect(page.locator('[data-job="message"]')).toContainText('Job finished');
});

test('Pause holds the job and Resume streams on; Stop job clears the queue, spindle and coolant off', async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await connect(page);
  await open(page, zigzag(40));
  await start(page);
  await expect.poll(async () => (await session(worker)).job?.acked ?? 0, { timeout: 20_000 }).toBeGreaterThan(5);
  expect(await request(worker, { v: 3, kind: 'intent', intent: 'feedhold' })).toMatchObject({ ok: true });
  await expect.poll(() => phase(worker), { timeout: 10_000 }).toBe('paused');
  expect((await board(worker)).hold).toBe(6);
  await expect(page.locator('[data-job="phase"]')).toHaveText('Paused');
  await page.locator('[data-job="status"] [data-machine-control="resume"]').click();
  await expect.poll(() => phase(worker), { timeout: 10_000 }).toBe('running');
  await expect.poll(async () => (await session(worker)).job?.acked ?? 0, { timeout: 20_000 }).toBeGreaterThan(14);
  const from = (await writes(worker)).length;
  expect(await request(worker, { v: 3, kind: 'intent', intent: 'stopJob' })).toMatchObject({ ok: true });
  await expect.poll(() => phase(worker), { timeout: 15_000 }).toBe('stopped');
  const tail = (await writes(worker)).slice(from).filter((x) => !x.startsWith('{') && x !== '\x05');
  expect(tail.slice(0, 5)).toEqual(['!', '%', 'M5\n', 'M9\n', 'G90\n']);
  expect(tail.some((x) => x.startsWith('N'))).toBe(false);
  await expect(page.locator('[data-job="message"]')).toHaveText(/^Stopped at line \d+: queue cleared, spindle and coolant off$/);
  expect((await board(worker)).hold).toBe(0);
});

test('a manual tool change: stop before M6, spindle off, the card, jog away, Resume behind C34 and C35', async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await connect(page);
  const text = ['G21 G90', 'M3 S12000', 'G1 X3 F800', 'G1 X0', 'T2 M6', 'G1 X3 F800', 'G1 X0', 'M5', 'M30'].join('\n');
  await open(page, `${text}\n`, 'tool-change.nc');
  await start(page);
  await expect.poll(() => phase(worker), { timeout: 20_000 }).toBe('toolChange');
  const card = page.locator('[data-job="tool-change"]');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-safety="W37"]')).toBeVisible();
  await expect(card.locator('[data-job="tool-next"]')).toContainText('T2');
  await expect.poll(async () => (await board(worker)).spindle, { timeout: 5000 }).toBe('off');
  expect((await writes(worker)).some((w) => w.includes('M6'))).toBe(false);
  await shot(page, 'tool-change-card', '.run-inspector');
  await shot(page, 'tool-change');
  // Jog Z up from the Jog tab (allowed only at the tool change).
  await page.locator('[data-tab="jog"]').click();
  await page.locator('.sec-jog [aria-label="Step size"] button', { hasText: /^1$/ }).click();
  await page.getByRole('button', { name: 'Z up', exact: true }).click();
  await expect.poll(async () => (await session(worker)).base, { timeout: 10_000 }).toBe('PROGRAM_PAUSED');
  await expect(card.locator('[data-job="tool-moved"]')).toContainText('Yes');
  const from = (await writes(worker)).length;
  await card.locator('[data-action="tool-resume"]').click();
  await expect(page.locator('[data-safety="C34"]')).toBeVisible();
  await page.locator('[data-job="confirm-restart"]').check();
  await page.locator('[data-safety="C34"] [data-action="motion-confirm"]').click();
  await expect.poll(() => phase(worker), { timeout: 30_000 }).toBe('done');
  const after = (await writes(worker)).slice(from).filter((x) => !x.startsWith('{') && x !== '\x05');
  expect(after[0]).toMatch(/^G53 G0 Z/);
  expect(after.slice(1, 4)).toEqual(['G53 G0 X0 Y0\n', 'M3 S12000\n', 'N5 T2 M6\n']);
});

test('a breakpoint stops the job before its line with the queue drained; Resume goes on', async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await connect(page);
  await open(page, zigzag(12), 'breakpoint.nc');
  await page.locator('[data-tab="gcode"]').click();
  await page.locator('.preview-row[data-line="9"] [data-gcode="breakpoint"]').click();
  await expect(page.locator('.preview-row[data-line="9"]')).toHaveAttribute('data-breakpoint', 'true');
  await start(page);
  await expect.poll(() => phase(worker), { timeout: 30_000 }).toBe('breakpoint');
  await expect(page.locator('[data-job="breakpoint"] [data-safety="W43"]')).toHaveText('Stopped at breakpoint · line 9');
  expect((await writes(worker)).filter((w) => w.startsWith('N')).at(-1)).toMatch(/^N8 /);
  await page.locator('[data-job="breakpoint"] [data-action="job-resume"]').click();
  await expect.poll(() => phase(worker), { timeout: 30_000 }).toBe('done');
});

test('a refused line holds the job at that line with W38; Skip line continues behind C33', async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await connect(page);
  await open(page, zigzag(16), 'refused.nc');
  await worker.evaluate(() => {
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { device: { injectRefusal(m: RegExp, s: number): void } } }[] } }).__RUN_FAKE_SERIAL__;
    registry?.ports.at(-1)?.endpoint.device.injectRefusal(/^N7 /, 221);
  });
  await start(page);
  await expect.poll(() => phase(worker), { timeout: 30_000 }).toBe('refused');
  const card = page.locator('[data-job="refused"]');
  await expect(card.locator('[data-safety="W38"]')).toContainText('The controller refused line 7 (status 221: outside the soft limits)');
  await expect(card.locator('[data-job="refused-line"]')).toHaveText(/G1 X/);
  await page.waitForTimeout(800);
  await shot(page, 'refused-line-card', '.run-inspector');
  await shot(page, 'refused-line');
  await card.locator('[data-action="skip-line"]').click();
  await page.locator('[data-safety="C33"] [data-action="motion-confirm"]').click();
  await expect.poll(() => phase(worker), { timeout: 30_000 }).toBe('done');
});

test('a reset mid-job is a FAULT with W40; nothing more is written', async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await connect(page);
  await open(page, zigzag(30), 'reset.nc');
  await start(page);
  await expect.poll(async () => (await session(worker)).job?.acked ?? 0, { timeout: 20_000 }).toBeGreaterThan(4);
  await worker.evaluate(() => {
    const registry = (globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { device: { resetBoard(): void } } }[] } }).__RUN_FAKE_SERIAL__;
    registry?.ports.at(-1)?.endpoint.device.resetBoard();
  });
  await expect.poll(async () => (await session(worker)).fault?.cause, { timeout: 10_000 }).toBe('bannerAfterReady');
  const at = (await writes(worker)).length;
  await page.waitForTimeout(1500);
  expect((await writes(worker)).slice(at).some((w) => w.startsWith('N'))).toBe(false);
  expect(await phase(worker)).toBe('failed');
  await expect(page.locator('[data-job="message"]')).toContainText('The controller reset during the job at line');
});
