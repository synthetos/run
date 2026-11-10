/**
 * The Phase 3 job layer of the session reducer: streaming a whole G-code file (owner 2026-11-02; SAFETY §4.4a,
 * H70-H78; T-S108-T-S115).
 *
 * Pure functions over the reducer's transition, like motion.ts: they read the state, queue lines and realtime
 * bytes as effects and arm the `job` timer. The reducer calls them only when the session's release has jobs;
 * every intent has passed the allow-matrix first, and every line and byte is checked again by the write gate
 * when it is written (writePolicy.ts).
 *
 * What runs here:
 * - **Load** (H73): the file text is sanitised HERE, in the worker, with the live board's limits, offsets and
 *   modes read for it (`jobPrep` reads), never the preview's offline model (SAFETY §4.7). The lines never leave
 *   the worker; the page sees a summary.
 * - **Start**: the page's confirmations are checked again (homed or C36, the work zero C31, the spindle C32),
 *   then PREAMBLE: the prep reads are taken again and the file is sanitised again with the board's current
 *   position, offsets, modes and limits (`checking`; a jog, an offset, a settings write or a mode change since the
 *   load would otherwise leave the checked lines stale: independent review 2026-11-03, R3), then the line mode is
 *   read and set to 1 if it is not (`{"rxm":1}`, its own reviewed intent, read back), the footer must then be
 *   revision 3 (line mode, `f[2]` the free line slots), the feed-limit window and the job flag are sent where the
 *   board has them, and the job runs.
 * - **Streaming** (H76): a line is written only while the last footer's free slots, less every job line still
 *   owed an answer, leave more than `reserve` slots for control lines (`!`, `~`, `%` and `{...}` lines are served
 *   first by the board). The answers to data lines come in order; a refused line (non-zero status) holds the job
 *   at that line (H70), whether it was running or already pausing or paused: only Stop job or "Skip line" (C33)
 *   resumes it (independent review 2026-11-03, R4). Feeding stops before a tool change (H74) and a breakpoint
 *   (H75), after a program stop line (H36), and the final M2/M30 is held back until every earlier line is
 *   answered (H35).
 * - **Tool change** (H74): drained, then `M5` and `M9` are written and must each be answered with status 0
 *   (`outputsOff`) before the card says the outputs are off (W37) and the change-ready state is offered; a refusal
 *   or a missing answer ends the job with "use your E-stop" (independent review 2026-11-03, R6). The return after
 *   the change runs in explicit absolute millimetres (`G90 G21` on its own answered line) and puts the job's
 *   distance mode and units back before the job goes on (R1).
 * - **Pause** is `!`, **Resume** is `~` and streaming goes on from where it was; **Stop job** is the motion
 *   layer's flush sequence (`!`, `%` once held, `M5`, `M9`), then "Stopped at line N" (W42).
 *
 * Every decision about the machine uses polled `stat`, `hold`, `vel`, `qr` (SAFETY §4.2) of the poll cycle that
 * just completed, and only when all four were answered with status 0 (independent review 2026-11-03, R5), never
 * the last status report; the reported `line` drives progress and the planner view only.
 */
import {
  CEILING_SECONDS,
  DEFAULT_K,
  c35,
  sanitizeJob,
  w37,
  w38,
  w39,
  w40,
  w43,
  type AxisValues,
  type Decision,
  type Intent,
  type MotionModel,
  type SanitizeResult,
  type SentLine,
  type StartState,
  type Wcs,
} from '@synthetos/safety';
import { mapStat, type Dialect, type JsonObject, type JsonValue, type Response } from '@synthetos/protocol';
import { isReadAllowed } from '@synthetos/schema';
import { MOTION_LIMITS, activeSystem, atRestPolled, beginHold, clearMotionNotice, completedPoll, heldPolled, idleBase, motionCapable, requestPoll } from './motion.ts';
import { sessionSettings } from './settingWrite.ts';
import { ACTIVE_PHASES, failJob, jobActive, jobEvent, lastFileLine, patchJob, type JobTx } from './jobState.ts';
import { ABSOLUTE_MM_LINE, motionLineKind, restoreLine, returnXYLine, safeZLine, spindleLine } from './motionLines.ts';
import { queueModeReads } from './modes.ts';
import { startModesStep, startNeeds } from './jobModes.ts';
import { resumeTravel, travelOf, travelStartRefusal, withTravel } from './jobTravel.ts';
import { forgetBoardModes, noteModeRead } from './boardModes.ts';
import type { Axis, Expected, FeedLimitState, FeedMove, FeedSummary, JobReportSummary, JobState, PendingRead, PolledValues, SessionConfig, SessionIntent, SessionState } from './types.ts';

/** Timing and bounds of the job layer (SAFETY §4.4a). Milliseconds unless named otherwise. */
export const JOB_LIMITS = Object.freeze({
  /** Line-buffer slots kept free for control lines (the firmware maintainer: "keep a couple in reserve"). */
  reserve: 2,
  /** Polled reads while a job runs (the planner gauge `qr`, and a fresh `f[2]` when nothing is owed). */
  runPollMs: 500,
  /** Polled reads while draining to a stop point, pausing or putting the machine back. */
  drainPollMs: MOTION_LIMITS.pollMs,
  /** STALE for longer than this while a job runs is a liveness FAULT (SAFETY §3, H71). */
  staleFaultMs: 5000,
  /** After a liveness FAULT the job is stopped with the spindle off after this grace period (W33, SAFETY §3 effect 4). */
  faultGraceMs: 20_000,
  /** A Pause with no hold reported for this long says so (STOP_TEXT.pauseNoAnswer). */
  pauseNoAnswerMs: 2000,
  /** The feed-limit summary interval asked for, seconds (`{"rt":{"fi":N}}`). */
  feedLimitS: 2,
  /** Largest file the worker sanitises, bytes (RUN_PLAN §4). */
  maxBytes: 50 * 1024 * 1024,
  /** Breakpoints kept per job. */
  maxBreakpoints: 1000,
  /** A move back to where a tool change stopped is skipped when the machine is within this of it, mm. */
  returnToleranceMm: 0.01,
});

/** Dialects run streams jobs to: line mode with free-slot footers (`rxm`, footer revision 3) is edge-next's. */
export const JOB_DIALECTS: ReadonlySet<string> = new Set(['tinyg-en']);

/** What a job's load reads, through the read allowlist: limits and modes per axis, every offset, the modal state, the defaults and `rxm`. */
export const JOB_PREP_TOKENS: readonly string[] = Object.freeze(['x', 'y', 'z', 'a', 'b', 'c', 'g54', 'g55', 'g56', 'g57', 'g58', 'g59', 'g92', 'g28', 'g30', 'mpo', 'ofs', 'coor', 'unit', 'dist', 'plan', 'admo', 'gpl', 'gun', 'gco', 'gdi', 'rxm']);

/** The exact line-mode lines (H77): the write gate admits only these, only for the step in progress. */
export function rxmLine(value: 0 | 1): string {
  return `{"rxm":${value}}`;
}

/** The job flag (MACHINING_ASSISTANT feed-limit step 3): RAM only, designed, not on the board yet. */
export function jobFlagLine(on: 0 | 1): string {
  return `{"rt":{"job":${on}}}`;
}

/** The feed-limit window (`{"rt":{"fi":N}}`, N seconds, 0 stops crediting): RAM only, accepted on at quiescence. */
export function feedLimitLine(seconds: number): string {
  return `{"rt":{"fi":${Math.round(seconds)}}}`;
}

/**
 * The capability probe of the job flag: true only when the board's `{"rt":null}` answer at connect names a `job`
 * leaf. Edge-next a7489b79 has no such leaf (the flag is designed, feed-limit step 3), so this is false today and
 * no job flag is ever sent. Nothing else may change when a build has it.
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

const ALLOWED: Decision = Object.freeze({ allowed: true });

function deny(reason: string, remedy: string): Decision {
  return { allowed: false, reason, remedy, citation: 'SAFETY §4.4a' };
}

/** The transition, as this module uses it (the reducer's `Tx`). */
export interface JobLayerTx extends JobTx {
  readonly config: SessionConfig;
}

/** What the reducer lends this module (it may not import the reducer: no cycles). */
export interface JobDeps {
  /** Latch a FAULT (the reducer's enterFault). */
  fault(t: JobLayerTx, cause: 'staleWhileRunning', kind: 'liveness', detail: string, at: number): void;
}

/** True when this session may run jobs: a jobs release, a motion-capable approved board, a dialect with line mode. */
export function jobsCapable(s: SessionState, config: SessionConfig): boolean {
  return config.release.jobs === true && motionCapable(s, config) && s.dialect !== null && JOB_DIALECTS.has(s.dialect.id);
}

function dialect(s: SessionState): Dialect {
  return s.dialect as Dialect;
}

function job(s: SessionState): JobState {
  return s.job as JobState;
}

function planner(s: SessionState): number {
  return dialect(s).limits.plannerBlocks;
}

/** FNV-1a (32 bit) of the text, as 8 hex digits: an identity for the page to compare, not a security hash. */
export function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function freezeDeep<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) freezeDeep((value as Record<string, unknown>)[key]);
  return Object.freeze(value);
}

