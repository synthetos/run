/**
 * Shared helpers for the browser tests. "No request leaves the origin" is
 * not a helper: the origin guard asserts it for every test (fixtures.ts).
 */
import type { Page } from '@playwright/test';
import { expect } from './fixtures.ts';

/** The pages every safety-bar test visits. */
export const PAGES = ['/', '/safety/', '/privacy/', '/no-such-page'] as const;

/** Waits until the page's entry script has run (it sets data-ready on <html>). */
export async function ready(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
}
