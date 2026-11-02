/**
 * Headed Chrome for the bench runner: Google Chrome (not Playwright's
 * Chromium, so the enterprise policy in docs/bench/policy.md applies) with a
 * persistent profile, so the Web Serial grant and the sign-in survive
 * between runs. Playwright is loaded only here, only when a bench runs.
 */
import type { BenchBrowser } from './runner.ts';

export async function launchChrome(options: { readonly url: string; readonly profileDir: string }): Promise<BenchBrowser> {
  const { chromium } = await import('@playwright/test');
  const context = await chromium.launchPersistentContext(options.profileDir, { headless: false, channel: 'chrome', viewport: null });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(options.url);
  return { close: () => context.close() };
}
