/**
 * A deploy reaches the edge over a few seconds, and the first requests after `wrangler deploy` may still be answered
 * by the previous version. On 2026-11-18 the staging smoke test ran three seconds after a deploy that changed the
 * anonymous Permissions-Policy, read the old header, and rolled a good deploy back. The HTTP checks therefore run
 * again, a few seconds apart, until they come back clean; only findings that outlast the window are a regression.
 * Nothing passes because of the wait: the last run's findings are what the job sees.
 */
import type { SmokeFinding } from './checks.ts';

export interface RetryOptions {
  /** Runs in all, the first included. */
  readonly attempts: number;
  readonly delayMs: number;
  readonly wait?: (ms: number) => Promise<void>;
}

/** The window the deploy jobs allow: six runs, ten seconds apart, so a minute at most. */
export const PROPAGATION_RETRY: RetryOptions = Object.freeze({ attempts: 6, delayMs: 10_000 });

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Runs `check` until it returns no findings or the attempts run out; a throw counts as findings to retry. */
export async function untilClean(check: () => Promise<SmokeFinding[]>, options: RetryOptions): Promise<SmokeFinding[]> {
  const wait = options.wait ?? sleep;
  let findings: SmokeFinding[] = [];
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      findings = await check();
    } catch (error) {
      findings = [{ check: 'http', message: `could not complete: ${error instanceof Error ? error.message : String(error)}` }];
    }
    if (findings.length === 0) return [];
    if (attempt < options.attempts) await wait(options.delayMs);
  }
  return findings;
}
