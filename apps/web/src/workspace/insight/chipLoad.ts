/**
 * Chip load and surface speed for the Advanced "Cutting" rows (owner, 2026-11-09). Pure maths, no state.
 * - chip load fz = feed ÷ (rpm × flutes), mm per tooth;
 * - surface speed vc = π × D × rpm ÷ 1000, m/min.
 * Both use the tool's full diameter. For a ball nose (or a V-bit) the diameter in the cut is smaller at a shallow
 * depth, so the real chip load and surface speed are lower than shown; the rows say so.
 *
 * The band to compare against (owner, 2026-11-10, OD-35: "✓ 0.75–1.25× with one number, the maker's range when
 * there is one"): the tool's own cutting data for the job's material gives one recommended fz, so the band is
 * 0.75–1.25 × fz, and below the Analyze rubbing floor (35 % of fz, advisor THRESHOLDS) it is also a rubbing risk; the
 * material's chip-load range for the tool material (factor × D, @synthetos/advisor chiploadRange) is used as it is.
 * Below the band is light, above it heavy.
 */
import { chiploadAt, chiploadRange, surfaceSpeed, THRESHOLDS } from '@synthetos/advisor';
import type { Material, Tool, ToolType } from '@synthetos/library';

/** With one recommended fz: ✓ from 0.75 to 1.25 times it (OD-35). */
export const ONE_NUMBER_BAND = Object.freeze({ low: 0.75, high: 1.25 });

export interface Range {
  readonly min: number;
  readonly max: number;
}

/** mm per tooth, or null when the spindle is stopped, there are no flutes, or a number is missing. */
export function chipLoad(feedMmMin: number | null, rpm: number | null, flutes: number | null): number | null {
  if (feedMmMin === null || rpm === null || flutes === null) return null;
  if (!(rpm > 0) || !(flutes > 0) || !(feedMmMin >= 0) || !Number.isFinite(feedMmMin)) return null;
  return chiploadAt(feedMmMin, rpm, flutes);
}

/** m/min, or null when the spindle is stopped or the diameter is not a positive number. */
export function surfaceSpeedMpm(diameterMm: number | null, rpm: number | null): number | null {
  if (diameterMm === null || rpm === null || !(diameterMm > 0) || !(rpm > 0)) return null;
  return surfaceSpeed(rpm, diameterMm);
}

/** Tool shapes whose cutting diameter shrinks at a shallow depth: the rows say the full diameter is used. */
export function usesFullDiameterNote(type: ToolType): string | null {
  if (type === 'ball') return 'Ball nose: worked out with the full diameter. A shallow cut is narrower, so the real chip load and surface speed are lower.';
  if (type === 'v-bit') return 'V-bit: worked out with the full diameter. A shallow cut is narrower, so the real chip load and surface speed are lower.';
  return null;
}

/** `fz`: the ✓ band. `rubbing`: below this a light chip load is also a rubbing risk (one number only). */
export type Reference =
  | { readonly from: 'tool'; readonly fz: Range; readonly rubbing: number; readonly vc: Range | null; readonly target: { readonly fz: number; readonly vc: number | undefined } }
  | { readonly from: 'material'; readonly fz: Range; readonly rubbing: null; readonly vc: Range | null };

/** What to compare the chip load against for this tool in this material, or null when nothing is recorded. */
export function referenceFor(tool: Tool, materialId: string, mat: Material | null): Reference | null {
  const own = tool.cuttingData.find((c) => c.materialRef.id === materialId && c.fz > 0);
  if (own !== undefined) {
    // The surface speed is shown against the tool's own vc, not judged: only the chip load gets a verdict.
    const fz = { min: own.fz * ONE_NUMBER_BAND.low, max: own.fz * ONE_NUMBER_BAND.high };
    return { from: 'tool', fz, rubbing: own.fz * THRESHOLDS.rubbingFloorFraction, vc: null, target: { fz: own.fz, vc: own.vc } };
  }
  const cut = mat?.cutting.find((c) => c.toolMaterial === tool.toolMaterial);
  if (cut === undefined || !(tool.geometry.diameter > 0)) return null;
  return { from: 'material', fz: chiploadRange(cut.chipload.value, tool.geometry.diameter), rubbing: null, vc: cut.vc.value };
}

export type Verdict = 'ok' | 'light' | 'heavy';

export function verdict(value: number, range: Range): Verdict {
  if (value < range.min) return 'light';
  if (value > range.max) return 'heavy';
  return 'ok';
}

/** Light and also under the rubbing floor (one recommended number only). */
export function rubbingRisk(value: number, ref: Reference): boolean {
  return ref.rubbing !== null && value < ref.rubbing;
}
