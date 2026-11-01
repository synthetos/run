/**
 * Driving `machine.worker` from a Playwright test (ROADMAP P0-14,
 * docs/testing/fake-serial.md).
 *
 * The page never exposes its Worker object, and nothing in the app has a
 * test hook. Instead the test evaluates code INSIDE the worker
 * (`Worker.evaluate`) that dispatches an ordinary request `message` event on
 * the worker's global scope, with a fresh MessageChannel port to answer on.
 * The worker's own listener handles it exactly as it handles a request
 * from the page (apps/web/src/machine-worker/machine.worker.ts).
 */
import type { Page, Worker } from '@playwright/test';
import { expect } from './fixtures.ts';

/** The served path prefix of the machine worker chunk. */
export const MACHINE_WORKER_PATH = /^\/assets\/machine\.worker-[A-Za-z0-9_-]{8}\.js$/;

/** Opens `/` and returns the page's machine worker once it has started. */
export async function machineWorker(page: Page): Promise<Worker> {
  const started = page.waitForEvent('worker', { predicate: (w) => MACHINE_WORKER_PATH.test(new URL(w.url()).pathname) });
  await page.goto('/');
  const worker = await started;
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  return worker;
}

/** Sends one request (`{ v: 1, kind }`, or any raw value) and returns the worker's reply. */
export function request(worker: Worker, message: unknown): Promise<unknown> {
  return worker.evaluate(
    (data) =>
      new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => reject(new Error('machine.worker did not answer within 5 s')), 5000);
        channel.port1.onmessage = (event) => {
          clearTimeout(timer);
          channel.port1.close();
          resolve(event.data);
        };
        globalThis.dispatchEvent(new MessageEvent('message', { data, ports: [channel.port2] }));
      }),
    message,
  );
}
