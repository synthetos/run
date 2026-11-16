import { mapStat, type Dialect, type MachineClass } from '@synthetos/protocol';
import { type Decision } from '@synthetos/safety';
import { jobActive } from '../jobState.ts';
import { restingStat } from '../resting.ts';
import type { JogAxis, MotionCtx, PolledValues, SessionBase, SessionConfig, SessionState } from '../types.ts';
import { JOG_AXES, LETTER } from './limits.ts';

export function deny(reason: string, remedy: string): Decision {
  return { allowed: false, reason, remedy, citation: 'SAFETY §4.5b' };
}

/**
 * True when this session may move the machine at all: a motion release, a classified board that was not
 * made READ_ONLY (an approved build), and a dialect with both `%` and `~`.
 */
export function motionCapable(s: SessionState, config: SessionConfig): boolean {
  const d = s.dialect;
  return config.release.motion && d !== null && s.classification?.mode === 'full' && !s.overlays.includes('READ_ONLY') && d.realtime.flush !== undefined && d.realtime.resume !== undefined;
}

/** The idle base the homing state calls for. */
export function idleBase(s: SessionState): SessionBase {
  return s.live.home === 1 ? 'IDLE_HOMED' : 'IDLE_UNHOMED';
}

export function dialect(s: SessionState): Dialect {
  return s.dialect as Dialect;
}

export function machineClass(s: SessionState): MachineClass | undefined {
  return s.live.stat === undefined ? undefined : mapStat(dialect(s), s.live.stat);
}

export function planner(s: SessionState): number {
  return dialect(s).limits.plannerBlocks;
}

/**
 * The values of the poll cycle that just completed, or null when any of its four reads was rejected (a non-zero
 * status, or no number), damaged or missing (independent review 2026-11-03, R5). Shared with the job layer.
 */
export function completedPoll(s: SessionState): PolledValues | null {
  const p = s.polled;
  if (p === null || p.failed || p.stat === undefined || p.hold === undefined || p.vel === undefined || p.qr === undefined) return null;
  return { stat: p.stat, hold: p.hold, vel: p.vel, qr: p.qr };
}

/** At rest by this cycle's polled values: idle or ended, not moving, nothing held, planner empty. Shared with the job layer. */
export function atRestPolled(s: SessionState, p: PolledValues): boolean {
  // The same rule as READING (resting.ts, SAFETY H14 as amended 2026-11-02), plus hold 0 on every dialect.
  return s.dwellWait == null && restingStat(dialect(s), p.stat, p.hold) && p.vel === 0 && p.hold === 0 && p.qr === planner(s);
}

/** The hold is complete by this cycle's polled `hold`. Shared with the job layer. */
export function heldPolled(s: SessionState, p: PolledValues): boolean {
  return dialect(s).hold[p.hold] === 'HOLD';
}

/**
 * No motion line is waiting or being written. (None can be owed an answer either: the board answers lines in
 * order, so when a later poll or line has been answered every earlier motion line has been answered too.)
 */
export function motionLinesSettled(s: SessionState): boolean {
  return !s.queue.some((q) => q.purpose === 'motion') && s.writing?.purpose !== 'motion';
}

/** `G5x` of the active system (`coor` 1..6), or null when it is not known or G53. */
export function activeSystem(s: SessionState): number | null {
  const coor = s.live.coor;
  return coor !== undefined && Number.isInteger(coor) && coor >= 1 && coor <= 6 ? coor : null;
}

/** Plain names: "X, Y and Z". */
export function axisNames(axes: readonly JogAxis[]): string {
  const n = axes.map((a) => LETTER[a]);
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n.at(-1) as string}`;
}

/** Where a motion returns: CONNECTED_UNKNOWN if it started there, else the idle base for the homing state. */
export function returnBase(ctx: MotionCtx, s: SessionState): SessionBase {
  if (ctx.returnTo === 'PROGRAM_PAUSED' && ctx.reason !== 'stopJob' && jobActive(s)) return 'PROGRAM_PAUSED';
  return ctx.returnTo === 'CONNECTED_UNKNOWN' && s.overlays.length > 0 ? 'CONNECTED_UNKNOWN' : idleBase(s);
}

/** Common preconditions of every motion intent beyond the matrix (SAFETY §4.5b). */
export function precondition(s: SessionState): Decision | undefined {
  // An idle base is reached only in a motion-capable session (an approved board with a motion release). The matrix has already required an idle base (or JOGGING, for the jog row): JOGGING always has a motion,
  // and an alarm moves the base to ALARM (checkAlarm).
  if (s.motion !== null) return deny('Another move is still running.', 'Wait for it to finish, or use Pause or Stop job.');
  return undefined;
}

export function validAxes(axes: Readonly<Partial<Record<JogAxis, 1 | -1>>>): boolean {
  const keys = typeof axes === 'object' && axes !== null ? Object.keys(axes) : [];
  return keys.length > 0 && keys.every((k) => (JOG_AXES as readonly string[]).includes(k) && (axes[k as JogAxis] === 1 || axes[k as JogAxis] === -1));
}

export function validAxisList(axes: readonly JogAxis[]): boolean {
  return Array.isArray(axes) && axes.length > 0 && axes.length <= 4 && new Set(axes).size === axes.length && axes.every((a) => (JOG_AXES as readonly string[]).includes(a));
}

/** Machine Z, mm: from the connect-time read of `mpo`, then from pushed reports (amendment 2026-11-02). */
export function machineZ(s: SessionState): number | undefined {
  return s.live.mpo.z;
}
