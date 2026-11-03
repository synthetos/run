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

/** Phases in which a job owns the machine. */
export const ACTIVE_JOB_PHASES: ReadonlySet<string> = new Set(['preparing', 'running', 'draining', 'ending', 'pausing', 'paused', 'refused', 'toolChange', 'breakpoint', 'programStop', 'resuming']);

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

/** The page's confirmations for a start. */
export interface StartChoices {
  readonly unhomed: boolean;
  readonly workZero: boolean;
  readonly spindle: boolean;
  /** W5: "Screen lock and sleep are disabled; I will stay at the machine." */
  readonly attended: boolean;
}

export interface Blocker {
  readonly id: string;
  readonly text: string;
}

/** Every reason Start is not allowed now, in plain words (empty: Start is enabled). */
export function startBlockers(ui: JobUi, file: { readonly name: string | null; readonly hash: string | null }, zero: ZeroCheck, choices: StartChoices): readonly Blocker[] {
  const out: Blocker[] = [];
  const s = ui.snapshot;
  if (!ui.connected || s === null) return [{ id: 'connect', text: 'Connect a machine.' }];
  if (!ui.enabled) return [{ id: 'build', text: 'Running jobs is not enabled in this build.' }];
  const o = s.overlays;
  if (o.includes('LOST')) out.push({ id: 'lost', text: 'The connection is lost.' });
  if (o.includes('FAULT')) out.push({ id: 'fault', text: 'A fault is latched: acknowledge it first.' });
  if (o.includes('ORPHANED_MOTION')) out.push({ id: 'orphaned', text: 'The controller has motion this page did not send: use Stop job first.' });
  if (o.includes('READ_ONLY') || s.classification?.mode !== 'full') out.push({ id: 'approved', text: 'This firmware is not approved for jobs.' });
  if (o.includes('UNKNOWN')) out.push({ id: 'unknown', text: 'The position is not trusted: confirm “I’ve checked the machine” or home first.' });
  if (o.includes('STALE')) out.push({ id: 'stale', text: 'No status from the machine.' });
  if (o.includes('NEEDS_REVIEW')) out.push({ id: 'review', text: 'The board’s settings differ from the reference: review them first.' });
  if (s.base === 'ALARM') out.push({ id: 'alarm', text: 'The controller is in alarm: clear it first.' });
  else if (s.base !== 'IDLE_HOMED' && s.base !== 'IDLE_UNHOMED' && out.length === 0) out.push({ id: 'idle', text: ui.active ? 'A job is running.' : 'The machine is not idle.' });
  if (s.rxm.busy || s.reports.phase === 'seeding' || s.reports.phase === 'configuring' || s.reports.phase === 'pending') out.push({ id: 'busy', text: 'The connection is still being set up.' });
  const job = ui.job;
  if (file.name === null) out.push({ id: 'file', text: 'Open a G-code file.' });
  else if (job === null || job.hash !== file.hash || job.phase === 'loading') out.push({ id: 'check', text: 'The file is being checked with this board.' });
  else if (job.report?.blocked === true) out.push({ id: 'blocked', text: `The check found ${job.report.counts.block} ${job.report.counts.block === 1 ? 'finding that stops' : 'findings that stop'} this file.` });
  if (s.live.home !== 1 && !choices.unhomed) out.push({ id: 'homed', text: 'The machine is not homed: home it, or confirm you have checked it.' });
  if (zero.state === 'unknown') out.push({ id: 'zero', text: zero.text });
  else if (zero.state === 'differs' && !choices.workZero) out.push({ id: 'zero', text: 'Confirm the work zero (it is not your plan’s).' });
  if (job?.report?.startsSpindle === true && !choices.spindle) out.push({ id: 'spindle', text: 'Confirm the spindle start.' });
  if (!choices.attended) out.push({ id: 'attended', text: 'Confirm screen lock and sleep are off and you will stay at the machine.' });
  return out;
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
  preparing: 'Preparing (line mode)',
  running: 'Job running',
  draining: 'Job running · stopping at the next stop point',
  ending: 'Job running · finishing',
  pausing: 'Pausing…',
  paused: 'Paused',
  refused: 'Paused · a line was refused',
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
  /** Lines in [execEnd, queuedEnd) are sent and acknowledged, not yet executed. */
  readonly queuedEnd: number;
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
  if (job === null || job.startedAt === null || !ACTIVE_JOB_PHASES.has(job.phase) || job.phase === 'preparing') return null;
  const exec = job.executing?.line ?? job.ackedThrough ?? 0;
  const cutEnd = lowerBound(sourceLines, exec);
  const execEnd = Math.max(cutEnd, lowerBound(sourceLines, exec + 1));
  const queuedEnd = Math.max(execEnd, lowerBound(sourceLines, (job.ackedThrough ?? 0) + 1));
  return { cutEnd, execEnd, queuedEnd, starving };
}

/** The planner is starving: the job is cutting and the planner holds almost nothing (MACHINING_ASSISTANT §7). */
export function starving(s: Snapshot | null, plannerBlocks: number | null): boolean {
  const job = s?.job;
  if (s === null || job === undefined || job === null || job.phase !== 'running' || plannerBlocks === null) return false;
  const qr = s.live.qr;
  const vel = s.live.vel;
  return typeof qr === 'number' && typeof vel === 'number' && vel > 0 && plannerBlocks - qr <= 2 && job.sent < job.total;
}

/** The feed-limit summary as observational lines: time below programmed feed by what was limiting it (H78). */
export function feedLimitLines(fl: JobSnapshot['feedLimit']): readonly { readonly label: string; readonly seconds: number }[] | null {
  const fs = fl?.fs;
  if (fs === null || fs === undefined) return null;
  const c = fs['c'];
  if (!Array.isArray(c)) return null;
  const labels = ['an axis feed limit', 'a corner', 'an exact stop', 'moves too short to reach feed', 'single-segment moves', 'something else'];
  return c.slice(0, 6).map((v, i) => ({ label: labels[i] as string, seconds: typeof v === 'number' ? v / 1000 : 0 }));
}
