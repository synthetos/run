/**
 * Trusted Types under the production CSP (RUN_PLAN §6.4, T-S25: "Trusted
 * Types policies are only the two named ones").
 *
 * - The entry claims both policy names first (apps/web/src/security/tt.ts),
 *   so later code can create neither of them again, nor any other policy.
 * - HTML and script-URL sinks refuse plain strings.
 *
 * This file must write to an HTML sink to prove the browser refuses it, so
 * eslint.config.js exempts it (and only it) from run/no-html-sink.
 */
import { expect, test } from '@playwright/test';

test('no further Trusted Types policy can be created, including the two names already claimed', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-shell="workspace"]')).toBeAttached();
  const outcomes = await page.evaluate(() => {
    const tt = (globalThis as unknown as { trustedTypes: { createPolicy(n: string, r: object): unknown } }).trustedTypes;
    return ['rs-worker', 'rs-svg-export', 'default', 'evil'].map((name) => {
      try {
        tt.createPolicy(name, { createHTML: (s: string) => s });
        return `${name}: created`;
      } catch {
        return `${name}: refused`;
      }
    });
  });
  expect(outcomes).toEqual(['rs-worker: refused', 'rs-svg-export: refused', 'default: refused', 'evil: refused']);
});

test('HTML and script-URL sinks refuse plain strings', async ({ page }) => {
  await page.goto('/');
  const outcomes = await page.evaluate(() => {
    const attempt = (label: string, fn: () => void): string => {
      try {
        fn();
        return `${label}: allowed`;
      } catch (e) {
        return `${label}: ${(e as Error).name}`;
      }
    };
    const div = document.createElement('div');
    return [
      attempt('innerHTML', () => {
        div.innerHTML = '<img src=x>';
      }),
      attempt('script.src', () => {
        document.createElement('script').src = '/assets/x.js';
      }),
      attempt('new Worker', () => {
        new Worker('/assets/x.js');
      }),
    ];
  });
  expect(outcomes).toEqual(['innerHTML: TypeError', 'script.src: TypeError', 'new Worker: TypeError']);
});
