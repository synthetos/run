/**
 * What the Position and Zero panels offer at a manual tool change (H74 as amended 2026-11-08). The session allows a
 * jog and the Z re-zero there, for the new tool's length, and nothing else that moves or changes an offset: an X, Y
 * or A zero would shift the rest of the job, which was checked at Start against the old offsets; Go to zero is not
 * offered (Resume returns to where the job stopped); temporary offsets and the coordinate system stay as they are.
 * The session refuses each of those again; this keeps the page from offering them.
 *
 * Pure.
 */
import type { MotionAxis, SnapshotMessage } from '../machine-worker/rpc.ts';

type Snapshot = SnapshotMessage['snapshot'];

export const TC_ZERO_REASON = "At a tool change only Z can be re-zeroed, for the new tool's length.";
export const TC_GO_REASON = 'Go to zero is not offered at a tool change: Resume returns the machine to where the job stopped.';
export const TC_OFFSET_REASON = 'Temporary offsets and the coordinate system are not changed at a tool change.';

/** The job is stopped at a manual tool change (Phase 3, H74). */
export function atToolChange(s: Snapshot | null | undefined): boolean {
  return s !== null && s !== undefined && s.base === 'PROGRAM_PAUSED' && s.job?.phase === 'toolChange';
}

export const TC_JOG_A_REASON = 'At a tool change A is not jogged: Resume returns X, Y and Z to where the job stopped, not A.';

/** Why a jog of `axes` is not offered now, or null (review N2). */
export function jogBlocked(s: Snapshot | null | undefined, axes: Readonly<Partial<Record<MotionAxis, 1 | -1>>>): string | null {
  return atToolChange(s) && axes.a !== undefined ? TC_JOG_A_REASON : null;
}

/** Why Set zero on `axes` is not offered now, or null. */
export function zeroBlocked(s: Snapshot | null | undefined, axes: readonly MotionAxis[]): string | null {
  return atToolChange(s) && !(axes.length === 1 && axes[0] === 'z') ? TC_ZERO_REASON : null;
}
