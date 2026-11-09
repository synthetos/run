/**
 * Line density (docs/design/ANALYZE.md §2, slice 1): how many lines per second each feed move needs at its programmed
 * feed, as a histogram, and the dense sections where many short lines follow each other. A dense section may pause
 * for more instructions; whether it does depends on the connection, which slice 1 does not measure, so the threshold
 * is an assumption and says so. Pure.
 */
import { TAPE_KIND, type DensityBucket, type ProgramTape, type Region } from './types.ts';
import { feedSeconds, isFeedMove, isRapid, linesPerSecond } from './moves.ts';

/** The default dense threshold, lines per second: an assumption until delivery is measured (slice 3). */
export const DENSE_LINES_PER_SECOND = 50;
/** A dense section has at least this many lines, and takes at least this long at its programmed feed. */
export const MIN_DENSE_LINES = 25;
export const MIN_DENSE_SECONDS = 1;
/** How a run of moves holds together: how many other moves in a row it tolerates, and whether rapids may be among them. */
export interface RunRules {
  readonly gap: number;
  readonly rapidsJoin: boolean;
}

/**
 * Dense sections join across the lifts and short links between passes (CAM's "ugly little lines" come in passes),
 * so one pocket is one section, not hundreds. A stop, a dwell or a tool change still ends them.
 */
export const DENSE_RULES: RunRules = { gap: 12, rapidsJoin: true };
/** Slow sections are plain stretches: a rapid ends them, and two other moves in a row at most do not. */
export const SLOW_RULES: RunRules = { gap: 2, rapidsJoin: false };

const EDGES = [0, 10, 25, 50, 100, 200] as const;

export function densityBuckets(t: ProgramTape): DensityBucket[] {
  const counts = new Array<number>(EDGES.length).fill(0);
  for (let e = 0; e < t.count; e++) {
    if (!isFeedMove(t, e)) continue;
    const r = linesPerSecond(t, e);
    if (r === null) continue;
    let b = EDGES.length - 1;
    while (r < (EDGES[b] as number)) b--;
    counts[b] = (counts[b] as number) + 1;
  }
  return EDGES.map((min, i) => {
    const max = EDGES[i + 1] ?? Infinity;
    return { label: max === Infinity ? `${min}+ lines/s` : `${min}–${max} lines/s`, min, max, lines: counts[i] as number };
  });
}

interface Run {
  from: number;
  last: number;
  lines: Set<number>;
  seconds: number;
  mm: number;
  feed: number;
}

/** Ends a run: only big enough runs become regions. */
function close(t: ProgramTape, run: Run | null, kind: Region['kind'], out: Region[], minLines: number, minSeconds: number): void {
  if (run === null || run.lines.size < minLines || run.seconds < minSeconds) return;
  out.push({
    id: `${kind}-${t.sent[run.from] as number}`,
    kind,
    fromLine: t.source[run.from] as number,
    toLine: t.source[run.last] as number,
    fromSent: t.sent[run.from] as number,
    toSent: t.sent[run.last] as number,
    lines: run.lines.size,
    seconds: run.seconds,
    // Every member move takes time (dense members need a rate, slow runs a minimum time), so seconds > 0.
    linesPerSecond: run.lines.size / run.seconds,
    meanMoveMm: run.mm / run.lines.size,
    feed: run.feed,
  });
}

/**
 * Runs of feed moves that `member` accepts. Up to `rules.gap` other moves in a row (and rapids, when `rules.rapidsJoin`)
 * do not end a run; a stop, a dwell, a tool change, an unmodelled line or a move with no feed does. `minSeconds` drops
 * runs too short to matter.
 */
export function runsOf(t: ProgramTape, kind: Region['kind'], member: (e: number) => boolean, rules: RunRules, minLines: number, minSeconds = 0): Region[] {
  const out: Region[] = [];
  let run: Run | null = null;
  let gap = 0;
  for (let e = 0; e < t.count; e++) {
    const k = t.kinds[e];
    if (k === TAPE_KIND.COMMAND) continue;
    if (!isFeedMove(t, e)) {
      if (run !== null && rules.rapidsJoin && isRapid(t, e) && ++gap <= rules.gap) continue;
      close(t, run, kind, out, minLines, minSeconds);
      run = null;
      continue;
    }
    const s = feedSeconds(t, e);
    if (s === null || !member(e)) {
      if (run !== null && s !== null && ++gap <= rules.gap) continue;
      close(t, run, kind, out, minLines, minSeconds);
      run = null;
      continue;
    }
    gap = 0;
    run ??= { from: e, last: e, lines: new Set(), seconds: 0, mm: 0, feed: Infinity };
    run.last = e;
    run.lines.add(t.sent[e] as number);
    run.seconds += s;
    run.mm += t.lengthMm[e] as number;
    run.feed = Math.min(run.feed, t.feed[e] as number);
  }
  close(t, run, kind, out, minLines, minSeconds);
  return out;
}

/** Dense sections: runs of moves that each need at least `threshold` lines per second. */
export function denseRegions(t: ProgramTape, threshold: number): Region[] {
  return runsOf(t, 'dense', (e) => (linesPerSecond(t, e) as number) >= threshold, DENSE_RULES, MIN_DENSE_LINES, MIN_DENSE_SECONDS);
}
