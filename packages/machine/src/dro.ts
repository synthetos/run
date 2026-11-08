/**
 * The DRO's view of a session snapshot (ROADMAP P1-07): work and machine
 * coordinates, the active work coordinate system with its offsets, homed
 * flags, and the live position marker, each labelled with its source and
 * age.
 *
 * - Push-driven (amendment 2026-11-02): machine and work position come from
 *   the connect-time read (the `mpo` and `pos` groups) and then from pushed
 *   status reports, whose list the session set to carry `mpox`.. and
 *   `posx`... Reports are change-filtered: an unchanged value is not sent
 *   again, so a value is current as long as the link is alive. Its age is
 *   the time since the board last said anything (a report, a heartbeat or
 *   an answer), and the badge is amber at 80 % and red at 100 % of the
 *   session's silence window (STALE). Nothing polls.
 * - The marker is the work position as the board reports it (`posx`..,
 *   in its units): the coordinates the G-code is written in, a G92 offset
 *   included (@cite EN canonical_machine.c:389-407). *Amended 2026-11-07
 *   (G92 frame fix):* it was `mpo` minus the `ofs` read before the job,
 *   which a job's own G92 leaves stale, so it disagreed with the G-code by
 *   the G92 offset. Without a reported X, Y and Z there is no marker. Where
 *   the tool sits in the drawing is the preview's to work out from the file
 *   line the board reports (gcode frames.ts), not this view's.
 * - `g92` says the position includes a temporary offset now
 *   (temporaryOffset.ts); false when that cannot be told.
 *
 * Pure: the same snapshot and `now` always give the same view.
 */
import { DEFAULT_TIMINGS, type Axis } from './session/types.ts';
import type { SessionSnapshot } from './session/snapshot.ts';
import { temporaryOffsetActive } from './temporaryOffset.ts';

export const DRO_AXES: readonly Axis[] = Object.freeze(['x', 'y', 'z', 'a', 'b', 'c']);
/** Red at the silence window with the heartbeat on (the default timings). */
export const LAG_RED_MS = DEFAULT_TIMINGS.reportSilenceMs;
/** Amber at 80 % of it. */
export const LAG_AMBER_MS = LAG_RED_MS * 0.8;

/** The lag thresholds of a snapshot's silence window. */
export function lagThresholds(s: Pick<SessionSnapshot, 'link'>): { readonly amberMs: number; readonly redMs: number } {
  return { amberMs: s.link.silenceMs * 0.8, redMs: s.link.silenceMs };
}

export type Lag = 'none' | 'fresh' | 'amber' | 'red';

export interface DroAxis {
  readonly axis: Axis;
  /** Machine position, mm (connect-time read, then pushed reports); null when not known yet. */
  readonly machine: number | null;
  /** Work position from the status report, in the board's units; null when not reported. */
  readonly work: number | null;
  /** From a read of `hom`; null when not read. */
  readonly homed: boolean | null;
}

export interface DroWcs {
  /** `G54`..`G59`, `G53` for machine coordinates, or null when `coor` was not read. */
  readonly code: string | null;
  /** The active system's offsets (`g5x` read), or null. */
  readonly offsets: Readonly<Partial<Record<Axis, number>>> | null;
  /** Total current offsets (`ofs` read, including G92), or null. */
  readonly total: Readonly<Partial<Record<Axis, number>>> | null;
}

export interface DroMarker {
  /** Work position as reported, in the board's units. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly units: 'mm' | 'in' | null;
  /** A G92 offset is part of the position now (temporaryOffset.ts). */
  readonly g92: boolean;
  readonly ageMs: number;
  readonly lag: Lag;
}

export interface DroView {
  readonly axes: readonly DroAxis[];
  readonly machineSource: { readonly label: 'status report'; readonly at: number | null; readonly ageMs: number | null; readonly lag: Lag };
  /** Work position is whatever the last status report carried (filtered reports repeat nothing). */
  readonly workSource: { readonly label: 'status report' };
  readonly units: 'mm' | 'in' | null;
  readonly wcs: DroWcs;
  readonly marker: DroMarker | null;
}

function numbers(value: unknown): Readonly<Partial<Record<Axis, number>>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const out: Partial<Record<Axis, number>> = {};
  for (const axis of DRO_AXES) {
    const v = (value as Record<string, unknown>)[axis];
    if (typeof v === 'number' && Number.isFinite(v)) out[axis] = v;
  }
  return out;
}

/** A read value, only when it answered with status 0. */
function readOk(s: SessionSnapshot, token: string): unknown {
  const r = s.values[token];
  return r !== undefined && r.status === 0 ? r.value : undefined;
}

export function lagOf(ageMs: number | null, stale: boolean, thresholds: { readonly amberMs: number; readonly redMs: number } = { amberMs: LAG_AMBER_MS, redMs: LAG_RED_MS }): Lag {
  if (ageMs === null) return 'none';
  if (stale || ageMs >= thresholds.redMs) return 'red';
  return ageMs >= thresholds.amberMs ? 'amber' : 'fresh';
}

export function droView(s: SessionSnapshot, now: number): DroView {
  const known = Object.keys(s.live.mpo).length > 0;
  const mpo = known ? s.live.mpo : null;
  // Values exist only once a line was received, so its time is known.
  const at = known ? (s.live.lastRxAt as number) : null;
  const ageMs = at === null ? null : Math.max(0, now - at);
  const lag = lagOf(ageMs, s.overlays.includes('STALE'), lagThresholds(s));
  const hom = numbers(readOk(s, 'hom'));
  const coor = s.live.coor ?? readOk(s, 'coor');
  const code = typeof coor === 'number' && Number.isInteger(coor) && coor >= 0 && coor <= 6 ? `G${53 + coor}` : null;
  const offsets = code !== null && code !== 'G53' ? numbers(readOk(s, code.toLowerCase())) : null;
  const total = numbers(readOk(s, 'ofs'));
  const unitValue = s.live.unit ?? readOk(s, 'unit');
  const units = unitValue === 1 ? 'mm' : unitValue === 0 ? 'in' : null;
  const axes = DRO_AXES.map((axis) =>
    Object.freeze({
      axis,
      machine: mpo?.[axis] ?? null,
      work: s.live.pos[axis] ?? null,
      homed: hom === null ? null : hom[axis] === 1,
    }),
  );
  let marker: DroMarker | null = null;
  const pos = s.live.pos;
  const rxAge = s.live.lastRxAt === undefined ? null : Math.max(0, now - s.live.lastRxAt);
  if (rxAge !== null && (['x', 'y', 'z'] as const).every((a) => typeof pos[a] === 'number' && Number.isFinite(pos[a]))) {
    marker = Object.freeze({ x: pos.x as number, y: pos.y as number, z: pos.z as number, units, g92: temporaryOffsetActive(s) === true, ageMs: rxAge, lag: lagOf(rxAge, s.overlays.includes('STALE'), lagThresholds(s)) });
  }
  return Object.freeze({
    axes: Object.freeze(axes),
    machineSource: Object.freeze({ label: 'status report', at, ageMs, lag }),
    workSource: Object.freeze({ label: 'status report' }),
    units,
    wcs: Object.freeze({ code, offsets, total }),
    marker,
  });
}
