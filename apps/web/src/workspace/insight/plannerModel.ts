/**
 * The Advanced planner rows (owner, 2026-11-09), from live state already polled: no new board traffic. Pure.
 * - Buffer: planner blocks in use, `total − qr`, out of the board's planner size (32 when it is not known). It is
 *   starving while a job runs with fewer than 4 in use: the planner is close to running out of motion.
 * - Queued motion: the session's estimate of the motion the controller holds (seconds, and at most mm).
 * - Lines: sent, answered, and the line number the board reports executing (`line`), during a job.
 */
import type { JobSnapshot } from '../jobUi.ts';

/** The planner size used when the board's is not known (TinyG and g2core both have 32 blocks). */
export const DEFAULT_PLANNER_BLOCKS = 32;
/** Fewer blocks than this in use while a job runs is starving. */
export const STARVING_BELOW = 4;

export interface PlannerInput {
  readonly qr: number | null;
  readonly plannerBlocks: number | null;
  readonly job: JobSnapshot | null;
}

export interface PlannerRows {
  readonly buffer: { readonly used: number; readonly total: number; readonly starving: boolean } | null;
  readonly queued: { readonly seconds: number; readonly mm: number | null } | null;
  readonly lines: { readonly sent: number; readonly acked: number; readonly total: number; readonly executing: number | null } | null;
}

export function plannerRows({ qr, plannerBlocks, job }: PlannerInput): PlannerRows {
  const total = plannerBlocks ?? DEFAULT_PLANNER_BLOCKS;
  const running = job !== null && job.phase === 'running';
  const buffer = qr === null || !Number.isFinite(qr) ? null : (() => {
    const used = Math.min(total, Math.max(0, total - qr));
    return { used, total, starving: running && used < STARVING_BELOW };
  })();
  const active = job !== null && job.startedAt !== null && job.endedAt === null;
  return {
    buffer,
    queued: active ? { seconds: job.queuedSeconds, mm: job.queuedBoundMm } : null,
    lines: active ? { sent: job.sent, acked: job.acked, total: job.total, executing: job.executing?.n ?? null } : null,
  };
}
