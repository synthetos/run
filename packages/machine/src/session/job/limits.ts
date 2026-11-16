import { MOTION_LIMITS } from '../motion.ts';

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
