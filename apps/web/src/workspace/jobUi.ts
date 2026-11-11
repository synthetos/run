/**
 * Phase 3 jobs in the page (owner 2026-11-02; SAFETY §4.4a, H70-H78): what the Check → Set zero → Start stepper
 * shows and allows, decided from the worker's snapshot, the open file and the page's confirmations.
 *
 * - `jobUi`: the job as the worker reports it, and whether the jobs switch is on in this build.
 * - `startBlockers`: every reason Start is not allowed now, each in plain words. Start is enabled only when the
 *   list is empty. The session decides Start again with its own checks; this keeps the page honest.
 * - `zeroCheck`: plan versus board work zero. The plan is the board's work zero the user recorded for this file
 *   on this computer; a difference, or no plan, needs C31.
 * - `textHash`: the same FNV-1a the worker uses, so the page knows the loaded job is the file it previewed.
 *
 * Pause and Stop job are never decided here (SAFETY §4.1). Pure; the page sees the session only through the
 * worker RPC (T-S39).
 */
import type { SnapshotMessage } from '../machine-worker/rpc.ts';
import type { LiveView } from './model.ts';
import { readStored, writeStored, type StorageLike } from './storage.ts';

type Snapshot = SnapshotMessage['snapshot'];
export type JobSnapshot = NonNullable<Snapshot['job']>;
/** One feed-limit summary as the worker reports it (the page never imports the machine package: T-S39). */
type FeedSummary = NonNullable<NonNullable<JobSnapshot['feedLimit']>['last']>;

/** Phases in which a job owns the machine. */
export const ACTIVE_JOB_PHASES: ReadonlySet<string> = new Set(['checking', 'preparing', 'running', 'draining', 'ending', 'pausing', 'paused', 'refused', 'outputsOff', 'toolChange', 'breakpoint', 'programStop', 'resuming']);

/** FNV-1a (32 bit) of the text, as the worker computes it (packages/machine job.ts `textHash`). */
export function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The file bytes as the text the worker sanitises (Latin-1: one byte, one character, as the preview reads it). */
export function bytesText(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return out;
}

export interface JobUi {
  /** The worker's jobs switch is on (bench and staging builds only). */
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly job: JobSnapshot | null;
  /** The job owns the machine (preparing, streaming, paused or at a stop point). */
  readonly active: boolean;
  readonly snapshot: Snapshot | null;
  /** Time since the job started, or its run time once ended, ms. */
  readonly elapsedMs: number | null;
}

export function jobUi(view: LiveView | null): JobUi {
  const m = view?.message ?? null;
  const s = m === null || m.snapshot.base === 'NOT_CONNECTED' ? null : m.snapshot;
  const job = s?.job ?? null;
  const elapsed = m?.jobElapsedMs ?? null;
  const running = job !== null && job.endedAt === null && job.startedAt !== null;
  return {
    enabled: m?.jobs === true,
    connected: s !== null,
    job,
    active: job !== null && ACTIVE_JOB_PHASES.has(job.phase),
    snapshot: s,
    elapsedMs: elapsed === null ? null : elapsed + (running && view !== null ? Math.max(0, view.now - view.receivedAt) : 0),
  };
}

/** The board's work zero (the work offset `ofs`, machine coordinates) as read this session, or null. */
export function boardZero(s: Snapshot | null): { readonly x: number; readonly y: number; readonly z: number } | null {
  const v = s?.values['ofs'];
  if (v === undefined || v.status !== 0 || typeof v.value !== 'object' || v.value === null || Array.isArray(v.value)) return null;
  const o = v.value as Record<string, unknown>;
  const n = (k: string): number | null => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : null);
  const x = n('x');
  const y = n('y');
  const z = n('z');
  return x === null || y === null || z === null ? null : { x, y, z };
}

export interface ZeroPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const isZero = (v: unknown): v is ZeroPoint => typeof v === 'object' && v !== null && ['x', 'y', 'z'].every((k) => typeof (v as Record<string, unknown>)[k] === 'number');

