/** Shared helpers for the P0-05 browser tests. */
import { expect, type Page } from '@playwright/test';

/** The pages every safety-bar test visits. */
export const PAGES = ['/', '/safety/', '/privacy/', '/no-such-page'] as const;

/** Collects every request URL the page makes, from before navigation. */
export function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  return urls;
}

/** Fails if any request left the origin under test (T-S25). */
export function expectSameOrigin(urls: readonly string[], baseURL: string | undefined): void {
  expect(urls.length).toBeGreaterThan(0);
  for (const url of urls) expect(url.startsWith(`${baseURL ?? ''}/`), url).toBe(true);
}

/** Waits until the page's entry script has run (it sets data-ready on <html>). */
export async function ready(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
}
