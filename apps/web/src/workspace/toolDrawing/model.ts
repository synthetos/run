/**
 * The tool's side view, to scale (owner, 2026-11-09: "similar to how Fusion does it"; typing a stickout should show
 * what stickout means). The outline is gcode-view's own profile (toolProfile.ts, through the 3D marker's
 * `toolShapeOf`), so the drawing, the 3D bit and the carving agree.
 *
 * Millimetres, the tip at the origin, height up the axis. The whole tool is drawn to its overall length; the holder
 * face sits at the stickout. Numbers that cannot be right are kept as typed and flagged, never dropped: flutes
 * longer than the stickout (they go into the collet), a stickout longer than the tool, a shank thinner than the
 * cutter on a type that does not have a reduced shank.
 *
 * Pure.
 */
import { formatLength, type ToolUnit } from '../tools/units.ts';
import { tipHeight, toolOutline } from '@synthetos/gcode-view';
import type { Tool, ToolGeometry, ToolType } from '@synthetos/library';
import { toolShapeOf } from '../../preview/activeTool.ts';

/** The numbers the drawing dimensions. */
export type DimKey = 'diameter' | 'shank' | 'stickout' | 'fluteLength' | 'overallLength';

export const DIM_KEYS: readonly DimKey[] = Object.freeze(['diameter', 'shank', 'stickout', 'fluteLength', 'overallLength']);

export interface Dimension {
  readonly key: DimKey;
  /** `across`: a width (diameter, shank) at height `at`; `along`: a length up the axis from `from` to `to`. */
  readonly orient: 'across' | 'along';
  readonly value: number;
  readonly from: number;
  readonly to: number;
  /** For `across`, the height it is measured at. */
  readonly at: number;
  readonly label: string;
}

export interface DrawingIssue {
  readonly key: DimKey;
  readonly text: string;
}

export interface ToolDrawingModel {
  /** The closed outline, both sides, as [x, height] points from the tip round and back. */
  readonly outline: readonly (readonly [number, number])[];
  readonly radius: number;
  readonly shankRadius: number;
  /** Where the tip shape reaches the full diameter, and the top of the flutes. */
  readonly tipTop: number;
  readonly fluteTop: number;
  /** The top of the tool (its overall length). */
  readonly top: number;
  /** The holder face (the stickout), or null when no stickout is set. */
  readonly holder: number | null;
  readonly flutes: number;
  readonly dims: readonly Dimension[];
  readonly issues: readonly DrawingIssue[];
}

/** Types whose shank may be thinner than the cutter (a V-bit, a chamfer mill, an engraver, a surfacing bit, a drill). */
const REDUCED_SHANK_OK: ReadonlySet<ToolType> = new Set(['v-bit', 'chamfer', 'engraver', 'surfacing', 'drill']);

export const ISSUE_TEXT = Object.freeze({
  flutesInCollet: 'The flutes go into the collet: the flute length is longer than the stickout.',
  stickoutTooLong: 'The stickout is longer than the tool: it can stick out at most its overall length.',
  flutesTooLong: 'The flutes are longer than the tool.',
  thinShank: 'The shank is thinner than the cutting diameter. This type usually has a shank at least as wide.',
});

function positive(n: number | undefined): number {
  return n !== undefined && Number.isFinite(n) && n > 0 ? n : 0;
}

/** The geometry as typed, with the numbers that are not usable for drawing kept at a small size. */
function safe(g: ToolGeometry): ToolGeometry {
  const diameter = positive(g.diameter) || 1;
  return { ...g, diameter, shank: positive(g.shank) || diameter, fluteLength: positive(g.fluteLength), overallLength: positive(g.overallLength) || Math.max(positive(g.fluteLength), diameter * 4) };
}

/** The side view of `tool` (its geometry as typed), with its dimensions and what cannot be right. */
export function toolDrawingModel(tool: Pick<Tool, 'type' | 'geometry'>, unit: ToolUnit = 'mm'): ToolDrawingModel {
  const lengthText = (n: number): string => formatLength(n, unit);
  const g = safe(tool.geometry);
  const shape = { ...toolShapeOf({ type: tool.type, geometry: g }), length: g.overallLength };
  const half = toolOutline(shape);
  const outline = [...half.map(([r, y]) => [r, y] as const), ...[...half].reverse().map(([r, y]) => [-r, y] as const)];
  const radius = g.diameter / 2;
  const shankRadius = g.shank / 2;
  const tipTop = tipHeight(shape);
  const fluteTop = Math.max(g.fluteLength, tipTop);
  const top = Math.max(g.overallLength, fluteTop);
  const stickout = tool.geometry.stickout;
  const holder = stickout !== undefined && Number.isFinite(stickout) && stickout > 0 ? stickout : null;
  const issues: DrawingIssue[] = [];
  if (holder !== null && g.fluteLength > holder) issues.push({ key: 'fluteLength', text: ISSUE_TEXT.flutesInCollet });
  if (holder !== null && holder > g.overallLength) issues.push({ key: 'stickout', text: ISSUE_TEXT.stickoutTooLong });
  if (g.fluteLength > g.overallLength) issues.push({ key: 'fluteLength', text: ISSUE_TEXT.flutesTooLong });
  if (g.shank < g.diameter && !REDUCED_SHANK_OK.has(tool.type)) issues.push({ key: 'shank', text: ISSUE_TEXT.thinShank });
  const dims: Dimension[] = [
    { key: 'diameter', orient: 'across', value: g.diameter, from: -radius, to: radius, at: tipTop + (fluteTop - tipTop) / 2, label: `Ø${lengthText(g.diameter)}` },
    { key: 'shank', orient: 'across', value: g.shank, from: -shankRadius, to: shankRadius, at: fluteTop + (top - fluteTop) / 2, label: `Ø${lengthText(g.shank)}` },
    { key: 'fluteLength', orient: 'along', value: g.fluteLength, from: 0, to: g.fluteLength, at: 0, label: `Flutes ${lengthText(g.fluteLength)}` },
    { key: 'overallLength', orient: 'along', value: g.overallLength, from: 0, to: g.overallLength, at: 0, label: `Overall ${lengthText(g.overallLength)}` },
    ...(holder === null ? [] : [{ key: 'stickout' as const, orient: 'along' as const, value: holder, from: 0, to: holder, at: 0, label: `Stickout: out of the holder ${lengthText(holder)}` }]),
  ];
  return { outline, radius, shankRadius, tipTop, fluteTop, top, holder, flutes: Math.max(1, Math.round(positive(g.flutes) || 1)), dims, issues };
}

/** A grid step that gives about `targetPx` between lines at `pxPerMm`: 1, 2 or 5 times a power of ten, in mm. */
export function niceStep(pxPerMm: number, targetPx = 32): number {
  const raw = targetPx / Math.max(pxPerMm, 1e-6);
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  /* c8 ignore next -- 10 × p is always at least raw */
  return 10 * p;
}

/** The flute hatching as line segments in mm, inside the cutting diameter over the fluted part: more flutes, more lines. */
export function fluteHatch(m: ToolDrawingModel): readonly (readonly [number, number, number, number])[] {
  const height = m.fluteTop - m.tipTop;
  if (height <= 0) return [];
  const count = Math.min(24, Math.max(3, m.flutes * 3));
  const pitch = (height + m.radius) / count;
  const out: (readonly [number, number, number, number])[] = [];
  // A helix seen from the side: lines rising from left to right, one radius over the width.
  for (let i = 0; i <= count; i++) {
    const y0 = m.tipTop + i * pitch - m.radius;
    out.push([-m.radius, y0, m.radius, y0 + m.radius]);
  }
  return out;
}
