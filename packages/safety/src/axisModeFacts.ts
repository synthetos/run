/**
 * Axis-mode facts for read-only sessions (Phase 0 finding row 35, its
 * consequence for Phase 1; docs/safety/REVIEW_FINDINGS_STATUS.md).
 *
 * Phase 1 sends no motion, but it is the first time run reads a real board,
 * and an axis-mode configuration that is unsafe for LATER motion must be
 * shown to the owner, never hidden or smoothed over. This module turns the
 * live reads (`xam`..`cam`, `mpo`) into facts the read-only views render
 * (P1-07). It is pure; the sanitiser keeps blocking motion on the same
 * conditions in its own right (`inhibited-axis`, `axis-mode`), so nothing
 * here relaxes anything.
 *
 * What it reports, per axis:
 *
 * - `mode-not-read`: the axis mode was not read. It may be inhibited or
 *   disabled; every later move is blocked until it is read.
 * - `mode-not-recognised`: the board reported a value outside 0..3.
 * - `inhibited-away-from-zero`: inhibited (`am=2`) while the position reads
 *   away from 0, or is unknown. TinyG forces an inhibited axis's joint to 0
 *   on every segment (@cite EN kinematics.c:59; TG kinematics.c:63) and moves
 *   each motor by the difference of absolute step targets (@cite EN
 *   plan_exec.c:742-751; TG plan_exec.c:718-727), so the next move of ANY
 *   axis drives that motor back to step 0.
 * - `inhibited`: inhibited and reading 0. Safe to leave as it is; but the
 *   board reports the mode and the position, never the step target, so if
 *   the mode is later changed the position must be resynchronised (homing,
 *   or G28.3) before any move (the row 35 remainder).
 * - `left-inhibited-this-session`: the axis read inhibited earlier in this
 *   session and now reads another mode (disabled included: only inhibited
 *   zeroes the joint). Its step target may differ from its position, which
 *   no read shows; the next move of any axis could drive its motor out to
 *   the position. This stays reported for the rest of the session; run
 *   cannot resynchronise in Phase 1.
 * - `linear-disabled`, `linear-radius`: X, Y or Z disabled (`am=0`; TinyG
 *   ignores its words) or reading radius mode (`am=3`, which `cm_set_am`
 *   refuses on a linear axis; the words are ignored too) (@cite EN
 *   canonical_machine.c:531-545, :2756-2770; TG canonical_machine.c:444-454,
 *   :1723-1732).
 *
 * Every fact here is `unsafeForMotion`: later motion stays blocked while it
 * holds. An axis in standard mode, or a rotary axis disabled or in radius
 * mode, produces no fact (a rotary axis's radius mode is modelled by the
 * sanitiser).
 *
 * Controller-neutral by data: the inhibited-joint behaviour is cited for the
 * TinyG family only (INHIBITED_JOINT_BEHAVIOUR). For any family where it is
 * not verified, an inhibited axis is reported as
 * `inhibited-behaviour-unverified`, whatever its position.
 */
import type { Family } from '@synthetos/protocol';
import { formatNumber, ROTARY } from './sanitize/geometry.ts';
import { AXES, AXIS_MODE_DISABLED, AXIS_MODE_INHIBITED, AXIS_MODE_RADIUS, type Axis } from './sanitize/types.ts';

/** Whether a family's inhibited-axis joint behaviour is cited in source or not yet verified. */
export const INHIBITED_JOINT_BEHAVIOUR: Readonly<Record<Family, 'cited' | 'unverified'>> = Object.freeze({
  tinyg: 'cited',
  g2core: 'unverified',
});

export type AxisModeFactCode =
  | 'mode-not-read'
  | 'mode-not-recognised'
  | 'inhibited-away-from-zero'
  | 'inhibited'
  | 'inhibited-behaviour-unverified'
  | 'left-inhibited-this-session'
  | 'linear-disabled'
  | 'linear-radius';

export interface AxisModeFact {
  readonly axis: Axis;
  readonly code: AxisModeFactCode;
  /** The `am` value as read, or null when it was not read. */
  readonly mode: number | null;
  /** The machine position as read (`mpo`), or null when it is not known. */
  readonly position: number | null;
  /** Always true: later motion stays blocked while this fact holds. */
  readonly unsafeForMotion: true;
  /** One plain sentence for the read-only views (rendered as text, never as markup). */
  readonly text: string;
}

