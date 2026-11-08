/**
 * The offsets read again once a job has ended (done, stopped or failed). A job's own G92, G10, G54..G59 or M2/M30
 * changes the board's work offsets without a read, so `ofs`, `g92`, `coor` and g54..g59 kept the values read
 * before it; the zero check before the next Start, the offsets panel and the DRO's total read them. Once per job,
 * when the board is quiet, as `seed` reads: the allow-matrix's `read` intent, as every read-back is. `unit` comes
 * first because g92 and g54..g59 are printed in it (@cite EN json_parser.c:828, config_app.c:858-871); with `dist`
 * it is also what the job card shows as the board's modes after the job, and with `plan` and `admo` what its start
 * line forecasts from (OD-19, boardModes.ts, jobModes.ts).
 *
 * Pure: it only queues reads on the reducer's transition.
 */
import { isReadAllowed } from '@synthetos/schema';
import type { Dialect } from '@synthetos/protocol';
import { jobActive, patchJob, type JobTx } from './jobState.ts';
import type { PendingRead } from './types.ts';

export const JOB_END_OFFSET_TOKENS: readonly string[] = Object.freeze(['unit', 'dist', 'plan', 'admo', 'coor', 'ofs', 'g92', 'g54', 'g55', 'g56', 'g57', 'g58', 'g59']);

export function maybeRereadOffsets(t: JobTx, allowedNow: boolean): void {
  const s = t.s;
  const job = s.job;
  if (!allowedNow || job === null || job.endedAt === null || job.offsetsReread === true || jobActive(s) || s.motion !== null) return;
  if (s.queue.length > 0 || s.writing !== null || s.expected.some((e) => !e.late) || s.rxm.step !== null) return;
  const d = s.dialect as Dialect;
  const reads: PendingRead[] = JOB_END_OFFSET_TOKENS.filter((token) => isReadAllowed(d.id, token)).map((token) => ({ token, purpose: 'seed' }));
  patchJob(t, { offsetsReread: true });
  t.set({ queue: [...s.queue, ...reads] });
  t.emit({ kind: 'log', text: `job: ended; the work offsets it may have changed are read again (${reads.map((r) => r.token).join(', ')})` });
}
