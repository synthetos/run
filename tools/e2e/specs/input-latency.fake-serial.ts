/**
 * Pause and Stop job never wait behind the 3D view (render-budget, 2026-11-10), in the built app (fake-serial TEST
 * build) on headless Chromium's software WebGL (SwiftShader, no GPU): during a job, with the 3D view drawing, the
 * time from the pointerdown on Pause (its event timestamp, so any wait behind a frame counts) to the `!` written to
 * the simulated board stays under 100 ms. The same for Stop job. Long tasks on the page are logged for the report.
 */
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { connect, open, phase, session, start, zigzag } from './jobFlow.ts';

const BUDGET_MS = 100;

/** In the worker: the absolute time (timeOrigin + now) of the next host write that holds `!`. */
async function armBang(worker: Worker): Promise<void> {
  await worker.evaluate(() => {
    interface Rec {
      record(e: { t: number; kind: string; data?: Uint8Array }): void;
    }
    const g = globalThis as unknown as { __RUN_FAKE_SERIAL__?: { ports: { endpoint: { transcript: Rec } }[] }; __bangAt?: number | null; __bangHooked?: boolean };
    g.__bangAt = null;
    if (g.__bangHooked === true) return;
    const transcript = g.__RUN_FAKE_SERIAL__?.ports.at(-1)?.endpoint.transcript;
    if (transcript === undefined) throw new Error('no simulated port');
    const original = transcript.record.bind(transcript);
    transcript.record = (e) => {
      if (e.kind === 'host-write' && e.data?.includes(0x21) === true && g.__bangAt === null) g.__bangAt = performance.timeOrigin + performance.now();
      original(e);
    };
    g.__bangHooked = true;
  });
}

function bangAt(worker: Worker): Promise<number | null> {
  return worker.evaluate(() => (globalThis as unknown as { __bangAt?: number | null }).__bangAt ?? null);
}

/** In the page: the absolute timestamp of every pointerdown (capture phase, before any handler), and long tasks. */
async function watchPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = globalThis as unknown as { __downAt?: number | null; __long?: number[] };
    g.__downAt = null;
    g.__long = [];
    document.addEventListener('pointerdown', (e) => { g.__downAt = performance.timeOrigin + e.timeStamp; }, { capture: true });
    try {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) g.__long?.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false });
    } catch {
      // No long-task timing: the latency is still measured.
    }
  });
}

/**
 * One press. Everything that talks to the page happens first; then a wait of `phaseMs` with nothing sent, so the
 * press lands at a chosen point of the frame cycle (a press sent right after a page round trip always lands just
 * after a frame, which would hide the wait behind the next one).
 */
async function press(page: Page, worker: Worker, selector: string, phaseMs: number): Promise<number> {
  await armBang(worker);
  await page.evaluate(() => { (globalThis as unknown as { __downAt?: number | null }).__downAt = null; });
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} is not visible`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await new Promise((resolve) => setTimeout(resolve, phaseMs));
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => bangAt(worker), { timeout: 5000, intervals: [5] }).not.toBeNull();
  const down = await page.evaluate(() => (globalThis as unknown as { __downAt?: number | null }).__downAt ?? null);
  const bang = await bangAt(worker);
  if (down === null || bang === null) throw new Error('no pointerdown or no ! recorded');
  return bang - down;
}

test('during a job with the 3D view drawing, Pause and Stop job reach the board within 100 ms', async ({ page }) => {
  test.setTimeout(180_000);
  const worker = await connect(page);
  await open(page, zigzag(200));
  await expect(page.locator('[data-preview="canvas"]').first()).toBeVisible();
  await watchPage(page);
  await start(page);
  await expect.poll(async () => (await session(worker)).job?.acked ?? 0, { timeout: 20_000 }).toBeGreaterThan(5);
  // From here on the job runs: long tasks before this (the file check, the start) are not the 3D view's frames.
  await page.evaluate(() => { (globalThis as unknown as { __long?: number[] }).__long = []; });

  // Presses spread over the light frame interval (500 ms): one of them lands inside a frame if frames are long.
  const phases = [0, 60, 130, 200, 270, 340, 410, 480];
  const pauses: number[] = [];
  for (const phaseMs of phases) {
    await page.waitForTimeout(700);
    pauses.push(await press(page, worker, '[data-region="stop-controls"] .stop-button.pause', phaseMs));
    await expect.poll(() => phase(worker), { timeout: 10_000 }).toBe('paused');
    await page.locator('[data-job="status"] [data-machine-control="resume"]').click();
    await expect.poll(() => phase(worker), { timeout: 10_000 }).toBe('running');
  }
  // The light chip in the drawing, both themes (RUN_SCREENSHOTS_DIR).
  const shots = process.env['RUN_SCREENSHOTS_DIR'];
  if (shots !== undefined) {
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(700);
      await page.locator('[data-region="preview"]').screenshot({ path: `${shots}/light-preview-${theme}.png` });
    }
  }
  await page.waitForTimeout(1500);
  const stop = await press(page, worker, '[data-region="stop-controls"] [data-action="stop-job"]', 250);
  const long = await page.evaluate(() => (globalThis as unknown as { __long?: number[] }).__long ?? []);
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null | undefined;
    return gl === null || gl === undefined ? 'no webgl2' : String(info === null || info === undefined ? gl.getParameter(gl.RENDERER) : gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  });
  const chip = await page.locator('[data-preview="light"]').count();
  const frame = await page.locator('[data-preview="canvas"]').first().evaluate((el) => `${(el as HTMLElement).dataset['frameMs'] ?? '?'}ms@${(el as HTMLElement).dataset['frameScale'] ?? '?'}`);
  console.log(`LATENCY renderer=${renderer} pause=${pauses.map((p) => p.toFixed(1)).join(',')} stop=${stop.toFixed(1)} longtasks=${long.length} maxLong=${Math.max(0, ...long)} long=[${long.join(',')}] frame=${frame} lightChip=${chip}`);
  for (const p of pauses) expect(p).toBeLessThan(BUDGET_MS);
  expect(stop).toBeLessThan(BUDGET_MS);
});
