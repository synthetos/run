/**
 * The job analysis report, motion part (docs/design/ANALYZE.md slice 1): what the program does, from the
 * interpreter's event tape alone, with no questionnaire. Distances, the feed time at programmed speeds, rapids to
 * time once their speeds are known, dwells, operator stops, line density, slow sections and the operations.
 *
 * Time is "at programmed speeds, acceleration not included": an explanation users can check, never a
 * firmware-accurate ETA. Unknown stays unknown: a feed move with no feed, or one that turns a rotary axis, makes the
 * feed time unknown (its known part is kept apart), and rapids are untimed until their speeds come from the board,
 * a saved reading or the profile. Pure.
 */
import { DENSE_LINES_PER_SECOND, SLOW_RULES, denseRegions, densityBuckets, runsOf } from './density.ts';
import { feedSeconds, isFeedMove, isRapid, isRotary } from './moves.ts';
import { operations } from './operations.ts';
import { TAPE_FLAG, TAPE_KIND, type Evidence, type MoveLengths, type MotionInputs, type MotionTime, type ProgramReport, type ProgramTape, type Region, type ReportOptions, type XyzAxis } from './types.ts';

const FROM_FILE = 'From the file';
/** A slow section runs below this share of the file's main cutting feed. */
const SLOW_SHARE = 0.5;
/** ...for at least this many seconds, and this share of the feed time. */
const SLOW_MIN_SECONDS = 5;
const SLOW_MIN_SHARE = 0.03;

const file = (value: number | null, units: string): Evidence<number> => ({ value, source: 'file', label: FROM_FILE, units });

/** The feed with the most cutting distance: the yardstick for "slow". */
function mainFeed(t: ProgramTape): number | null {
  const mm = new Map<number, number>();
  for (let e = 0; e < t.count; e++) {
    const f = t.feed[e] as number;
    if (isFeedMove(t, e) && f > 0 && !isRotary(t, e)) mm.set(f, (mm.get(f) ?? 0) + (t.lengthMm[e] as number));
  }
  let best: number | null = null;
  let most = -1;
  for (const [f, d] of mm) if (d > most) [best, most] = [f, d];
  return best;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The feed moves' lengths: how many are tiny, and the median and first quartile. */
function moveLengths(t: ProgramTape): MoveLengths {
  const lengths: number[] = [];
  for (let e = 0; e < t.count; e++) if (isFeedMove(t, e) && !isRotary(t, e) && (t.lengthMm[e] as number) > 0) lengths.push(t.lengthMm[e] as number);
  const sorted = Float64Array.from(lengths).sort();
  const at = (q: number): number | null => (sorted.length === 0 ? null : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number));
  let under01 = 0;
  while (under01 < sorted.length && (sorted[under01] as number) < 0.1) under01++;
  return { moves: sorted.length, under01, median: at(0.5), quarter: at(0.25) };
}

