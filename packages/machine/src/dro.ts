/**
 * The DRO's view of a session snapshot (ROADMAP P1-07): work and machine
 * coordinates, the active work coordinate system with its offsets, homed
 * flags, and the live position marker, each labelled with its source and
 * age.
 *
 * - Machine position and the marker come ONLY from polled `mpo`
 *   (`values.mpo`, see positionPoller.ts). An `mpo*` field in a status
 *   report (`live.mpo`) is never used: EN's default report has none, and a
 *   filtered report does not repeat unchanged values (SAFETY §4.2).
 * - The lag badge is amber once the polled position is 1 s old and red at
 *   STALE (the overlay, or 2 s without a fresh poll).
 * - Work position comes from the status report (`posx`..), labelled so.
 * - The marker is in work coordinates (polled `mpo` minus the read `ofs`),
 *   the frame the G-code preview draws in; without a read `ofs` there is
 *   no marker rather than one in the wrong place.
 *
 * Pure: the same snapshot and `now` always give the same view.
 */
import { DEFAULT_TIMINGS, type Axis } from './session/types.ts';
import type { SessionSnapshot } from './session/snapshot.ts';

export const DRO_AXES: readonly Axis[] = Object.freeze(['x', 'y', 'z', 'a', 'b', 'c']);
/** Amber lag badge from this age of the polled position (P1-07). */
export const LAG_AMBER_MS = 1000;
/** Red at this age even before the watchdog's STALE (SAFETY §4.2: STALE after 2 s). */
export const LAG_RED_MS = DEFAULT_TIMINGS.staleAfterMs;

export type Lag = 'none' | 'fresh' | 'amber' | 'red';

export interface DroAxis {
  readonly axis: Axis;
  /** Polled machine position, mm; null when not polled yet. */
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
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly ageMs: number;
  readonly lag: Lag;
}

export interface DroView {
  readonly axes: readonly DroAxis[];
  readonly machineSource: { readonly label: 'polled mpo'; readonly at: number | null; readonly ageMs: number | null; readonly lag: Lag };
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

export function lagOf(ageMs: number | null, stale: boolean): Lag {
  if (ageMs === null) return 'none';
  if (stale || ageMs >= LAG_RED_MS) return 'red';
  return ageMs >= LAG_AMBER_MS ? 'amber' : 'fresh';
}

export function droView(s: SessionSnapshot, now: number): DroView {
  const polled = s.values['mpo'];
  const mpo = polled !== undefined && polled.status === 0 ? numbers(polled.value) : null;
  const at = mpo === null ? null : (polled as { readonly at: number }).at;
  const ageMs = at === null ? null : Math.max(0, now - at);
  const lag = lagOf(ageMs, s.overlays.includes('STALE'));
  const hom = numbers(readOk(s, 'hom'));
  const coor = readOk(s, 'coor');
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
  const xyz = ['x', 'y', 'z'] as const;
  if (mpo !== null && total !== null && ageMs !== null && xyz.every((a) => mpo[a] !== undefined && total[a] !== undefined)) {
    const work = (axis: Axis): number => (mpo[axis] as number) - (total[axis] as number);
    marker = Object.freeze({ x: work('x'), y: work('y'), z: work('z'), ageMs, lag });
  }
  return Object.freeze({
    axes: Object.freeze(axes),
    machineSource: Object.freeze({ label: 'polled mpo', at, ageMs, lag }),
    workSource: Object.freeze({ label: 'status report' }),
    units,
    wcs: Object.freeze({ code, offsets, total }),
    marker,
  });
}
