import { type JsonObject, type Response } from '@synthetos/protocol';
import { foldFeedLimit } from '../feedLimit.ts';
import { jobEvent, patchJob } from '../jobState.ts';
import type { PendingRead, SessionState } from '../types.ts';
import { type JobLayerTx } from './contract.ts';
import { queue } from './shared.ts';

/** The job flag (MACHINING_ASSISTANT feed-limit step 3): RAM only, capability-probed (c7f9b7e2 runtime.c:189-248). */
export function jobFlagLine(on: 0 | 1): string {
  return `{"rt":{"job":${on}}}`;
}

/** The feed-limit window (`{"rt":{"fi":N}}`, N seconds, 0 stops crediting): RAM only, accepted on at quiescence. */
export function feedLimitLine(seconds: number): string {
  return `{"rt":{"fi":${Math.round(seconds)}}}`;
}

/**
 * The capability probe of the job flag: true only when the board's `{"rt":null}` answer at connect names a `job`
 * leaf. Released 450.02 has no such leaf, so its writes remain unchanged.
 */
export function jobFlagSupported(s: SessionState): boolean {
  return s.rtLeaves.includes('job');
}

/** The first firmware build with the N66 fix (firmware maintainer, 2026-11-05: tag 450.02, edge-next a7489b79). */
export const FEED_ACCOUNTING_MIN_FB = 450.02;

/** True when the board's build has the N66 fix (fb 450.02 or later, compared in hundredths). */
export function feedAccountingSafe(s: SessionState): boolean {
  const fb = s.identity?.fb;
  return typeof fb === 'number' && Math.round(fb * 100) >= Math.round(FEED_ACCOUNTING_MIN_FB * 100);
}

/** The feed-limit window is offered where `{"rt":null}` names an `fi` leaf (edge-next a7489b79 has it). */
export function feedLimitSupported(s: SessionState): boolean {
  return s.rtLeaves.includes('fi');
}

/** The job flag, only where the capability probe found it (MACHINING_ASSISTANT feed-limit step 3). */
export function sendJobFlag(t: JobLayerTx, on: 0 | 1): void {
  if (!jobFlagSupported(t.s) || t.s.job?.jobFlag === on) return;
  queue(t, { token: 'rt', purpose: 'jobRuntime', line: jobFlagLine(on) });
  patchJob(t, { jobFlag: on });
}

/** A job `rt` line was answered: a refusal is recorded, never acted on (the job runs without it). */
export function onJobRuntimeAnswer(t: JobLayerTx, e: PendingRead, r: Response | null, at: number): void {
  const status = r === null ? -1 : r.footer.status;
  if (status === 0 || t.s.job === null) return;
  const what = e.line?.includes('"fi"') === true ? 'the feed-limit period' : e.line?.includes('"fg"') === true ? 'the supply-gap report' : 'the job flag';
  if (e.line?.includes('"fi"') === true && t.s.job.feedLimit !== null) patchJob(t, { feedLimit: null });
  jobEvent(t, at, 'info', `The controller did not take ${what} (status ${status}); the job runs without it.`);
}

export function onFeedLimit(t: JobLayerTx, kind: 'fs' | 'fl' | 'fg', body: JsonObject, short: boolean): void {
  const fl = t.s.job?.feedLimit;
  if (fl === null || fl === undefined) return;
  const next = foldFeedLimit(fl, kind, body, short);
  if (next !== fl) patchJob(t, { feedLimit: next });
}
