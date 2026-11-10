/**
 * "Z is low. Raise Z first?" for a typed G0 (OD-31, owner 2026-11-09: "ask first").
 *
 * A G0 that moves X or Y while Z is below safe Z is asked about before anything is sent; G1, G2 and G3 never are (a
 * feed move at depth is meant). Safe Z is go to zero's (SAFETY H53, OD-23): `ztm − 1` in machine coordinates, and only
 * when Z was homed by a homing cycle this connection saw. Otherwise how high Z is cannot be told, so the question is
 * still asked, with only Move as typed and Cancel, and says why.
 *
 * Raise sends go to zero's own lines before the move: `G90 G21` (so the `G53` move is absolute millimetres, R1),
 * `G53 G0 Z<safe>` (never lower than Z is now), then the board's units and distance mode put back as read before the
 * move, so a typed G91 or G20 stays. Raise is not offered when the move has its own Z word (it sets Z itself) or when
 * those modes were not read.
 *
 * Pure.
 */
import type { TypedLine } from '@synthetos/safety';
import { axisHomedHere } from './homedAxes.ts';
import { ABSOLUTE_MM_LINE, restoreLine, safeZLine } from './motionLines.ts';
import { travelLimits } from './travelCheck.ts';
import type { SessionState, TypedLowZ } from './types.ts';

export const LOW_Z_TEXT = Object.freeze({
  question: 'Z is low. Raise Z first?',
  notHomed: "Z wasn't homed in this connection, so Run doesn't know a safe height to raise it to.",
  ownZ: 'This move sets Z itself.',
  modes: "The board's units and distance mode were not read.",
  noZ: "Run doesn't know where Z is.",
});

/** Below safe Z by more than this, mm, counts as low (go to zero rounds safe Z to 0.001 mm). */
const LOW_BY_MM = 0.01;

function machineZ(s: SessionState): number | null {
  const v = s.values['mpo'];
  const z = v !== undefined && v.status === 0 && typeof v.value === 'object' && v.value !== null && !Array.isArray(v.value) ? (v.value as Readonly<Record<string, unknown>>)['z'] : undefined;
  return typeof z === 'number' && Number.isFinite(z) ? z : null;
}

/** Go to zero's safe Z (`ztm − 1`, machine mm), only when Z was homed by a cycle this connection saw; else null. */
export function typedSafeZ(s: SessionState): number | null {
  const z = travelLimits(s).Z;
  if (!axisHomedHere(s, 'Z') || z.kind !== 'set' || z.max === null) return null;
  return Math.round((z.max - 1) * 1000) / 1000;
}

/**
 * The question for this typed line, or null when none is asked: not a G0, no X or Y word, or Z at or above safe Z.
 * `units` and `dist` are the board's modes as read before the move (modes.ts).
 */
export function typedLowZ(s: SessionState, t: TypedLine, units: number | undefined, dist: number | undefined): TypedLowZ | null {
  if (t.motion !== 0 || (t.words.X === undefined && t.words.Y === undefined)) return null;
  const z = machineZ(s);
  const safeZ = typedSafeZ(s);
  if (safeZ !== null && z !== null && z >= safeZ - LOW_BY_MM) return null;
  const why = safeZ === null ? LOW_Z_TEXT.notHomed : z === null ? LOW_Z_TEXT.noZ : t.words.Z !== undefined ? LOW_Z_TEXT.ownZ : (units !== 0 && units !== 1) || (dist !== 0 && dist !== 1) ? LOW_Z_TEXT.modes : null;
  return { raise: why === null, safeZ, z, why };
}

/** Go to zero's raise, then the modes put back: the lines Raise sends before the move. Only when Raise is offered. */
export function raiseLines(q: TypedLowZ, units: number, dist: number): readonly string[] {
  return [ABSOLUTE_MM_LINE, safeZLine(Math.max(q.z as number, q.safeZ as number)), restoreLine(units, dist)];
}
