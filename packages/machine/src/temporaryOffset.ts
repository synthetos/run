/**
 * The temporary offset (G92) the board applies now, estimated from what it reports (display only: the
 * "G92 offset active" hint next to the live position).
 *
 * The board's whole work offset is machine minus work position: `pos` is `mpo` less the G5x, G92 and tool
 * offsets of the block running, in the board's units (@cite EN canonical_machine.c:389-407; ofs :2732,
 * always mm). Its parts were read at connect, at job preparation and after each offset change run makes,
 * but a job's own G92, G10, G54..G59 or M30 changes them without a read. So the G92 now is the G92 read
 * plus whatever the whole offset moved by since `ofs` was read, less the saved offset of a coordinate
 * system the job selected since. A job's G10 or G43.1 cannot be told from a G92 this way (both are rare in
 * CAM files); the estimate then names a G92 that is really one of them.
 *
 * `g92` and `g54`..`g59` are printed in the current units, `ofs` always in mm (@cite EN config_app.c:430-435
 * `_fic`, config.h:275 F_CONVERT), so the reads are converted with the units read beside them.
 */
import type { SessionSnapshot } from './session/snapshot.ts';
import type { Axis } from './session/types.ts';

const XYZ = ['x', 'y', 'z'] as const;
const MM_PER_INCH = 25.4;

/** Below this (mm) a difference is report rounding, not an offset: 3 decimals, in inches 0.0127 mm a step. */
function offsetToleranceMm(unit: number): number {
  return unit === 0 ? 0.03 : 0.005;
}

type Xyz = Readonly<Record<'x' | 'y' | 'z', number>>;

function readXyz(s: SessionSnapshot, token: string): Xyz | null {
  const r = s.values[token];
  if (r === undefined || r.status !== 0 || typeof r.value !== 'object' || r.value === null || Array.isArray(r.value)) return null;
  const v = r.value as Record<string, unknown>;
  const out: Partial<Record<'x' | 'y' | 'z', number>> = {};
  for (const a of XYZ) {
    const n = v[a];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    out[a] = n;
  }
  return out as Xyz;
}

function readNumber(s: SessionSnapshot, token: string): number | undefined {
  const r = s.values[token];
  return r !== undefined && r.status === 0 && typeof r.value === 'number' ? r.value : undefined;
}

function liveXyz(v: Readonly<Partial<Record<Axis, number>>>): Xyz | null {
  return XYZ.every((a) => typeof v[a] === 'number' && Number.isFinite(v[a])) ? { x: v.x as number, y: v.y as number, z: v.z as number } : null;
}

/** The saved offset of coordinate system `coor` (1 = G54 .. 6 = G59) as read, or null (G53, unknown, not read). */
function savedOffset(s: SessionSnapshot, coor: number | undefined): Xyz | null {
  return coor !== undefined && coor >= 1 && coor <= 6 ? readXyz(s, `g${String(53 + coor)}`) : null;
}

/** The G92 offset the board applies now, mm, X Y Z, with the units it reports in; null when the reports or reads needed are missing. */
function estimate(s: SessionSnapshot): { readonly g92: Xyz; readonly unit: number } | null {
  const mpo = liveXyz(s.live.mpo);
  const pos = liveXyz(s.live.pos);
  const ofs = readXyz(s, 'ofs');
  const g92 = readXyz(s, 'g92');
  const unitRead = readNumber(s, 'unit');
  // Display only (OD-19): the reported `pos` is in the reports' units; this estimate marks the readout, it writes nothing.
  const unit = s.live.unit ?? unitRead;
  if (mpo === null || pos === null || ofs === null || g92 === null || unit === undefined) return null;
  const k = unit === 0 ? MM_PER_INCH : 1;
  const kRead = (unitRead ?? unit) === 0 ? MM_PER_INCH : 1;
  // A coordinate system selected since the read: its saved offset is not a G92.
  const coorRead = readNumber(s, 'coor');
  const from = savedOffset(s, coorRead);
  const to = savedOffset(s, s.live.coor ?? coorRead);
  const out = { x: 0, y: 0, z: 0 };
  for (const a of XYZ) {
    const saved = from === null || to === null ? 0 : (to[a] - from[a]) * kRead;
    out[a] = g92[a] * kRead + (mpo[a] - pos[a] * k - ofs[a]) - saved;
  }
  return { g92: out, unit };
}

/** The G92 offset the board applies now, mm, X Y Z; null when the reports or reads needed are missing. */
export function temporaryOffsetNow(s: SessionSnapshot): Xyz | null {
  return estimate(s)?.g92 ?? null;
}

/** True when the board's work position includes a G92 offset now; null when it cannot be told. */
export function temporaryOffsetActive(s: SessionSnapshot): boolean | null {
  const e = estimate(s);
  if (e === null) return null;
  const tol = offsetToleranceMm(e.unit);
  return XYZ.some((a) => Math.abs(e.g92[a]) > tol);
}