/** One read of the axis modes and machine positions. A missing axis was not read. */
export interface AxisModeReading {
  /** `xam`..`cam` as reported. */
  readonly modes: Readonly<Partial<Record<Axis, number>>>;
  /** `mpo*` as reported, mm or degrees; null or missing when not known. */
  readonly machine: Readonly<Partial<Record<Axis, number | null>>>;
}

/** What a session remembers between reads: the axes that have read inhibited at least once. */
export interface AxisModeSession {
  readonly everInhibited: ReadonlySet<Axis>;
}

export const EMPTY_AXIS_MODE_SESSION: AxisModeSession = Object.freeze({ everInhibited: new Set<Axis>() });

function modeName(axis: Axis): string {
  return `${axis.toLowerCase()}am`;
}

function where(position: number | null): string {
  return position === null ? 'its position is not known' : `it reads ${formatNumber(position, 3)}`;
}

function factFor(family: Family, axis: Axis, mode: number | undefined, position: number | null, session: AxisModeSession): AxisModeFact | null {
  const fact = (code: AxisModeFactCode, text: string): AxisModeFact => ({ axis, code, mode: mode ?? null, position, unsafeForMotion: true, text });
  const am = modeName(axis);
  if (mode === undefined) return fact('mode-not-read', `The axis mode of ${axis} (${am}) was not read, so ${axis} may be inhibited or disabled. Motion stays blocked until it is read.`);
  if (!Number.isInteger(mode) || mode < AXIS_MODE_DISABLED || mode > AXIS_MODE_RADIUS) {
    return fact('mode-not-recognised', `${axis} reports axis mode ${am}=${String(mode)}, which is not a mode this controller defines. Motion stays blocked.`);
  }
  if (mode === AXIS_MODE_INHIBITED) {
    if (INHIBITED_JOINT_BEHAVIOUR[family] !== 'cited') {
      return fact('inhibited-behaviour-unverified', `${axis} is inhibited (${am}=2) and ${where(position)}. How this controller moves an inhibited axis's motor is not verified, so motion stays blocked.`);
    }
    if (position !== 0) {
      return fact(
        'inhibited-away-from-zero',
        `${axis} is inhibited (${am}=2) and ${where(position)}. TinyG drives an inhibited axis's motor to step 0 on the next move of any axis, by an amount no overrun bound covers. Motion stays blocked until ${axis} reads 0.`,
      );
    }
    return fact(
      'inhibited',
      `${axis} is inhibited (${am}=2) and reads 0. If its mode is changed later, re-home or set its position (G28.3) before any move: the board does not report where its motor is.`,
    );
  }
  if (session.everInhibited.has(axis)) {
    return fact(
      'left-inhibited-this-session',
      `${axis} read inhibited earlier in this session and now reads ${am}=${mode}. Its motor may not be where its position says, and no read shows it; the next move of any axis could drive it there. Motion stays blocked until ${axis} is re-homed or its position is set.`,
    );
  }
  if (!ROTARY.has(axis) && mode === AXIS_MODE_DISABLED) {
    return fact('linear-disabled', `${axis} is disabled (${am}=0): TinyG ignores ${axis} words, so a program would not run as written. Motion on ${axis} stays blocked.`);
  }
  if (!ROTARY.has(axis) && mode === AXIS_MODE_RADIUS) {
    return fact('linear-radius', `${axis} reads radius mode (${am}=3), which TinyG refuses on a linear axis and in which it ignores ${axis} words. Motion on ${axis} stays blocked.`);
  }
  // Standard on any axis; disabled or radius on a rotary axis (the sanitiser models those).
  return null;
}

/**
 * The axis-mode facts for one read, and the session state to pass to the
 * next call. Every axis X..C is considered: an axis missing from the read is
 * reported as `mode-not-read`, never assumed standard.
 */
export function axisModeFacts(
  family: Family,
  reading: AxisModeReading,
  session: AxisModeSession = EMPTY_AXIS_MODE_SESSION,
): { readonly facts: readonly AxisModeFact[]; readonly session: AxisModeSession } {
  const facts: AxisModeFact[] = [];
  const everInhibited = new Set(session.everInhibited);
  for (const axis of AXES) {
    const mode = reading.modes[axis];
    const raw = reading.machine[axis];
    // Number.isFinite is false for null, undefined, NaN and the infinities: all of them mean "not known".
    const position = Number.isFinite(raw) ? (raw as number) : null;
    const fact = factFor(family, axis, mode, position, session);
    if (fact !== null) facts.push(Object.freeze(fact));
    if (mode === AXIS_MODE_INHIBITED) everInhibited.add(axis);
  }
  return { facts: Object.freeze(facts), session: Object.freeze({ everInhibited }) };
}
