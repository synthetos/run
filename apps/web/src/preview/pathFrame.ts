/**
 * Which line of the open file the board's work position belongs to, and the offset that maps it into the
 * toolpath's frame (gcode frames.ts: the tool in the path's frame is `pos + programToPath(line)`).
 *
 * The board reports `line` and `pos` from the same place: the block running while it moves, and the model
 * (the last line it parsed) once it stops (@cite EN canonical_machine.c:2590-2595 cm_get_line, :2630-2636
 * _position_model, :145-154; the runtime takes a block's line and offsets together, plan_exec.c:216). So the
 * line it reports is the key, during a job and after it:
 * - running: the executing line, whose G92 the runtime applies;
 * - after M30: the M30 line, whose program end dropped the G92 (:2292-2333);
 * - after Stop job: the last line parsed, whose G92 the board keeps (the queue flush leaves it, :2127).
 * When the board reports a line outside the job (0 after a jog, which has no N word), the last answered line
 * stands in. With no started job of this file, the offset before its first line applies.
 *
 * Known gap: a G92 queued between two moves reaches the board's runtime before the next move's line number
 * does, so for that instant the reported line is the one before it.
 */
import { useMemo } from 'preact/hooks';
import { nextG92Line, programToPath, type ProgramFrames } from '@synthetos/gcode';
import type { Vec3 } from '@synthetos/gcode-view';
import type { PreviewResult } from '../gcode-worker/pipeline.ts';
import { bytesHash } from './gcodeList.ts';

/** What the frame needs of the worker's job (machine JobView). */
export interface FrameJob {
  readonly hash: string;
  readonly startedAt: number | null;
  readonly executing: { readonly line: number } | null;
  readonly ackedThrough: number | null;
}

export interface LivePathFrame {
  /** The program-to-path offset at the board's line, mm. */
  readonly toPath: Vec3;
  /** The next line of the file that sets a G92 offset (the drawing may move when it runs), or null. */
  readonly nextG92: number | null;
}

export const PLANNED_FRAME: LivePathFrame = Object.freeze({ toPath: Object.freeze([0, 0, 0]) as unknown as Vec3, nextG92: null });

/** The file line whose offset the board's work position is in; 0 before the first line. */
export function frameLine(job: FrameJob | null, fileHash: string | null): number {
  if (job === null || fileHash === null || job.hash !== fileHash || job.startedAt === null) return 0;
  return job.executing?.line ?? job.ackedThrough ?? 0;
}

export function livePathFrame(frames: ProgramFrames | null, line: number): LivePathFrame {
  if (frames === null) return PLANNED_FRAME;
  return { toPath: programToPath(frames, line), nextG92: nextG92Line(frames, line) };
}

/** The frame for the open file's preview and the worker's job. */
export function useLivePathFrame(preview: PreviewResult | null, job: FrameJob | null): LivePathFrame {
  const hash = useMemo(() => (preview === null ? null : bytesHash(preview.bytes)), [preview]);
  const line = frameLine(job, hash);
  return useMemo(() => livePathFrame(preview?.frameTable ?? null, line), [preview, line]);
}