/** One written line queued as a control or motion read (one at a time, like every other line). */
function queue(t: JobLayerTx, entry: PendingRead): void {
  t.set({ queue: [...t.s.queue, entry] });
}

/**
 * A realtime byte of the job layer. The job's `~` is checked against `jobLine` (allowed in RUNNING): the base is
 * RUNNING again in the transition that asks for it, and the byte is written right after.
 */
function writeRealtime(t: JobLayerTx, name: 'feedhold' | 'resume', intent: Intent): void {
  const realtime = dialect(t.s).realtime;
  const byte = name === 'feedhold' ? realtime.feedhold.byte : realtime.resume.byte;
  t.set({ sent: { ...t.s.sent, realtime: t.s.sent.realtime + 1 } });
  t.emit({ kind: 'writeRealtime', epoch: t.s.epoch, name, byte, intent });
}

// --- Load ---------------------------------------------------------------------------------------------------

/** Load or unload a job (the matrix has allowed `loadJob`). */
export function onLoadJob(t: JobLayerTx, request: Extract<SessionIntent, { intent: 'loadJob' }>, at: number): Decision {
  const s = t.s;
  if (!jobsCapable(s, t.config)) return deny('Jobs are not available with this release or this board.', 'Use the bench or staging build with an approved edge-next board.');
  if (jobActive(s)) return deny('A job is running.', 'Stop or finish it first.');
  if (s.motion !== null || s.rxm.step !== null || s.queue.some((q) => q.purpose === 'jobPrep')) return deny('The machine is busy.', 'Wait until it is idle.');
  if (s.base !== 'IDLE_UNHOMED' && s.base !== 'IDLE_HOMED' && s.base !== 'CONNECTED_UNKNOWN') return deny('A job is loaded only while the machine is idle.', 'Wait until the machine is idle.');
  if (request.job === null) {
    t.set({ job: null });
    return ALLOWED;
  }
  const { name, text, c22 } = request.job;
  if (typeof name !== 'string' || name.trim() === '' || name.length > 200) return deny('The file needs a name.', 'Open the file again.');
  if (typeof text !== 'string' || text.length === 0) return deny('The file is empty.', 'Open another file.');
  if (text.length > JOB_LIMITS.maxBytes) return deny(`The file is larger than ${JOB_LIMITS.maxBytes / 1024 / 1024} MB.`, 'Split the job.');
  const id = (s.job?.id ?? 0) + 1;
  t.set({ job: emptyJob(id, name, text, c22 === true), queue: [...s.queue, ...prepReads(s)] });
  jobEvent(t, at, 'info', `Loaded ${name}: checking every line with this board's limits and offsets.`);
  return ALLOWED;
}

/** The prep reads (JOB_PREP_TOKENS through the read allowlist): taken at load, and again at Start (R3). */
function prepReads(s: SessionState): PendingRead[] {
  return JOB_PREP_TOKENS.filter((tok) => isReadAllowed(dialect(s).id, tok)).map((token) => ({ token, purpose: 'jobPrep' as const }));
}

function emptyJob(id: number, name: string, text: string, c22: boolean): JobState {
  return {
    id,
    name,
    hash: textHash(text),
    bytes: text.length,
    phase: 'loading',
    source: { text, c22 },
    lines: [],
    secondsFrom: [],
    report: null,
    next: 0,
    acked: 0,
    free: null,
    breakpoints: [],
    passed: null,
    stop: null,
    confirmed: 0,
    refused: null,
    toolChange: null,
    resumeSteps: [],
    startedAt: null,
    endedAt: null,
    pauseAt: null,
    message: null,
    events: [],
    rxmFrom: null,
    jobFlag: null,
    feedLimit: null,
    faultStopAt: null,
    stopping: false,
  };
}

/** One prep read was answered (or arrived damaged: `r` null). When the last is in, the file is sanitised. */
export function onJobPrepAnswer(t: JobLayerTx, e: PendingRead, r: Response | null, at: number): void {
  const value = r === null ? null : (r.r[e.token] ?? null);
  t.set({ values: { ...t.s.values, [e.token]: { value, status: r === null ? -1 : r.footer.status, at } } });
  noteModeRead(t, e.token, r === null ? -1 : r.footer.status, value);
  if (t.s.queue.some((q) => q.purpose === 'jobPrep')) return;
  if (t.s.job?.phase === 'loading') finishLoad(t, at);
  else if (t.s.job?.phase === 'checking') finishCheck(t, at);
}

/**
 * The prep reads were dropped (a timeout, a fault, a lost link): a load fails with nothing sanitised; a Start's
 * re-check (R3) ends the job before anything was sent.
 */
export function abandonLoad(t: JobLayerTx, at: number, why: string): void {
  const j = t.s.job;
  if (j === null || (j.phase !== 'loading' && j.phase !== 'checking')) return;
  t.set({ queue: t.s.queue.filter((q) => q.purpose !== 'jobPrep') });
  if (j.phase === 'checking') {
    startFailed(t, at, `The job did not start: the file could not be checked again (${why}).`);
    return;
  }
  patchJob(t, { phase: 'blocked', message: `The file could not be checked: ${why}.` });
  jobEvent(t, at, 'error', `The file could not be checked: ${why}.`);
}

/** A Start that ends before anything of the job was sent: back to idle, the reason said. */
function startFailed(t: JobLayerTx, at: number, text: string): void {
  t.cancel('job');
  t.set({ base: idleBase(t.s), queue: t.s.queue.filter((q) => q.purpose !== 'jobPrep') });
  patchJob(t, { phase: 'failed', message: text, endedAt: at });
  jobEvent(t, at, 'error', text);
}

