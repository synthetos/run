/** Large-file drawing and display-only detail changes. No machine is connected. */
import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures.ts';
import { ready } from './helpers.ts';

const renderer = process.env['RUN_PREVIEW_RENDERER'] ?? 'default';
if (renderer === 'metal') test.use({ launchOptions: { args: ['--use-angle=metal'] } });
test.describe(`preview detail (${renderer})`, () => {
  test('draws a large file, keeps the parsed result, and refines only with acceleration', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');
    await ready(page);
    await page.locator('[data-action="ui-level-advanced"]').click();
    const supplied = process.env['RUN_PREVIEW_LARGE_FILE'];
    const buffer = supplied === undefined
      ? Buffer.from('G21 G90\nG0 X0 Y0\n' + 'G1 X1 F1000\nG1 X0\n'.repeat(155_000) + 'M30\n')
      : readFileSync(supplied);
    let loads = 0;
    page.on('worker', worker => { if (worker.url().includes('gcode.worker')) loads++; });
    const start = await page.evaluate(() => performance.now());
    await page.locator('[data-preview="file"]').first().setInputFiles({ name: 'raster-large.nc', mimeType: 'text/plain', buffer });
    const canvas = page.locator('[data-preview="canvas"]').first();
    await expect(canvas).toHaveAttribute('data-first-draw-at', /\d/, { timeout: 120_000 });
    const firstDraw = Number(await canvas.getAttribute('data-first-draw-at')) - start;
    const rendererName = await canvas.evaluate(el => {
      const gl = (el as HTMLCanvasElement).getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return gl === null ? 'none' : String(gl.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
    });
    await expect(canvas).toHaveAttribute('data-detail', /coarse|full/, { timeout: 60_000 });
    const light = await page.locator('[data-preview="light"]').count();
    let fullDraw: number | null = null;
    if (light > 0) {
      await expect(page.locator('[data-preview="light"]')).toContainText('Coarse detail');
      await expect(canvas).toHaveAttribute('data-detail', 'coarse');
    } else {
      await expect(canvas).toHaveAttribute('data-full-draw-at', /\d/, { timeout: 60_000 });
      fullDraw = Number(await canvas.getAttribute('data-full-draw-at')) - start;
      await expect(page.locator('[data-preview="detail-progress"]')).toHaveCount(0);
    }
    const worker = page.workers().find(w => w.url().includes('gcode.worker'));
    for (const mode of ['lite', 'full', 'auto']) {
      await page.locator('[data-preview="mode"]').selectOption(mode);
      await expect(canvas).toBeVisible();
      expect(page.workers().includes(worker!)).toBe(true);
    }
    expect(loads).toBe(1);
    console.log(`PREVIEW_LOD ${JSON.stringify({ renderer, rendererName, supplied: supplied !== undefined, bytes: buffer.length, firstDrawMs: firstDraw, fullDrawMs: fullDraw, light: light > 0, loads })}`);
  });
});