/** The plan recorded for a file on this computer, or null. */
export function loadPlan(fileKey: string, storage?: StorageLike | null): ZeroPoint | null {
  return readStored(`job-plan.${fileKey}`, isZero, storage);
}

export function savePlan(fileKey: string, zero: ZeroPoint, storage?: StorageLike | null): boolean {
  return writeStored(`job-plan.${fileKey}`, zero, storage);
}

/** How close the board's zero must be to the plan to count as the same, mm. */
export const ZERO_TOLERANCE_MM = 0.05;

export type ZeroCheck =
  | { readonly state: 'unknown'; readonly text: string }
  | { readonly state: 'match'; readonly text: string; readonly board: ZeroPoint; readonly plan: ZeroPoint }
  | { readonly state: 'differs'; readonly text: string; readonly board: ZeroPoint; readonly plan: ZeroPoint | null };

export function zeroText(z: ZeroPoint): string {
  const f = (n: number): string => `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(3)}`;
  return `X ${f(z.x)} Y ${f(z.y)} Z ${f(z.z)} (machine)`;
}

/** Plan versus board (H73). */
export function zeroCheck(board: ZeroPoint | null, plan: ZeroPoint | null): ZeroCheck {
  if (board === null) return { state: 'unknown', text: 'The board’s work zero has not been read yet.' };
  if (plan === null) return { state: 'differs', text: `No plan is recorded for this file. The job will cut from the board’s work zero, ${zeroText(board)}.`, board, plan };
  const d = Math.max(Math.abs(board.x - plan.x), Math.abs(board.y - plan.y), Math.abs(board.z - plan.z));
  if (d <= ZERO_TOLERANCE_MM) return { state: 'match', text: `The board’s work zero matches your plan: ${zeroText(board)}.`, board, plan };
  const parts = (['x', 'y', 'z'] as const).filter((a) => Math.abs(board[a] - plan[a]) > ZERO_TOLERANCE_MM).map((a) => `${a.toUpperCase()} by ${Math.abs(board[a] - plan[a]).toFixed(2)} mm`);
  return { state: 'differs', text: `The board’s work zero is not your plan’s: it differs in ${parts.join(', ')}.`, board, plan };
}


/** Seconds as "1 h 02 min", "4 min 05 s" or "12 s". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`;
  if (s >= 60) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return `${s} s`;
}

/** The phase in the words of the strip and the job card. */
export const PHASE_TEXT: Readonly<Record<string, string>> = {
  loading: 'Checking with this board',
  ready: 'Ready',
  blocked: 'Blocked',
  checking: 'Checking again with this board',
  preparing: 'Preparing (line mode)',
  running: 'Job running',
  draining: 'Job running · stopping at the next stop point',
  ending: 'Job running · finishing',
  pausing: 'Pausing…',
  paused: 'Paused',
  refused: 'Paused · a line was refused',
  outputsOff: 'Tool change · turning the spindle and coolant off',
  toolChange: 'Tool change',
  breakpoint: 'Stopped at a breakpoint',
  programStop: 'Program stop',
  resuming: 'Resuming',
  done: 'Finished',
  stopped: 'Stopped',
  failed: 'Ended',
};

/** Planner view ranges in the preview's own sent-line indices (the preview is sanitised offline, so map by file line). */
export interface PlannerRanges {
  /** Lines before this index are cut. */
  readonly cutEnd: number;
  /** Lines in [cutEnd, execEnd) are executing now. */
  readonly execEnd: number;
  /** Lines in [execEnd, queuedEnd) are sent and acknowledged, not yet executed: in the planner. */
  readonly queuedEnd: number;
  /** Lines in [queuedEnd, sentEnd) are sent and waiting for their acknowledgement; the rest are not sent. */
  readonly sentEnd: number;
  /** The planner is starving (amber). */
  readonly starving: boolean;
}

/** First index whose file line is ≥ `line` (sourceLines is non-decreasing). */
function lowerBound(sourceLines: Uint32Array, line: number): number {
  let lo = 0;
  let hi = sourceLines.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sourceLines[mid] as number) < line) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The planner view of a running job, from file lines, in the preview's line indices; null when nothing runs. */