function numberOf(v: JsonValue | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function groupOf(s: SessionState, token: string): AxisValues | undefined {
  const v = s.values[token];
  if (v === undefined || v.status !== 0 || typeof v.value !== 'object' || v.value === null || Array.isArray(v.value)) return undefined;
  const out: Partial<Record<'X' | 'Y' | 'Z' | 'A' | 'B' | 'C', number>> = {};
  for (const [k, x] of Object.entries(v.value as JsonObject)) {
    const n = numberOf(x);
    const axis = k.toUpperCase();
    if (n !== undefined && ['X', 'Y', 'Z', 'A', 'B', 'C'].includes(axis)) out[axis as 'X'] = n;
  }
  return out;
}

/**
 * A group printed in the board's units (`F_CONVERT`: g54..g59, g92, g28 and g30 on X, Y and Z, never A, B or C),
 * in mm. The JSON serializer divides those by 25.4 while the model is in G20 (@cite EN json_parser.c:828,
 * config_app.c:858-871 prep_float, :388-450 the `_fipc`/`_fic` rows; config.h:242, :275-276); `mpo` and `ofs` are
 * always mm (config_app.c:166, :180). The board is at rest when the job reads it, so the `unit` it reports is the
 * model's. Without the units read, such a group is unknown, never guessed.
 */
function groupMm(s: SessionState, token: string, units: number | undefined): AxisValues | undefined {
  const g = groupOf(s, token);
  if (g === undefined || (units !== 0 && units !== 1)) return undefined;
  if (units === 1) return g;
  const out: Partial<Record<'X' | 'Y' | 'Z' | 'A' | 'B' | 'C', number>> = { ...g };
  for (const a of ['X', 'Y', 'Z'] as const) {
    const v = g[a];
    if (v !== undefined) out[a] = v * 25.4;
  }
  return out;
}

function scalar(s: SessionState, token: string): number | undefined {
  const v = s.values[token];
  return v !== undefined && v.status === 0 ? numberOf(v.value ?? undefined) : undefined;
}

const WCS_OF: readonly Wcs[] = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'];

/** The live start state for the sanitiser, from the prep reads. What was not read stays unknown (never guessed). */
export function liveStart(s: SessionState): StartState {
  const units = scalar(s, 'unit');
  const dist = scalar(s, 'dist');
  const plan = scalar(s, 'plan');
  const admo = scalar(s, 'admo');
  const coor = scalar(s, 'coor');
  const offsets: Partial<Record<Wcs, AxisValues>> = {};
  WCS_OF.forEach((w, i) => {
    const g = groupMm(s, `g${54 + i}`, units);
    if (g !== undefined) offsets[w] = g;
  });
  const g92 = groupMm(s, 'g92', units);
  const machine = groupOf(s, 'mpo');
  const g28 = groupMm(s, 'g28', units);
  const g30 = groupMm(s, 'g30', units);
  // The tool length offset (G43.1) is not readable on its own: the board's work offset `ofs` is the active
  // coordinate offset (with G92 when applied) plus it (@cite EN canonical_machine.c:348-353), so it is the rest.
  const ofs = groupOf(s, 'ofs');
  const wcs = coor !== undefined && coor >= 1 && coor <= 6 ? (WCS_OF[coor - 1] as Wcs) : undefined;
  const coord = wcs === undefined ? undefined : offsets[wcs];
  let toolOffset: AxisValues | undefined;
  if (ofs !== undefined && coord !== undefined && g92 !== undefined) {
    const applied = Object.values(g92).some((v) => v !== 0);
    const t: Partial<Record<'X' | 'Y' | 'Z', number>> = {};
    for (const a of ['X', 'Y', 'Z'] as const) {
      const o = ofs[a];
      const c = coord[a];
      const g = g92[a];
      if (o !== undefined && c !== undefined && g !== undefined) t[a] = Math.round((o - c - (applied ? g : 0)) * 1e4) / 1e4;
    }
    toolOffset = t;
  }
  const gun = scalar(s, 'gun');
  const gdi = scalar(s, 'gdi');
  const gpl = scalar(s, 'gpl');
  const gco = scalar(s, 'gco');
  const plane = (v: number | undefined): 'G17' | 'G18' | 'G19' | undefined => (v === 0 ? 'G17' : v === 1 ? 'G18' : v === 2 ? 'G19' : undefined);
  const defaults = {
    ...(gun === 1 ? { units: 'G21' as const } : gun === 0 ? { units: 'G20' as const } : {}),
    ...(gdi === 0 ? { distance: 'G90' as const } : gdi === 1 ? { distance: 'G91' as const } : {}),
    ...(plane(gpl) === undefined ? {} : { plane: plane(gpl) as 'G17' }),
    ...(gco !== undefined && gco >= 1 && gco <= 6 ? { wcs: WCS_OF[gco - 1] as Wcs } : {}),
  };
  return {
    ...(units === 1 ? { units: 'G21' as const } : units === 0 ? { units: 'G20' as const } : {}),
    ...(dist === 0 ? { distance: 'G90' as const } : dist === 1 ? { distance: 'G91' as const } : {}),
    ...(admo === 0 ? { arcDistance: 'G90.1' as const } : admo === 1 ? { arcDistance: 'G91.1' as const } : {}),
    ...(plane(plan) === undefined ? {} : { plane: plane(plan) as 'G17' }),
    ...(wcs === undefined ? {} : { wcs }),
    ...(machine === undefined ? {} : { machine }),
    wcsOffsets: offsets,
    // The board reports the G92 offsets it applies; any non-zero offset is taken as applied (G92.2 suspension is
    // not read, so a suspended non-zero offset makes the model stricter, never looser: H73 note).
    ...(g92 === undefined ? {} : { g92: { offsets: g92, active: Object.values(g92).some((v) => v !== 0) } }),
    ...(toolOffset === undefined ? {} : { toolOffset }),
    ...(g28 === undefined ? {} : { g28 }),
    ...(g30 === undefined ? {} : { g30 }),
    defaults,
  };
}

/** The live motion model (SAFETY §4.3): `vm`, `fr`, `am`, `ra` per axis as read; what was not read is unknown. */
export function liveMotion(s: SessionState): MotionModel {
  const settings = sessionSettings(dialect(s).id, s.values);
  const n = (key: string): number | undefined => {
    const v = settings[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const maxVelocity: Partial<Record<Axis | 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C', number>> = {};
  const feedrateMax: Partial<Record<'X' | 'Y' | 'Z' | 'A' | 'B' | 'C', number>> = {};
  const rotary: Record<string, { mode: 0 | 1 | 2 | 3; radiusMm?: number }> = {};
  const linear: Record<string, 0 | 1 | 2 | 3> = {};
  for (const axis of ['x', 'y', 'z', 'a', 'b', 'c'] as const) {
    const A = axis.toUpperCase() as 'X';
    const vm = n(`${axis}vm`);
    const fr = n(`${axis}fr`);
    if (vm !== undefined && vm > 0) maxVelocity[A] = vm;
    if (fr !== undefined && fr > 0) feedrateMax[A] = fr;
    const am = n(`${axis}am`);
    if (am === undefined || ![0, 1, 2, 3].includes(am)) continue;
    if (axis === 'x' || axis === 'y' || axis === 'z') linear[A] = am as 0;
    else {
      const ra = n(`${axis}ra`);
      rotary[A] = { mode: am as 0, ...(ra !== undefined && ra > 0 ? { radiusMm: ra } : {}) };
    }
  }
  return { ceilingSeconds: CEILING_SECONDS.default, k: DEFAULT_K, maxVelocity, feedrateMax, rotary, linear };
}

/** Sanitises the pending text with the live board's values (SAFETY §4.7). `start`: a typed move's, with the feed in effect (typedTravel.ts). Pure. */
export function sanitizeLive(s: SessionState, text: string, c22: boolean, start: StartState = liveStart(s)): SanitizeResult {
  return sanitizeJob(text, dialect(s), { motion: liveMotion(s), start, c22 });
}

function summary(result: SanitizeResult): JobReportSummary {
  const counts = { block: 0, warn: 0, change: 0, info: 0 };
  for (const e of result.report.entries) counts[e.severity]++;
  const speeds = new Set<number>();
  let startsSpindle = false;
  for (const l of result.lines) {
    if (!/\bM0*[34](?!\d|\.)/.test(l.body)) continue;
    startsSpindle = true;
    const m = /S\s*([0-9.]+)/i.exec(l.body);
    if (m !== null) speeds.add(Number(m[1]));
  }
  return {
    blocked: result.report.blocked,
    counts,
    blocks: result.report.entries.filter((e) => e.severity === 'block').slice(0, 8).map((e) => ({ line: e.line, message: e.message })),
    splits: result.report.splits.length,
    longestMoveSeconds: result.report.longestMoveSeconds,
    endState: result.report.endState,
    toolChanges: result.lines.filter((l) => l.toolChange !== undefined).map((l) => l.sourceLine),
    startsSpindle,
    speeds: [...speeds].slice(0, 8),
    seconds: result.lines.reduce((sum, l) => sum + (l.motion?.seconds ?? 0), 0),
  };
}

/** Sanitises the job's source with the values just read and stores the lines, the report and the time estimates. */
function sanitizeInto(t: JobLayerTx): { readonly result: SanitizeResult; readonly report: JobReportSummary } {
  const j = job(t.s);
  const result = sanitizeLive(t.s, j.source.text, j.source.c22);
  // OD-24: the travel check against the board's soft limits (travelCheck.ts).
  const report = withTravel(summary(result), travelOf(t.s, result));
  const secondsFrom: number[] = new Array<number>(result.lines.length + 1).fill(0);
  for (let i = result.lines.length - 1; i >= 0; i--) secondsFrom[i] = (secondsFrom[i + 1] as number) + ((result.lines[i] as SentLine).motion?.seconds ?? 0);
  patchJob(t, { lines: freezeDeep([...result.lines]), secondsFrom: Object.freeze(secondsFrom), report });
  return { result, report };
}

function checkedText(result: SanitizeResult, report: JobReportSummary): string {
  return report.blocked
    ? `Checked with this board's values: ${report.counts.block} ${report.counts.block === 1 ? 'finding stops' : 'findings stop'} this file.`
    : `Checked with this board's values: ${result.lines.length} lines to send${report.toolChanges.length > 0 ? `, ${report.toolChanges.length} tool ${report.toolChanges.length === 1 ? 'change' : 'changes'}` : ''}.`;
}

function finishLoad(t: JobLayerTx, at: number): void {
  const { result, report } = sanitizeInto(t);
  // OD-19: what Start will write for the modes the preview assumes, shown at the check (decided again at Start).
  patchJob(t, { phase: report.blocked ? 'blocked' : 'ready', startModes: { needs: startNeeds(t.s, result.lines), modes: [], written: false } });
  jobEvent(t, at, report.blocked ? 'error' : 'info', checkedText(result, report));
}

/**
 * The prep reads taken at Start are in (R3): the file is sanitised again with the board's values as they are now.
 * What the check found stops the start; otherwise the line mode is checked next (PREAMBLE goes on).
 */
function finishCheck(t: JobLayerTx, at: number): void {
  // OD-19: the modes the preview assumes, written and read back first when the file relies on them (jobModes.ts).
  const modes = startModesStep(t, at, prepReads(t.s));
  if (modes.kind === 'wait') return;
  if (modes.kind === 'refused') {
    startFailed(t, at, modes.text);
    return;
  }
  // OD-24 (review M1): the values this check uses, kept for the Resume re-check after a Z re-zero.
  patchJob(t, { startValues: t.s.values });
  const { result, report } = sanitizeInto(t);
  if (report.blocked) {
    t.cancel('job');
    t.set({ base: idleBase(t.s) });
    patchJob(t, { phase: 'blocked', startedAt: null, message: `The job did not start. ${checkedText(result, report)}` });
    jobEvent(t, at, 'error', `The job did not start. ${checkedText(result, report)}`);
    return;
  }
  // OD-24: a travel finding that appears only now (the board as read at Start) needs the C40 the Start did not carry.
  const travel = travelStartRefusal(report, t.s.job?.travelConfirmed);
  if (travel !== null) {
    startFailed(t, at, `The job did not start. ${travel}`);
    return;
  }
  jobEvent(t, at, 'info', `${checkedText(result, report)} Checking the line mode.`);
  t.set({ rxm: { ...t.s.rxm, step: { kind: 'read', purpose: 'job', value: 1 }, detail: null } });
  patchJob(t, { phase: 'preparing' });
  clearMotionNotice(t);
  queue(t, { token: 'rxm', purpose: 'lineMode' });
  t.arm('job', JOB_LIMITS.drainPollMs);
}

// --- Start --------------------------------------------------------------------------------------------------

/** Start the loaded job (the matrix has allowed `startJob`: idle, no overlay). */
export function onStartJob(t: JobLayerTx, request: Extract<SessionIntent, { intent: 'startJob' }>, at: number): Decision {
  const s = t.s;
  if (!jobsCapable(s, t.config)) return deny('Jobs are not available with this release or this board.', 'Use the bench or staging build with an approved edge-next board.');
  const j = s.job;
  if (j === null || j.phase === 'loading') return deny('No job is loaded and checked.', 'Open a file and wait for the check.');
  if (j.phase === 'blocked' || j.report?.blocked === true) return deny('The check found something that stops this file.', 'Fix the file, or accept the offered changes.');
  if (j.phase !== 'ready' && j.phase !== 'done' && j.phase !== 'stopped' && j.phase !== 'failed') return deny('This job is already running.', 'Use Pause or Stop job.');
  if (s.motion !== null || s.rxm.step !== null || s.queue.length > 0 || s.expected.some((e) => !e.late) || s.writing !== null) return deny('The machine is busy.', 'Wait until it is idle.');
  if (s.reports.phase === 'seeding' || s.reports.phase === 'pending' || s.reports.phase === 'configuring') return deny('The connection is still being set up.', 'Wait a moment.');
  const confirm = request.confirm;
  if (typeof confirm !== 'object' || confirm === null) return deny('The start needs its confirmations.', 'Go through Check, Set zero and Start.');
  if (s.live.home !== 1 && confirm.unhomed !== true) return deny('The machine is not homed.', 'Home the machine, or confirm that you have checked it (C36).');
  if (confirm.workZero !== true) return deny("The job's work zero is not confirmed.", 'Check the work zero against your plan (C31).');
  if (j.report?.startsSpindle === true && confirm.spindle !== true) return deny('This job starts the spindle.', 'Confirm the spindle start (C32).');
  const travel = travelStartRefusal(j.report, confirm.travel);
  if (travel !== null) return deny(travel, 'Check that the job fits the machine, then confirm C40.');
  const breakpoints = cleanBreakpoints(request.breakpoints);
  if (breakpoints === null) return deny('The breakpoints are not valid.', 'Set them again.');
  // A fresh run (the first, or again after done, stopped or failed): the board's values are read again and the
  // file is checked again with them before anything is sent (R3): the lines checked at load may be stale after a
  // jog, an offset, a settings write or a mode change, and the earlier run itself changed the modal state.
  t.set({
    base: 'PREAMBLE',
    queue: [...s.queue, ...prepReads(s)],
    job: {
      ...j,
      phase: 'checking',
      next: 0,
      acked: 0,
      free: null,
      breakpoints,
      passed: null,
      stop: null,
      confirmed: 0,
      refused: null,
      toolChange: null,
      resumeSteps: [],
      startedAt: at,
      endedAt: null,
      pauseAt: null,
      message: null,
      rxmFrom: null,
      jobFlag: null,
      feedLimit: null,
      faultStopAt: null,
      stopping: false,
      startModes: { needs: [], modes: [], written: false }, // decided again with the values read now (jobModes.ts)
      ...(typeof confirm.travel === 'string' ? { travelConfirmed: confirm.travel } : {}),
      events: j.events,
    },
  });
  jobEvent(t, at, 'info', `Started ${j.name}: checking every line again with this board's current position, offsets, modes and limits.`);
  t.arm('job', JOB_LIMITS.drainPollMs);
  return ALLOWED;
}

function cleanBreakpoints(lines: unknown): readonly number[] | null {
  if (!Array.isArray(lines) || lines.length > JOB_LIMITS.maxBreakpoints) return null;
  if (!lines.every((l) => typeof l === 'number' && Number.isInteger(l) && l >= 1)) return null;
  return Object.freeze([...new Set(lines as number[])].sort((a, b) => a - b));
}

/** The window's breakpoints, any time (they take effect only on lines not yet sent, H75). */
export function onJobBreakpoints(t: JobLayerTx, lines: unknown, at: number): Decision {
  const j = t.s.job;
  if (j === null) return deny('No job is loaded.', 'Open a file first.');
  const clean = cleanBreakpoints(lines);
  if (clean === null) return deny('The breakpoints are not valid.', 'Set them again.');
  patchJob(t, { breakpoints: clean });
  if (ACTIVE_PHASES.has(j.phase)) {
    const queued = clean.filter((line) => queuedLine(j, line));
    if (queued.length > 0) jobEvent(t, at, 'warn', `Line ${queued.join(', ')} is already queued on the controller, so a breakpoint there cannot stop the job.`, queued[0]);
  }
  return ALLOWED;
}

/** True when file line `line` was already sent (and not yet passed): a breakpoint on it cannot be honoured (H75, W41). */
export function queuedLine(j: JobState, line: number): boolean {
  const sent = j.lines.slice(0, j.next);
  return sent.some((l) => l.sourceLine === line);
}

// --- Line mode (H77) ----------------------------------------------------------------------------------------

/** The page told the session what it remembers of this board's line mode (null: nothing). */
/**
 * What this browser remembers of the board (H77): `remembered` is the value Run found before it changed the
 * board's rxm and has not put back yet (a pending record), or null when there is no such record. With no record,
 * the board's rxm is left exactly as found (edge-next's factory default is rxm 1).
 */
export function onLineModeMemory(t: JobLayerTx, remembered: unknown): Decision {
  if (remembered !== null && remembered !== 0 && remembered !== 1) return deny('The remembered line mode must be 0, 1 or nothing.', 'Nothing to do.');
  const rxm = t.s.rxm;
  // A job prepared in this session already knows the board's own value: it wins over the page's memory.
  if (remembered === null || rxm.restore !== null) t.set({ rxm: { ...rxm, memoryKnown: true } });
  else t.set({ rxm: { ...rxm, memoryKnown: true, restore: remembered, pending: true } });
  return ALLOWED;
}

/** The value to put back when no job runs, or null when nothing should be written: only what Run itself changed. */
export function rxmTarget(s: SessionState): 0 | 1 | null {
  if (!s.rxm.pending || s.rxm.restore === null) return null;
  return s.rxm.restore === 1 ? 1 : 0;
}

/**
 * Outside a job, a board in line mode (footer revision 3) whose remembered value is character mode is put back
 * (H77): after the job ends, and at connect after a crash left it in line mode. Started only from a quiet,
 * idle state with nothing else in progress.
 */
export function maybeRestoreLineMode(t: JobLayerTx, allowedNow: boolean): void {
  const s = t.s;
  if (!allowedNow || s.rxm.step !== null || !jobsCapable(s, t.config) || jobActive(s) || s.motion !== null) return;
  if (s.reports.phase === 'seeding' || s.reports.phase === 'pending' || s.reports.phase === 'configuring') return;
  if (s.queue.length > 0 || s.writing !== null || s.expected.some((e) => !e.late) || s.settingWrite?.phase === 'gate' || s.settingWrite?.phase === 'writing' || s.settingWrite?.phase === 'readback') return;
  if (s.job?.phase === 'loading' || s.job?.phase === 'checking') return;
  if (s.footerRev === 2) {
    settleLineModeRecord(t);
    return;
  }
  if (s.footerRev !== 3) return;
  const target = rxmTarget(s);
  if (target === null || target === 1) {
    if (s.rxm.memoryKnown && !s.rxm.leftAsFound) {
      // No record in this browser that Run changed this board: its line mode is its owner's choice.
      t.set({ rxm: { ...s.rxm, leftAsFound: true } });
      t.emit({ kind: 'log', text: 'line mode: the board is in line mode (rxm 1, footer revision 3) outside a job; no record here that Run changed it, so it is left as found' });
    }
    return;
  }
  t.set({ rxm: { ...s.rxm, step: { kind: 'write', purpose: 'restore', value: 0 }, footerExpect: 2, detail: null } });
  queue(t, { token: 'rxm', purpose: 'lineMode', value: 0 });
  t.emit({ kind: 'log', text: 'line mode: Run set this board to line mode and has not put it back yet; putting back rxm 0 (saved on the board)' });
}

/**
 * A pending record on a board that is already in character mode (footer revision 2) outside a job: someone put it
 * back, or the job's write never took. Nothing is written; the record is cleared.
 */
function settleLineModeRecord(t: JobLayerTx): void {
  const s = t.s;
  if (!s.rxm.pending) return;
  t.set({ rxm: { ...s.rxm, pending: false } });
  t.emit({ kind: 'log', text: 'line mode: the board is already in character mode (rxm 0); the record that Run changed it is cleared' });
}

/** The line-mode read, write or read-back was answered. */
export function onLineModeAnswer(t: JobLayerTx, r: Response | null, at: number): void {
  const s = t.s;
  const step = s.rxm.step;
  /* c8 ignore next -- a lineMode line is queued only with its step set, and the step ends only with its answer */
  if (step === null) return;
  const value = r === null ? undefined : numberOf(r.r['rxm']);
  const status = r === null ? -1 : r.footer.status;
  if (step.kind === 'write') {
    if (status !== 0) {
      lineModeFailed(t, at, `the controller refused rxm ${step.value} (status ${status})`);
      return;
    }
    t.set({ rxm: { ...s.rxm, step: { ...step, kind: 'readback' }, footerExpect: null } });
    queue(t, { token: 'rxm', purpose: 'lineMode' });
    return;
  }
  if (step.kind === 'read') {
    // Job preparation: the board's own value is what is put back when the job ends.
    if (status !== 0 || value === undefined) {
      lineModeFailed(t, at, `the rxm read failed (status ${status})`);
      return;
    }
    // A pending record (Run changed this board on an earlier link and never put it back) keeps its own value.
    t.set({ rxm: { ...s.rxm, current: value, restore: s.rxm.pending ? s.rxm.restore : value === 1 ? 1 : 0, memoryKnown: true } });
    patchJob(t, { rxmFrom: value });
    if (value === 1) {
      lineModeReady(t, at);
      return;
    }
    // Stopped while the rxm read was answered: nothing more is written for the job.
    if (!preparing(t.s)) return;
    // Pending from here: if this tab goes away mid-job, the next connect from this browser puts the value back.
    t.set({ rxm: { ...t.s.rxm, step: { kind: 'write', purpose: 'job', value: 1 }, footerExpect: 3, pending: true } });
    queue(t, { token: 'rxm', purpose: 'lineMode', value: 1 });
    return;
  }
  // Read-back.
  if (status !== 0 || value !== step.value) {
    lineModeFailed(t, at, `rxm reads back ${value ?? 'nothing'} (status ${status}), not ${step.value}`);
    return;
  }
  const from = step.value === 1 ? 0 : 1;
  t.set({ rxm: { ...t.s.rxm, step: null, current: value, changed: { kind: step.purpose, from, to: step.value } } });
  t.emit({ kind: 'log', text: `line mode: rxm ${from} → ${step.value}, read back (saved on the board)` });
  if (step.purpose === 'restore') {
    t.set({ rxm: { ...t.s.rxm, pending: false, leftAsFound: false } });
    if (t.s.job !== null) jobEvent(t, at, 'info', `Line mode put back: rxm ${step.value} (saved on the board).`);
    return;
  }
  jobEvent(t, at, 'info', w39());
  lineModeReady(t, at);
}

/** A job is being prepared and nobody has stopped it. */
function preparing(s: SessionState): boolean {
  return s.job !== null && s.job.phase === 'preparing' && !s.job.stopping;
}

function lineModeFailed(t: JobLayerTx, at: number, why: string): void {
  const step = t.s.rxm.step;
  t.set({ rxm: { ...t.s.rxm, step: null, footerExpect: null, detail: why } });
  t.emit({ kind: 'log', text: `line mode: ${why}` });
  if (step?.purpose === 'job' && preparing(t.s)) {
    // Nothing was streamed: the job did not start. A changed rxm is put back by the restore that follows.
    t.cancel('job');
    t.set({ base: idleBase(t.s) });
    patchJob(t, { phase: 'failed', message: `The job did not start: line mode could not be confirmed (${why}).`, endedAt: at });
    jobEvent(t, at, 'error', `The job did not start: line mode could not be confirmed (${why}).`);
  }
}

/** Line mode is set: the footer must say so (revision 3) before a single job line goes out. */
function lineModeReady(t: JobLayerTx, at: number): void {
  if (preparing(t.s) && t.s.footerRev !== 3) {
    lineModeFailed(t, at, `the controller's footer is revision ${t.s.footerRev ?? 'unknown'}, not 3 (line mode)`);
    return;
  }
  t.set({ rxm: { ...t.s.rxm, step: null } });
  // Stopped while the line mode was being set: the job does not start (a changed rxm is put back afterwards).
  if (!preparing(t.s)) return;
  // The feed-limit window (accepted only at quiescence: the machine is idle now) and the job flag, where the board has them.
  // N66 (holds could leave the motors a step off) is fixed from fb 450.02: feed accounting is on there, and on
  // earlier builds only where a release turns it on (Release.feedAccounting, set by no shipped release).
  if ((t.config.release.feedAccounting === true || feedAccountingSafe(t.s)) && feedLimitSupported(t.s)) {
    queue(t, { token: 'rt', purpose: 'jobRuntime', line: feedLimitLine(JOB_LIMITS.feedLimitS) });
    patchJob(t, { feedLimit: feedLimitWindow(JOB_LIMITS.feedLimitS) });
  }
  sendJobFlag(t, 1);
  t.set({ base: 'RUNNING' });
  forgetBoardModes(t); // OD-19: the job's own lines and its M2/M30 set them; read again after the job (jobOffsets.ts)
  patchJob(t, { phase: 'running' });
  jobEvent(t, at, 'info', 'Streaming in line mode.');
  t.arm('job', JOB_LIMITS.runPollMs);
}

/** The job flag, only where the capability probe found it (MACHINING_ASSISTANT feed-limit step 3). */
function sendJobFlag(t: JobLayerTx, on: 0 | 1): void {
  if (!jobFlagSupported(t.s) || t.s.job?.jobFlag === on) return;
  queue(t, { token: 'rt', purpose: 'jobRuntime', line: jobFlagLine(on) });
  patchJob(t, { jobFlag: on });
}

/** A job `rt` line was answered: a refusal is recorded, never acted on (the job runs without it). */
export function onJobRuntimeAnswer(t: JobLayerTx, e: PendingRead, r: Response | null, at: number): void {
  const status = r === null ? -1 : r.footer.status;
  if (status === 0 || t.s.job === null) return;
  const what = e.line?.includes('"fi"') === true ? 'the feed-limit period' : 'the job flag';
  if (e.line?.includes('"fi"') === true && t.s.job.feedLimit !== null) patchJob(t, { feedLimit: null });
  jobEvent(t, at, 'info', `The controller did not take ${what} (status ${status}); the job runs without it.`);
}

/** A feed-limit summary or change line arrived (display only; observational, never a cause, H78). */
/** A fresh window for a job that just opened one. */
export function feedLimitWindow(fi: number): FeedLimitState {
  return { fi, first: null, prev: null, last: null, move: null, short: false, unsupported: false };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** An `fs` body as a summary; 'unsupported' for a format version run does not read; null for a malformed one. */
export function parseFeedSummary(body: JsonObject): FeedSummary | 'unsupported' | null {
  if (body['v'] !== 1) return finite(body['v']) ? 'unsupported' : null;
  const c = body['c'];
  if (!Array.isArray(c) || c.length < 6 || !c.every(finite) || !finite(body['e']) || !finite(body['q']) || !finite(body['ct']) || !finite(body['cd'])) return null;
  return Object.freeze({ e: body['e'], q: body['q'], c: Object.freeze(c.slice(0, 6) as number[]), ct: body['ct'], cd: body['cd'] });
}

/** An `fl` body as the executing move's limit; null for a malformed one. Missing `m`, `p`, `n` read as 0, null, null. */
export function parseFeedMove(body: JsonObject): FeedMove | null {
  if (!finite(body['k'])) return null;
  return Object.freeze({ k: body['k'], m: finite(body['m']) ? body['m'] : 0, p: finite(body['p']) ? body['p'] : null, n: finite(body['n']) ? body['n'] : null });
}

/**
 * Folds one feed-limit push into the window (pure; the UI's replay tests use it too). A summary of a new window epoch
 * starts over; one that does not advance the sequence is ignored (a repeat or a late frame); the executing move
 * replaces the last one.
 */
export function foldFeedLimit(state: FeedLimitState, kind: 'fs' | 'fl', body: JsonObject, short: boolean): FeedLimitState {
  if (kind === 'fl') {
    const move = parseFeedMove(body);
    return move === null ? state : { ...state, move };
  }
  const fs = parseFeedSummary(body);
  if (fs === null) return state;
  if (fs === 'unsupported') return state.unsupported ? state : { ...state, unsupported: true };
  const sameWindow = state.last !== null && state.last.e === fs.e;
  if (sameWindow && fs.q <= (state.last as FeedSummary).q) return state;
  return { ...state, first: sameWindow && state.first !== null ? state.first : fs, prev: sameWindow ? state.last : null, last: fs, short: state.short || short };
}

export function onFeedLimit(t: JobLayerTx, kind: 'fs' | 'fl', body: JsonObject, short: boolean): void {
  const fl = t.s.job?.feedLimit;
  if (fl === null || fl === undefined) return;
  const next = foldFeedLimit(fl, kind, body, short);
  if (next !== fl) patchJob(t, { feedLimit: next });
}

// --- Streaming (H76) ----------------------------------------------------------------------------------------

/** Job lines still owed an answer (not late). */
export function jobInFlight(s: SessionState): number {
  let n = 0;
  for (const e of s.expected) if (e.purpose === 'job' && !e.late) n++;
  return n;
}

/** Free line slots there are room for now: the last footer's free count less every line still owed. */
export function slotRoom(s: SessionState): number {
  const free = s.job?.free;
  return free === null || free === undefined ? 0 : free - jobInFlight(s);
}

function isBreakpoint(j: JobState, index: number): boolean {
  const line = j.lines[index] as SentLine;
  if (!j.breakpoints.includes(line.sourceLine)) return false;
  // Only at the first sent line of that file line (a split move is one file line).
  return index === 0 || (j.lines[index - 1] as SentLine).sourceLine !== line.sourceLine;
}

/**
 * Writes job lines while the slots allow (the reducer calls it at the end of every transition). Never more than
 * the free slots less the reserve; never while a non-job line is owed (one control line at a time, and data lines
 * stay in order); stops before a tool change and a breakpoint, after a program stop line; holds the final M2/M30
 * back until every earlier line is answered (H35).
 */
export function pumpJob(t: JobLayerTx, allowedNow: boolean): void {
  const s = t.s;
  const j = s.job;
  if (j === null || j.phase !== 'running' || s.base !== 'RUNNING' || !allowedNow || s.footerRev !== 3) return;
  if (s.expected.some((e) => !e.late && e.purpose !== 'job') || s.writing !== null || s.queue.some((q) => q.purpose === 'motion')) return;
  let next = j.next;
  let room = slotRoom(s);
  const written: Expected[] = [];
  let sentLines = s.sent.lines;
  let stop: JobState['stop'] = null;
  while (next < j.lines.length) {
    const line = j.lines[next] as SentLine;
    if (j.passed !== next && line.toolChange !== undefined) {
      stop = { kind: 'toolChange', index: next };
      break;
    }
    if (j.passed !== next && isBreakpoint(j, next)) {
      stop = { kind: 'breakpoint', index: next };
      break;
    }
    if (line.holdback && (j.acked < next || written.length > 0)) break;
    if (room <= JOB_LIMITS.reserve) break;
    sentLines++;
    t.emit({ kind: 'writeLine', epoch: s.epoch, seq: sentLines, token: 'job', line: line.text, intent: 'jobLine', index: next });
    written.push({ token: 'job', purpose: 'job', index: next, late: false });
    room--;
    next++;
    if (line.barrier) {
      stop = { kind: 'barrier', index: next - 1 };
      break;
    }
  }
  if (written.length > 0) t.set({ expected: [...t.s.expected, ...written], sent: { ...t.s.sent, lines: sentLines } });
  if (next !== j.next) patchJob(t, { next });
  if (stop === null && next >= j.lines.length) stop = { kind: 'end', index: j.lines.length - 1 };
  if (stop !== null) beginDrain(t, stop);
}

/** Feeding stopped before (or after) a stop point: wait for every answer and two polled reads at rest. */
function beginDrain(t: JobLayerTx, stop: NonNullable<JobState['stop']>): void {
  // The job flag goes off before run's own deliberate stops and after the last line (feed-limit step 3).
  sendJobFlag(t, 0);
  patchJob(t, { phase: stop.kind === 'end' ? 'ending' : 'draining', stop, confirmed: 0 });
  requestPoll(t);
  t.arm('job', JOB_LIMITS.drainPollMs);
}

/** A job line was answered (data answers come in order). */
export function onJobAnswer(t: JobLayerTx, e: PendingRead, r: Response, at: number): void {
  const j = t.s.job;
  /* c8 ignore next -- job lines are owed only while their job exists (a new load or connect clears them) */
  if (j === null) return;
  const index = e.index as number;
  // (The free slots of its footer were taken by the reducer, as for every revision 3 answer.)
  patchJob(t, { acked: Math.max(j.acked, index + 1) });
  if (r.footer.status === 0 || !ACTIVE_PHASES.has(j.phase)) return;
  // H70: a refused line. Nothing after it is sent; the job is held at that line until the user decides.
  const line = j.lines[index] as SentLine;
  const status = r.footer.status;
  const meaning = statusMeaning(dialect(t.s), status);
  const text = w38({ line: line.sourceLine, status, meaning });
  jobEvent(t, at, 'error', text, line.sourceLine);
  if (j.refused !== null) return;
  patchJob(t, { refused: { index, status, text: line.body }, message: text });
  if (j.stopping) return;
  if (j.phase === 'pausing' || j.phase === 'paused') {
    // The refusal arrived during a Pause (R4): the hold already asked for (or confirmed) is the refusal's hold,
    // and the job is `refused` from here, so a plain Resume is denied until the line is skipped (C33) or the job
    // is stopped, and the page keeps the refusal card.
    patchJob(t, { phase: 'refused' });
    return;
  }
  pauseJob(t, at, 'refused');
}

/** Plain words for a status code (W38). */
export function statusMeaning(d: Dialect, status: number): string {
  const entry = d.status.get(status);
  if (entry === undefined) return 'an error';
  switch (entry.statusClass) {
    case 'softLimit':
      return 'outside the soft limits';
    case 'mcodeUnsupported':
      return 'an M code this firmware does not support';
    case 'notAccepted':
      return 'not accepted now';
    case 'overlong':
      return 'the line is too long';
    case 'rejectedAlarm':
    case 'rejectedShutdown':
    case 'rejectedPanic':
      return 'the controller is in alarm';
    case 'bufferFull':
      return 'the line or its answer was damaged';
    default:
      return entry.name.toLowerCase().replace(/_/g, ' ');
  }
}

// --- Pause, resume ------------------------------------------------------------------------------------------

/** Pause (`!`) during a job. Returns false when the job layer does not handle it (the caller sends `!` alone). */
export function onJobPause(t: JobLayerTx, at: number): boolean {
  const j = t.s.job;
  if (j === null || !jobsCapable(t.s, t.config) || t.s.motion !== null) return false;
  if (j.phase !== 'running' && j.phase !== 'draining' && j.phase !== 'ending') return false;
  pauseJob(t, at, 'pause');
  return true;
}

function pauseJob(t: JobLayerTx, at: number, why: 'pause' | 'refused'): void {
  writeRealtime(t, 'feedhold', 'feedhold');
  t.set({ notices: { ...t.s.notices, pauseRequestedAt: at } });
  patchJob(t, { phase: why === 'refused' ? 'refused' : 'pausing', confirmed: 0, pauseAt: at });
  if (why === 'pause') jobEvent(t, at, 'info', 'Pause: feedhold sent.');
  requestPoll(t);
  t.arm('job', JOB_LIMITS.drainPollMs);
}

/** Resume a paused or stopped job (the matrix has allowed `resume`: HELD or PROGRAM_PAUSED, no overlay). */
export function onJobResume(t: JobLayerTx, request: Extract<SessionIntent, { intent: 'resume' }>, at: number): Decision {
  const s = t.s;
  const j = s.job;
  /* c8 ignore next -- the reducer calls this only for an active job */
  if (j === null) return deny('No job is paused.', 'Nothing to do.');
  if (s.rxm.step !== null || s.expected.some((e) => !e.late && e.purpose !== 'job')) return deny('The controller is still answering.', 'Wait a moment.');
  const held = s.live.hold !== undefined && s.live.hold !== 0;
  switch (j.phase) {
    case 'paused':
    case 'programStop': {
      if (held) writeRealtime(t, 'resume', 'jobLine');
      continueJob(t, at, 'Resumed.');
      return ALLOWED;
    }
    case 'refused': {
      if (request.skip !== true) return deny('A line was refused.', 'Use Stop job, or skip the line and continue (C33).');
      if (j.confirmed < 2 && j.pauseAt !== null) return deny('The hold is not confirmed yet.', 'Wait a moment.');
      if (held) writeRealtime(t, 'resume', 'jobLine');
      patchJob(t, { refused: null });
      continueJob(t, at, 'Skipped the refused line and resumed.');
      return ALLOWED;
    }
    case 'breakpoint': {
      patchJob(t, { passed: (j.stop as NonNullable<JobState['stop']>).index });
      continueJob(t, at, 'Resumed from the breakpoint.');
      return ALLOWED;
    }
    case 'toolChange':
      return resumeToolChange(t, request, at);
    default:
      return deny('The job is not paused.', 'Wait for the pause to complete.');
  }
}

function continueJob(t: JobLayerTx, at: number, text: string): void {
  sendJobFlag(t, 1);
  t.set({ base: 'RUNNING', notices: { ...t.s.notices, motion: { kind: 'resumed', text: 'Resumed', at } } });
  forgetBoardModes(t); // N5: the job's own lines run again (after a tool change the jog and the return set them meanwhile)
  patchJob(t, { phase: 'running', stop: null, confirmed: 0, pauseAt: null, message: null });
  jobEvent(t, at, 'info', text);
  t.arm('job', JOB_LIMITS.runPollMs);
}

/**
 * After a manual tool change (H74, C34): back to where the job stopped at a safe height if the machine was moved,
 * the spindle (and coolant) again when the file does not restart it (C35), then the M6 line itself, then on.
 */
function resumeToolChange(t: JobLayerTx, request: Extract<SessionIntent, { intent: 'resume' }>, at: number): Decision {
  const s = t.s;
  const j = s.job as JobState;
  const tc = j.toolChange as NonNullable<JobState['toolChange']>;
  // OD-24: offsets read again since the stop (the Z re-zero): the rest of the job is checked against the travel again,
  // from the values read at Start with only the re-zeroed Z offset changed (jobTravel.ts).
  const travel = resumeTravel(s, j, activeSystem(s), (state) => sanitizeLive(state, j.source.text, j.source.c22));
  if (travel.refusal !== null) return deny(travel.refusal, 'Use Stop job to end the job.');
  if (travel.note !== null) jobEvent(t, at, 'warn', travel.note);
  const steps: { line: string; intent: Intent }[] = [];
  const here = s.live.mpo;
  const back = tc.at;
  const moved = (['x', 'y', 'z'] as const).some((a) => back[a] !== undefined && (here[a] === undefined || Math.abs((here[a] as number) - (back[a] as number)) > JOB_LIMITS.returnToleranceMm));
  if (moved) {
    if (here.z === undefined || back.x === undefined || back.y === undefined || back.z === undefined) return deny('The machine position is not known.', 'Wait for the position to be reported.');
    // Explicit absolute millimetres on their own answered line first (R1): G53 keeps G91 and G20, under which the
    // "safe" Z would be a distance (down) or inches. Then the job's own modes are put back before it goes on.
    steps.push(
      { line: ABSOLUTE_MM_LINE, intent: 'resume' },
      { line: safeZLine(Math.max(here.z, back.z)), intent: 'resume' },
      { line: returnXYLine(back.x, back.y), intent: 'resume' },
      { line: restoreLine(tc.units, tc.dist), intent: 'resume' },
    );
  }
  const restart = tc.spindle !== 'off' && !tc.restartsSpindle;
  if (restart) {
    if (request.spindleRestart !== true || tc.speed === null) {
      return deny(tc.speed === null ? 'The spindle was on, but its speed is not known.' : c35({ direction: tc.spindle === 'cw' ? 'M3' : 'M4', rpm: tc.speed }), tc.speed === null ? 'Stop the job and restart it from a line that sets the speed.' : 'Confirm the spindle restart (C35).');
    }
    steps.push({ line: spindleLine(tc.spindle as 'cw', tc.speed), intent: 'resume' });
  }
  if (tc.mist) steps.push({ line: 'M7', intent: 'resume' });
  if (tc.flood) steps.push({ line: 'M8', intent: 'resume' });
  if (steps.some((x) => motionLineKind(x.line) === undefined)) return deny('The way back is out of range.', 'Stop the job.');
  if (moved && (tc.dist === undefined || tc.units === undefined)) return deny("The job's distance mode or units are not known, so they cannot be put back after the return.", 'Stop the job.');
  patchJob(t, { phase: 'resuming', resumeSteps: steps, passed: tc.index, confirmed: 0 });
  jobEvent(t, at, 'toolchange', `Resuming after the tool change${steps.length > 0 ? `: ${steps.map((x) => x.line).join(', ')}` : ''}.`, (s.job as JobState).lines[tc.index]?.sourceLine);
  nextResumeStep(t, at);
  return ALLOWED;
}

function nextResumeStep(t: JobLayerTx, at: number): void {
  const j = job(t.s);
  const [first, ...rest] = j.resumeSteps;
  if (first === undefined) {
    continueJob(t, at, 'Resumed after the tool change.');
    return;
  }
  patchJob(t, { resumeSteps: rest, confirmed: 0 });
  queue(t, { token: 'gc', purpose: 'motion', line: first.line, intent: first.intent });
  requestPoll(t);
  t.arm('job', JOB_LIMITS.drainPollMs);
}

/**
 * A motion line of the job layer was answered: a tool change's `M5` or `M9` (`outputsOff`, R6), or a resume step.
 * A refused shutdown line fails the job closed (the outputs may still be on); a refused resume step ends the
 * resume (the job stays at the tool change). Returns false when the answer is not the job layer's.
 */
export function onJobMotionAnswer(t: JobLayerTx, line: string | undefined, status: number, at: number): boolean {
  const j = t.s.job;
  if (j === null) return false;
  // OD-19: the start-modes line; its read-back decides, a refusal ends the start at once.
  if (j.phase === 'checking') {
    if (status !== 0) startFailed(t, at, `The job did not start: the controller refused ${String(line)} (status ${status}).`);
    return true;
  }
  if (j.phase === 'outputsOff') {
    if (status !== 0) {
      outputsOffFailed(t, at, `the controller refused ${String(line)} (status ${status})`);
      return true;
    }
    // Both M5 and M9 answered with status 0 (one line at a time, in order): now the card may say they are off.
    if (dataSettled(t.s)) changeReady(t, at);
    return true;
  }
  if (j.phase !== 'resuming') return false;
  if (status !== 0) {
    patchJob(t, { phase: 'toolChange', resumeSteps: [], passed: null });
    jobEvent(t, at, 'error', `The controller refused ${String(line)} (status ${status}); the job is still at the tool change.`);
  }
  return true;
}

/** A motion line of the job layer went unanswered (the answer timer, `readAnswerMs`): fail closed (R6). */
export function onJobMotionTimeout(t: JobLayerTx, line: string | undefined, at: number): void {
  const j = t.s.job;
  if (j === null) return;
  if (j.phase === 'checking') {
    startFailed(t, at, `The job did not start: the controller did not answer ${String(line)} in time.`);
    return;
  }
  if (j.phase === 'outputsOff') {
    outputsOffFailed(t, at, `the controller did not answer ${String(line)} in time`);
    return;
  }
  if (j.phase === 'resuming') {
    t.set({ queue: t.s.queue.filter((q) => q.purpose !== 'motion') });
    patchJob(t, { phase: 'toolChange', resumeSteps: [], passed: null });
    jobEvent(t, at, 'error', `The controller did not answer ${String(line)} in time; the job is still at the tool change.`);
  }
}

/** The spindle or coolant could not be confirmed off at a tool change (R6): the job ends, the outputs may be on. */
function outputsOffFailed(t: JobLayerTx, at: number, why: string): void {
  const j = job(t.s);
  const line = j.lines[(j.toolChange as NonNullable<JobState['toolChange']>).index]?.sourceLine ?? 0;
  const text = `The job ended at the tool change at line ${line}: ${why}. The spindle and coolant may still be on: use your E-stop or the controller's own stop.`;
  t.cancel('job');
  t.set({ queue: t.s.queue.filter((q) => q.purpose !== 'motion'), base: idleBase(t.s), notices: { ...t.s.notices, adviseEstop: true } });
  patchJob(t, { phase: 'failed', message: text, endedAt: at, toolChange: null, stop: null });
  jobEvent(t, at, 'error', text);
}

/** `M5` and `M9` are answered (R6): the tool-change card (W37) and its Resume, jog and Z re-zero are offered. */
function changeReady(t: JobLayerTx, at: number): void {
  const j = job(t.s);
  const tc = j.toolChange as NonNullable<JobState['toolChange']>;
  patchJob(t, { phase: 'toolChange', message: w37() });
  jobEvent(t, at, 'toolchange', `Spindle and coolant off (M5 and M9 answered). Tool change at line ${j.lines[tc.index]?.sourceLine ?? 0}${tc.tool === null ? '' : `: T${tc.tool}`}.`, j.lines[tc.index]?.sourceLine);
}

// --- Polls and timer ----------------------------------------------------------------------------------------

/** At rest at a program stop: stat 3 or 4 (EN M0 holds with `hold` 6), nothing moving, planner empty (H36). */
function drainedAtBarrier(s: SessionState, p: PolledValues): boolean {
  const cls = mapStat(dialect(s), p.stat);
  return (cls === 'programStop' || cls === 'end' || cls === 'idle') && p.vel === 0 && p.qr === planner(s);
}

function dataSettled(s: SessionState): boolean {
  return !s.queue.some((q) => q.purpose === 'motion') && s.writing?.purpose !== 'motion' && !s.expected.some((e) => !e.late && e.purpose === 'motion');
}

/** One poll cycle was answered (after `qr`), with no motion of the motion layer running. */
export function onJobPoll(t: JobLayerTx, at: number): void {
  const s = t.s;
  const j = s.job;
  if (j === null || !ACTIVE_PHASES.has(j.phase) || s.motion !== null) return;
  const p = completedPoll(s);
  if (p === null) {
    // A read of this cycle was rejected, damaged or missing: it confirms nothing, whatever the live view says (R5).
    if (j.phase === 'draining' || j.phase === 'ending' || j.phase === 'pausing' || j.phase === 'refused' || j.phase === 'resuming') {
      patchJob(t, { confirmed: 0 });
      requestPoll(t);
    }
    return;
  }
  const confirm = (ok: boolean): number => (ok ? j.confirmed + 1 : 0);
  switch (j.phase) {
    case 'draining':
    case 'ending': {
      const stop = j.stop as NonNullable<JobState['stop']>;
      const answered = j.acked >= j.next;
      const rest = stop.kind === 'barrier' ? drainedAtBarrier(s, p) : atRestPolled(s, p);
      const confirmed = confirm(answered && rest);
      patchJob(t, { confirmed });
      if (confirmed < MOTION_LIMITS.confirmations) {
        requestPoll(t);
        return;
      }
      stopReached(t, at, stop);
      return;
    }
    case 'pausing':
    case 'refused': {
      // The hold is complete, or the machine is at rest (nothing was moving): the job is paused at this line.
      // A `!` that landed before the cycle started is dropped, and a dwell reads vel 0: only a resting machine is at rest.
      const confirmed = confirm(heldPolled(s, p) || (atRestPolled(s, p) && j.acked >= j.next));
      patchJob(t, { confirmed });
      if (confirmed < MOTION_LIMITS.confirmations) {
        // `!` is dropped while no cycle runs yet (a line still parsing): send it again once a cycle has started.
        if (p.hold === 0 && !atRestPolled(s, p)) writeRealtime(t, 'feedhold', 'feedhold');
        if (j.pauseAt !== null && at - j.pauseAt > JOB_LIMITS.pauseNoAnswerMs && s.notices.motion?.kind !== 'failed') {
          t.set({ notices: { ...t.s.notices, motion: { kind: 'failed', text: "No answer from the board yet: use your E-stop if it's still moving", at } } });
        }
        requestPoll(t);
        return;
      }
      t.cancel('job');
      t.set({ base: 'HELD', notices: { ...t.s.notices, motion: { kind: 'paused', text: s.live.spe === 1 ? 'Paused · spindle still on' : 'Paused', at } } });
      if (j.phase === 'pausing') {
        patchJob(t, { phase: 'paused', message: s.live.spe === 1 ? 'Paused · spindle still on' : 'Paused' });
        jobEvent(t, at, 'info', 'Paused.', lastFileLine(j, s.live.line));
      }
      return;
    }
    case 'resuming': {
      const confirmed = confirm(atRestPolled(s, p) && dataSettled(s));
      patchJob(t, { confirmed });
      if (confirmed < MOTION_LIMITS.confirmations) {
        requestPoll(t);
        return;
      }
      nextResumeStep(t, at);
      return;
    }
    default:
      // running: the planner gauge's `qr` is now known, and a fresh f[2] came with the poll answers.
      return;
  }
}

function stopReached(t: JobLayerTx, at: number, stop: NonNullable<JobState['stop']>): void {
  const s = t.s;
  const j = job(s);
  t.cancel('job');
  if (stop.kind === 'end') {
    if (j.feedLimit !== null) queue(t, { token: 'rt', purpose: 'jobRuntime', line: feedLimitLine(0) });
    // A job is sanitised before it can start, so its report exists.
    const end = (j.report as JobReportSummary).endState;
    const outputs = end.spindle === 'off' && !end.mist && !end.flood ? 'spindle and coolant commanded off' : `spindle ${end.spindle === 'off' ? 'off' : 'ON'}, coolant ${end.mist || end.flood ? 'ON' : 'off'} (commanded)`;
    const text = `Job finished: ${j.lines.length} lines, ${outputs}.`;
    t.set({ base: idleBase(s) });
    patchJob(t, { phase: 'done', message: text, endedAt: at, stop: null });
    jobEvent(t, at, 'info', text);
    return;
  }
  const line = (j.lines[stop.index] as SentLine).sourceLine;
  t.set({ base: 'PROGRAM_PAUSED' });
  if (stop.kind === 'toolChange') {
    const tc = (j.lines[stop.index] as SentLine).toolChange as NonNullable<SentLine['toolChange']>;
    // H74: the spindle and coolant go off before anyone reaches in. The card says so (W37) only once M5 and M9
    // are each answered with status 0 (`outputsOff`, R6); a refusal or a missing answer ends the job closed.
    // The job's units and distance mode, read at rest after every line of the job was answered and before M5, so
    // they are known when the card comes (modes.ts): the last pushed report may predate the job's last mode change.
    queueModeReads(t, 'toolChange');
    queue(t, { token: 'gc', purpose: 'motion', line: 'M5', intent: 'spindleOffNow' });
    queue(t, { token: 'gc', purpose: 'motion', line: 'M9', intent: 'spindleOffNow' });
    patchJob(t, {
      phase: 'outputsOff',
      message: `Tool change at line ${line}: turning the spindle and coolant off (M5, M9). Wait for the card.`,
      toolChange: { index: stop.index, ...tc, at: { ...s.live.mpo }, units: undefined, dist: undefined, stoppedAt: at },
    });
    jobEvent(t, at, 'toolchange', `Tool change at line ${line}${tc.tool === null ? '' : `: T${tc.tool}`}: sending M5 and M9.`, line);
    return;
  }
  if (stop.kind === 'breakpoint') {
    const text = `${w43({ line })}${s.live.spe === 1 ? ' · spindle still on' : ''}`;
    patchJob(t, { phase: 'breakpoint', message: text });
    jobEvent(t, at, 'info', text, line);
    return;
  }
  const text = `Program stop at line ${line}: the spindle and coolant may still be running.`;
  patchJob(t, { phase: 'programStop', message: text });
  jobEvent(t, at, 'warn', text, line);
}

/** The `job` timer: the next poll, the STALE limit and the liveness grace period. */
export function onJobTimer(t: JobLayerTx, deps: JobDeps, at: number): void {
  const s = t.s;
  const j = s.job;
  if (j === null) return;
  if (j.faultStopAt !== null) {
    if (at >= j.faultStopAt && !j.stopping) {
      // SAFETY §3 effect 4: nobody stopped the job during the grace period: stop it with the spindle off.
      patchJob(t, { faultStopAt: null, stopping: true });
      beginHold(t, 'stopJob', at);
      return;
    }
    t.arm('job', Math.max(1, j.faultStopAt - at));
    return;
  }
  if (!ACTIVE_PHASES.has(j.phase)) return;
  if (s.overlays.includes('STALE') && s.stale !== null && (j.phase === 'running' || j.phase === 'draining' || j.phase === 'ending') && at - s.stale.at >= JOB_LIMITS.staleFaultMs) {
    deps.fault(t, 'staleWhileRunning', 'liveness', `no reports from the controller for ${Math.round((at - s.stale.at + s.stale.silentForMs) / 1000)} s while the job ran`, at);
    return;
  }
  if (j.phase === 'running') {
    requestPoll(t);
    t.arm('job', JOB_LIMITS.runPollMs);
    return;
  }
  if (j.phase === 'outputsOff' || j.phase === 'toolChange' || j.phase === 'breakpoint' || j.phase === 'programStop' || j.phase === 'paused' || j.phase === 'checking' || j.phase === 'preparing') {
    if (j.phase === 'checking' || j.phase === 'preparing') t.arm('job', JOB_LIMITS.drainPollMs);
    return;
  }
  requestPoll(t);
  t.arm('job', JOB_LIMITS.drainPollMs);
}

// --- Endings -------------------------------------------------------------------------------------------------

/** Stop job / Spindle off during a job: the motion layer's flush sequence; this marks the job as stopping. */
export function onJobStop(t: JobLayerTx, at: number): boolean {
  const j = t.s.job;
  if (j === null || !ACTIVE_PHASES.has(j.phase) || !jobsCapable(t.s, t.config)) return false;
  if (j.phase === 'checking' || (j.phase === 'preparing' && t.s.rxm.step?.kind === 'write')) {
    // Nothing was sent: the re-check's reads are dropped (R3), or the line-mode write is being answered (the EEPROM
    // stall) and is let finish; the job will not start.
    // OD-19: and the start-modes line, if it has not gone out yet.
    if (j.phase === 'checking') t.set({ queue: t.s.queue.filter((q) => q.purpose !== 'jobPrep' && q.intent !== 'jobModes') });
    patchJob(t, { phase: 'stopped', message: 'Stopped before the first line: nothing was sent.', endedAt: at });
    t.set({ base: idleBase(t.s) });
    t.cancel('job');
    return true;
  }
  patchJob(t, { stopping: true, faultStopAt: null, resumeSteps: [] });
  t.cancel('job');
  if (t.s.motion?.reason === 'stopJob') return false; // already stopping: the motion layer re-sends `!`
  beginHold(t, 'stopJob', at);
  return true;
}

/** The board reset during the job (H72): everything queued is gone. */
export function onJobReset(t: JobLayerTx, at: number): void {
  if (!jobActive(t.s)) return;
  const j = job(t.s);
  failJob(t, at, w40({ line: lastFileLine(j, t.s.live.line) }));
  t.set({ expected: t.s.expected.filter((e) => e.purpose !== 'job') });
}

/** The link dropped during the job (H71). */
export function onJobLinkLost(t: JobLayerTx, at: number): void {
  if (!jobActive(t.s)) return;
  failJob(t, at, `The connection was lost at line ${lastFileLine(job(t.s), t.s.live.line)}. The machine may keep running what it had queued.`);
}

/**
 * A FAULT latched during the job. Integrity: end it at once with the flush sequence (SAFETY §3 effect 3; the
 * maintainer's sequence in Phase 3, ^D stays unused). Liveness: the grace period, then the same (effect 4).
 */
export function onJobFault(t: JobLayerTx, kind: 'integrity' | 'liveness', detail: string, at: number, linkUsable: boolean): void {
  if (!jobActive(t.s)) return;
  const j = job(t.s);
  const line = lastFileLine(j, t.s.live.line);
  failJob(t, at, `The job ended at line ${line}: ${detail}.`);
  if (!linkUsable) return;
  if (kind === 'liveness') {
    patchJob(t, { faultStopAt: at + JOB_LIMITS.faultGraceMs });
    t.arm('job', JOB_LIMITS.faultGraceMs);
    return;
  }
  patchJob(t, { stopping: true });
  beginHold(t, 'stopJob', at);
}