export function analyzeProgram(t: ProgramTape, options: ReportOptions = {}): ProgramReport {
  let feedMm = 0;
  let rapidMm = 0;
  let arcs = 0;
  let known = 0;
  let untimed = 0;
  let rotaryFeed = 0;
  let rotaryRapid = 0;
  let unmodelled = 0;
  let uncertainFrom: number | null = null;
  let dwell = 0;
  let dwells = 0;
  const rapids: number[] = [];
  const stops: number[] = [];
  const changes: number[] = [];
  for (let e = 0; e < t.count; e++) {
    const k = t.kinds[e];
    const flags = t.flags[e] as number;
    if ((flags & TAPE_FLAG.UNCERTAIN) !== 0 && uncertainFrom === null) uncertainFrom = t.source[e] as number;
    if (k === TAPE_KIND.UNMODELLED) unmodelled++;
    else if (k === TAPE_KIND.DWELL) {
      dwells++;
      dwell += t.seconds[e] as number;
    } else if (k === TAPE_KIND.BARRIER) stops.push(t.source[e] as number);
    else if (k === TAPE_KIND.TOOL_CHANGE) changes.push(t.source[e] as number);
    else if (isRapid(t, e)) {
      rapidMm += t.lengthMm[e] as number;
      if (isRotary(t, e)) rotaryRapid++;
      else rapids.push(Math.abs(t.delta[e * 3] as number), Math.abs(t.delta[e * 3 + 1] as number), Math.abs(t.delta[e * 3 + 2] as number));
    } else if (isFeedMove(t, e)) {
      feedMm += t.lengthMm[e] as number;
      if (k === TAPE_KIND.ARC) arcs++;
      if (isRotary(t, e)) rotaryFeed++;
      const s = feedSeconds(t, e);
      if (s === null) untimed++;
      else known += s;
    }
  }
  const reasons: string[] = [];
  const rotary = rotaryFeed + rotaryRapid;
  if (untimed > rotaryFeed) reasons.push(`${plural(untimed - rotaryFeed, 'feed move has', 'feed moves have')} no feed rate.`);
  if (rotary > 0) reasons.push(`${plural(rotary, 'move turns', 'moves turn')} a rotary axis. These are not timed.`);
  if (unmodelled > 0) reasons.push(`${plural(unmodelled, 'line', 'lines')} could not be modelled.`);
  if (uncertainFrom !== null) reasons.push(`Positions from line ${uncertainFrom} may not match the file.`);
  const threshold = options.denseLinesPerSecond ?? DENSE_LINES_PER_SECOND;
  const main = mainFeed(t);
  const slowLimit = main === null ? 0 : main * SLOW_SHARE;
  const slow: Region[] = main === null ? [] : runsOf(t, 'slow', (e) => (t.feed[e] as number) < slowLimit, SLOW_RULES, 1, Math.max(SLOW_MIN_SECONDS, known * SLOW_MIN_SHARE));
  return {
    lines: t.count === 0 ? 0 : (t.sent[t.count - 1] as number) + 1,
    coverage: { events: t.count, supported: t.count - unmodelled - rotary, reasons },
    feedMm: file(feedMm, 'mm'),
    rapidMm: file(rapidMm, 'mm'),
    arcs,
    feedSeconds: file(untimed === 0 ? known : null, 's'),
    knownFeedSeconds: known,
    untimedMoves: untimed,
    rapidDeltas: Float64Array.from(rapids),
    untimedRapids: rotaryRapid,
    dwellSeconds: file(dwell, 's'),
    dwells,
    stopLines: stops,
    toolChangeLines: changes,
    density: {
      threshold: { value: threshold, source: 'assumption', label: 'Assumed until the connection is measured', units: 'lines/s' },
      buckets: densityBuckets(t),
      regions: denseRegions(t, threshold),
    },
    slow,
    operations: operations(t, options.headings ?? []),
    moveLengths: moveLengths(t),
  };
}

const AXES: readonly XyzAxis[] = ['X', 'Y', 'Z'];

/** Rapid seconds from each axis's rapid speed: the slowest axis for its share of the move sets the time. */
function rapidTime(deltas: Float64Array, untimed: number, inputs: MotionInputs): Evidence<number> {
  const first = AXES.map((a) => inputs.rapid[a]).find((v) => v.value !== null) ?? inputs.rapid.X;
  const meta = { source: first.source, label: first.label, units: 's', ...(first.observedAt === undefined ? {} : { observedAt: first.observedAt }) };
  if (untimed > 0) return { ...meta, value: null };
  let minutes = 0;
  for (let i = 0; i < deltas.length; i += 3) {
    let m = 0;
    for (let k = 0; k < 3; k++) {
      const d = deltas[i + k] as number;
      if (d === 0) continue;
      const vm = inputs.rapid[AXES[k] as XyzAxis].value;
      if (vm === null || !(vm > 0)) return { ...meta, value: null };
      m = Math.max(m, d / vm);
    }
    minutes += m;
  }
  return { ...meta, value: minutes * 60 };
}

/** The motion time at programmed speeds, acceleration not included, with what is missing said in plain words. */
export function motionTime(report: ProgramReport, inputs: MotionInputs): MotionTime {
  const rapid = rapidTime(report.rapidDeltas, report.untimedRapids, inputs);
  const missing: string[] = [];
  if (report.feedSeconds.value === null) missing.push(`${plural(report.untimedMoves, 'feed move is', 'feed moves are')} not timed.`);
  if (report.untimedRapids > 0) missing.push('Rapids that turn a rotary axis are not timed.');
  else if (rapid.value === null) missing.push('Rapid speeds are not known. Connect your machine to improve the time estimate.');
  const parts = [report.feedSeconds.value, rapid.value, report.dwellSeconds.value];
  const total = parts.every((p) => p !== null) ? (parts as number[]).reduce((a, b) => a + b, 0) : null;
  const knownSeconds = (report.feedSeconds.value ?? report.knownFeedSeconds) + (rapid.value ?? 0) + (report.dwellSeconds.value as number);
  return { feedSeconds: report.feedSeconds, rapidSeconds: rapid, dwellSeconds: report.dwellSeconds, totalSeconds: total, knownSeconds, manualStops: report.stopLines.length + report.toolChangeLines.length, missing };
}
