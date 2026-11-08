/**
 * The carve during a job (docs/design/tool-sim.md, slice 3): how far to carve while the board runs the open file.
 * The board's finished lines are the ones before the line it reports executing (`line` in the status report, as
 * the job maps it to a file line); the carve goes that far and never further: never `sentThrough`, never ahead
 * of the board. It only moves forward within a job, so a paused, stopped or finished job holds at its last
 * finished line. A new job (or a Stop and a new Start) is a new key and starts from that job's start.
 *
 * Pure apart from the hook at the bottom, which keeps the last answer between renders. Display only.
 */
import { useMemo, useRef } from 'preact/hooks';
import { bytesHash } from './gcodeList.ts';

/** What the live carve needs of the worker's job. */
export interface LiveCarveJob {
  readonly id: number;
  readonly hash: string;
  readonly startedAt: number | null;
  /** The file line the board reports executing, or null. */
  readonly executing: number | null;
  /** The job owns the machine now (running, paused, at a tool change …). */
  readonly active: boolean;
}

export interface LiveCarve {
  /** The job and start this answer belongs to. */
  readonly key: string;
  /** List lines to carve: every sent line before the executing file line. */
  readonly target: number;
  readonly active: boolean;
}

/** The number of sent lines whose file line is before `fileLine` (sent lines are in file order). */
export function linesBefore(sourceLines: Uint32Array, fileLine: number): number {
  let lo = 0;
  let hi = sourceLines.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sourceLines[mid] as number) < fileLine) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The live carve after a job update, or null when no started job of this file exists. */
export function nextLiveCarve(prev: LiveCarve | null, job: LiveCarveJob | null, fileHash: string | null, sourceLines: Uint32Array): LiveCarve | null {
  if (job === null || job.startedAt === null || fileHash === null || job.hash !== fileHash) return null;
  const key = `${String(job.id)}:${String(job.startedAt)}`;
  const held = prev !== null && prev.key === key ? prev.target : 0;
  const finished = job.executing !== null && job.executing > 0 ? linesBefore(sourceLines, job.executing) : 0;
  return { key, target: Math.max(held, finished), active: job.active };
}

/**
 * The list lines to carve: the live carve while a job of this file owns the machine; after it, the live carve
 * held at its last finished line until the user scrubs; with no job, the scrubbed lines (0 for the whole file,
 * as `null`).
 */
export function carveTarget(live: LiveCarve | null, scrub: number): number | null {
  if (live !== null && (live.active || scrub === 0)) return live.target;
  return scrub > 0 ? scrub : null;
}

/** The live carve for the open file, kept between renders. */
export function useLiveCarve(job: LiveCarveJob | null, bytes: Uint8Array | null, sourceLines: Uint32Array | null): LiveCarve | null {
  const hash = useMemo(() => (bytes === null ? null : bytesHash(bytes)), [bytes]);
  const held = useRef<LiveCarve | null>(null);
  const next = sourceLines === null ? null : nextLiveCarve(held.current, job, hash, sourceLines);
  if (next === null || held.current === null || next.key !== held.current.key || next.target !== held.current.target || next.active !== held.current.active) held.current = next;
  return held.current;
}
