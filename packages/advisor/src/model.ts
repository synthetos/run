/**
 * Model data and thresholds of the rules engine (MACHINING_ASSISTANT §5.2).
 *
 * Two kinds of numbers live here:
 *
 * - **Data** (`ModelData`): the frame-class chipload factors, and the tool
 *   types and tool materials from the library seed. These are `Sourced`
 *   values, placeholders today (owner decision §10.5); a caller may pass its
 *   own cited `ModelData`, and the provenance of every recommendation says
 *   which inputs were placeholders.
 * - **Thresholds** (`THRESHOLDS`): the model's own design values, taken from
 *   §5.2 where it gives them. They are rules, not material data.
 */
import {
  BUILTIN_TOOL_MATERIALS,
  BUILTIN_TOOL_TYPES,
  SEED_PLACEHOLDER_NOTE,
  deepFreeze,
  type FrameClass,
  type Sourced,
  type ToolMaterial,
  type ToolMaterialSpec,
  type ToolTypeSpec,
} from '@synthetos/library';

export interface ModelData {
  /** Multiplies the target chipload: lighter machines take thinner chips (§5.2.2). */
  readonly frameClassFactor: Readonly<Record<FrameClass, Sourced<number>>>;
  readonly toolTypes: readonly ToolTypeSpec[];
  readonly toolMaterials: Readonly<Record<ToolMaterial, ToolMaterialSpec>>;
}

export const DEFAULT_MODEL: ModelData = deepFreeze({
  frameClassFactor: {
    hobby: { value: 0.6, placeholder: true, note: SEED_PLACEHOLDER_NOTE },
    medium: { value: 0.8, placeholder: true, note: SEED_PLACEHOLDER_NOTE },
    rigid: { value: 1, placeholder: true, note: SEED_PLACEHOLDER_NOTE },
  },
  toolTypes: BUILTIN_TOOL_TYPES,
  toolMaterials: BUILTIN_TOOL_MATERIALS,
});

export const THRESHOLDS = Object.freeze({
  /** §5.2.4 rubbing floor: "chipload below about 30-40 % of target". */
  rubbingFloorFraction: 0.35,
  /** §5.2.4 deflection limits: about 0.02 mm finishing, 0.05 mm roughing. */
  deflectionFinishMm: 0.02,
  deflectionRoughMm: 0.05,
  /** Warn above this fraction of the spindle's rated power. */
  powerWarnFraction: 0.8,
  /** A programmed chipload more than this fraction above the aggressive level is too aggressive. */
  chiploadTolerance: 0.05,
});
