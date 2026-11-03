/**
 * Shared helpers for the browser tests. "No request leaves the origin" is
 * not a helper: the origin guard asserts it for every test (fixtures.ts).
 */
import type { Page } from '@playwright/test';
import { expect } from './fixtures.ts';

/** The pages every safety-bar test visits. */
export const PAGES = ['/', '/wiring/', '/safety/', '/privacy/', '/no-such-page'] as const;

/** Waits until the page's entry script has run (it sets data-ready on <html>). */
export async function ready(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
}

/**
 * The connect-time status report configuration run writes (amendment 2026-11-02, SAFETY H64): the status report
 * list, `sv` 1, an absurd `si` back to 250, and the heartbeat. Allowed on the wire besides GETs.
 */
export function isReportConfig(w: string): boolean {
  return /^\{sr:\{([a-z]{2,4}:true,?)+\}\}\n$/.test(w) || /^\{(sv:1|si:250)\}\n$/.test(w) || w === '{"rt":{"hb":1000}}\n';
}