export function plannerRanges(job: JobSnapshot | null, sourceLines: Uint32Array, starving: boolean): PlannerRanges | null {
  if (job === null || job.startedAt === null || !ACTIVE_JOB_PHASES.has(job.phase) || job.phase === 'checking' || job.phase === 'preparing') return null;
  const exec = job.executing?.line ?? job.ackedThrough ?? 0;
  const cutEnd = lowerBound(sourceLines, exec);
  const execEnd = Math.max(cutEnd, lowerBound(sourceLines, exec + 1));
  const queuedEnd = Math.max(execEnd, lowerBound(sourceLines, (job.ackedThrough ?? 0) + 1));
  const sentEnd = Math.max(queuedEnd, lowerBound(sourceLines, (job.sentThrough ?? 0) + 1));
  return { cutEnd, execEnd, queuedEnd, sentEnd, starving };
}

/** The planner is starving: the job is cutting and the planner holds almost nothing (MACHINING_ASSISTANT §7). */
export function starving(s: Snapshot | null, plannerBlocks: number | null): boolean {
  const job = s?.job;
  if (s === null || job === undefined || job === null || job.phase !== 'running' || plannerBlocks === null) return false;
  const qr = s.live.qr;
  const vel = s.live.vel;
  return typeof qr === 'number' && typeof vel === 'number' && vel > 0 && plannerBlocks - qr <= 2 && job.sent < job.total;
}

/** Current firmware evidence only. A pending input gap is not blamed on the host or on an axis limit. */
export function feedDiagnosis(fl: JobSnapshot['feedLimit']): string | null {
  const m = fl?.move;
  if (m?.g === 2) return "Run didn't send lines fast enough";
  if (m?.g === 1) return 'Lines are waiting on the machine';
  if (fl?.last?.c.length === 7 && m?.k === 1 && m.p !== null && m.p >= 0 && m.p < 100 && (m.m & 63) !== 0) return 'The machine limited the speed';
  return null;
}

/** The causes of the firmware's feed-limit counters, in `c[]` order, as words (MACHINING_ASSISTANT appendix). */
export const FEED_CAUSES: readonly string[] = Object.freeze(['an axis speed limit', 'corners', 'exact stops', 'moves too short to reach the feed', 'single-segment moves', 'ramps and the end of the path', 'command boundaries']);

/** The `fl` cause bits, in the same words. */
const FEED_MOVE_CAUSES: readonly (readonly [number, string])[] = Object.freeze([
  [1, 'an axis speed limit'],
  [2, 'a corner'],
  [4, 'an exact stop'],
  [8, 'too short to reach the feed'],
  [16, 'a single-segment move'],
  [32, 'a command boundary'],
]);

export interface FeedShare {
  readonly cause: string;
  /** Share of the cutting time spent below the programmed feed under this cause (causes overlap: shares can sum above 1). */
  readonly fraction: number;
  readonly seconds: number;
}

/** What run shows from the feed-limit frames: observational, never a decision (H78). */
export interface FeedReport {
  readonly diagnosis: string | null;
  readonly cuttingS: number;
  readonly cuttingMm: number;
  /** Over the whole window (the job), largest first, causes under 2% left out. */
  readonly job: readonly FeedShare[];
  /** Over the last interval between two summaries, or null before the second summary. */
  readonly recent: readonly FeedShare[] | null;
  /** The executing move as last pushed: its percent of the programmed feed and its cause words; null between feed moves. */
  readonly move: { readonly pct: number | null; readonly causes: string } | null;
  /** Plain-language notes from the maintainer's thresholds, for the end of the job. */
  readonly notes: readonly string[];
  readonly short: boolean;
  readonly unsupported: boolean;
}

