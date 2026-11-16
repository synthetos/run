import { type JsonObject } from '@synthetos/protocol';
import {
  CEILING_SECONDS,
  DEFAULT_K,
  sanitizeJob,
  type AxisValues,
  type MotionModel,
  type SanitizeResult,
  type StartState,
  type Wcs
} from '@synthetos/safety';
import { sessionSettings } from '../settingWrite.ts';
import type { Axis, SessionState } from '../types.ts';
import { dialect, numberOf } from './shared.ts';

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
  const toolOffset = liveToolOffset(ofs, coord, g92);
  const defaults = liveDefaults(s);
  return {
    ...liveModes(units, dist, plan, admo),
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

function liveToolOffset(ofs: AxisValues | undefined, coord: AxisValues | undefined, g92: AxisValues | undefined): AxisValues | undefined {
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
  return toolOffset;
}

const plane = (v: number | undefined): 'G17' | 'G18' | 'G19' | undefined => (v === 0 ? 'G17' : v === 1 ? 'G18' : v === 2 ? 'G19' : undefined);

function liveDefaults(s: SessionState): NonNullable<StartState['defaults']> {
  const gun = scalar(s, 'gun');
  const gdi = scalar(s, 'gdi');
  const gpl = scalar(s, 'gpl');
  const gco = scalar(s, 'gco');
  return {
    ...(gun === 1 ? { units: 'G21' as const } : gun === 0 ? { units: 'G20' as const } : {}),
    ...(gdi === 0 ? { distance: 'G90' as const } : gdi === 1 ? { distance: 'G91' as const } : {}),
    ...(plane(gpl) === undefined ? {} : { plane: plane(gpl) as 'G17' }),
    ...(gco !== undefined && gco >= 1 && gco <= 6 ? { wcs: WCS_OF[gco - 1] as Wcs } : {}),
  };
}

function liveModes(units: number | undefined, dist: number | undefined, plan: number | undefined, admo: number | undefined): StartState {
  return {
    ...(units === 1 ? { units: 'G21' as const } : units === 0 ? { units: 'G20' as const } : {}),
    ...(dist === 0 ? { distance: 'G90' as const } : dist === 1 ? { distance: 'G91' as const } : {}),
    ...(admo === 0 ? { arcDistance: 'G90.1' as const } : admo === 1 ? { arcDistance: 'G91.1' as const } : {}),
    ...(plane(plan) === undefined ? {} : { plane: plane(plan) as 'G17' }),
  };
}