function shares(from: FeedSummary | null, to: FeedSummary): readonly FeedShare[] {
  const ct = to.ct - (from?.ct ?? 0);
  if (ct <= 0) return [];
  return FEED_CAUSES.map((cause, i) => {
    const ms = (to.c[i] ?? 0) - (from?.c[i] ?? 0);
    return { cause, fraction: Math.max(0, ms) / ct, seconds: Math.max(0, ms) / 1000 };
  })
    .filter((x) => x.fraction >= 0.02)
    .sort((a, b) => b.fraction - a.fraction);
}

const pct = (f: number): string => `${Math.round(f * 100)}%`;

export function feedReport(fl: JobSnapshot['feedLimit']): FeedReport | null {
  if (fl === null || fl === undefined) return null;
  const last = fl.last;
  const diagnosis = feedDiagnosis(fl) ?? (fl.gaps != null && (fl.gaps.g[1] ?? 0) > 0 ? "Run didn't send lines fast enough" : null);
  const move = fl.move === null || fl.move.k !== 1 ? null : { pct: fl.move.p, causes: FEED_MOVE_CAUSES.filter(([bit]) => (fl.move?.m ?? 0) & bit).map(([, w]) => w).join(', ') };
  if (last === null) return { diagnosis, cuttingS: 0, cuttingMm: 0, job: [], recent: null, move, notes: [], short: fl.short, unsupported: fl.unsupported };
  const job = shares(null, last);
  const of = (i: number): number => (last.ct > 0 ? (last.c[i] ?? 0) / last.ct : 0);
  const notes: string[] = [];
  if (of(0) > 0.05) notes.push(`An axis's own speed limit held the feed below the programmed value for ${pct(of(0))} of the cutting time: the programmed feed is above what the machine can do on that axis (its fr setting).`);
  if (of(3) + of(4) > 0.3) notes.push(`Moves too short to reach the feed for ${pct(Math.min(1, of(3) + of(4)))} of the cutting time: dense CAM output with these jerk settings, the usual reason a dense file runs slow.`);
  if (of(1) > 0.3) notes.push(`The planner slowed into corners for ${pct(of(1))} of the cutting time: normal on a cornered path; on a smooth path the junction settings (jd, ja) are conservative.`);
  if (of(5) > 0.3) notes.push(`Ramps and the end of the path for ${pct(of(5))} of the cutting time: expected at the start and end of every chain. A large share mid-job means the planner kept running out of look-ahead, which can be a supply gap, but ${last.c.length === 6 ? 'this firmware' : 'this counter alone'} does not report why.`);
  return {
    diagnosis,
    cuttingS: last.ct / 1000,
    cuttingMm: last.cd,
    job,
    recent: fl.prev === null ? null : shares(fl.prev, last),
    move,
    notes,
    short: fl.short,
    unsupported: fl.unsupported,
  };
}

/** One line for the shares, "short moves 41%, corners 18%", or null when nothing is above 2%. */
export function feedShareLine(list: readonly FeedShare[]): string | null {
  return list.length === 0 ? null : list.map((x) => `${x.cause} ${pct(x.fraction)}`).join(', ');
}

/**
 * H77: this browser's record of a board's line mode (device-safety `rxm/<board id>`). A record exists only while Run
 * has changed the board's rxm and not put it back: `{ from, pending: true }`, where `from` is the board's own value.
 * Anything else (no record, a cleared record, an older plain number) means "no record": the board is left as found.
 */
export interface LineModeRecord {
  readonly from: 0 | 1;
  readonly pending: boolean;
}

/** The value to put back at connect, from a stored record, or null when there is no pending record. */
export function pendingLineMode(stored: unknown): 0 | 1 | null {
  if (stored === null || typeof stored !== 'object') return null;
  const r = stored as Partial<LineModeRecord>;
  return r.pending === true && (r.from === 0 || r.from === 1) ? r.from : null;
}

/** The record to store for the session's line-mode state, or null when there is nothing to record yet. */
export function lineModeRecord(rxm: { readonly restore: number | null; readonly pending: boolean }): LineModeRecord | null {
  if (rxm.restore !== 0 && rxm.restore !== 1) return null;
  return { from: rxm.restore, pending: rxm.pending };
}
