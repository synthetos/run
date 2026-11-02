/**
 * Built-in seed data (MACHINING_ASSISTANT §1 principle 4, §3 "Built-in").
 *
 * A small set of materials, the tool types and the tool materials. Every
 * number here is a `Sourced` value. Which handbooks, manufacturer tables or
 * Synthetos measurements are cited is an open owner decision (§10.5), so
 * every number is flagged `placeholder: true` for now: they are typical
 * published magnitudes chosen to make the preview behave sensibly, not
 * advice. Replacing a placeholder with a cited value is a data change here,
 * reviewed like any other; `seed.test.ts` fails if any number in this module
 * is neither cited nor flagged.
 *
 * The built-in sheet and bar sizes (`stockForms`) are left empty: the stock
 * picker gets them from the store catalogue (§4) or from the user.
 */
import { deepFreeze } from './freeze.ts';
import type { PlaceholderValue, Sourced } from './sourced.ts';
import type { EngagementLimit, FrameClass, Material, MaterialCutting, ToolMaterial, ToolType } from './types.ts';

/** Why every seed number is a placeholder today. */
export const SEED_PLACEHOLDER_NOTE = 'Typical published magnitude, not yet cited: waiting on the owner decision on data sources (MACHINING_ASSISTANT §10.5).';

function ph<T>(value: T): PlaceholderValue<T> {
  return { value, placeholder: true, note: SEED_PLACEHOLDER_NOTE };
}

type Engagement = Readonly<Record<FrameClass, EngagementLimit>>;

function engagement(hobby: [number, number], medium: [number, number], rigid: [number, number]): Sourced<Engagement> {
  return ph({ hobby: { ap: hobby[0], ae: hobby[1] }, medium: { ap: medium[0], ae: medium[1] }, rigid: { ap: rigid[0], ae: rigid[1] } });
}

function cutting(toolMaterial: ToolMaterial, vc: [number, number], factor: [number, number], limits: Sourced<Engagement>): MaterialCutting {
  return {
    toolMaterial,
    vc: ph({ min: vc[0], max: vc[1] }),
    chipload: ph({ kind: 'factor', min: factor[0], max: factor[1] }),
    engagement: limits,
  };
}

type MaterialSeed = Omit<Material, 'version' | 'stockForms' | 'purchase' | 'description' | 'notes'>;

function material(seed: MaterialSeed): Material {
  return { ...seed, version: 1, stockForms: [], purchase: [], description: '', notes: '' };
}

const PLASTIC_LIMITS = engagement([0.5, 0.5], [1, 1], [1.5, 1]);
const WOOD_LIMITS = engagement([0.5, 0.4], [1, 0.75], [1.5, 1]);

export const BUILTIN_MATERIALS: readonly Material[] = deepFreeze([
  material({
    id: 'builtin.al-6061',
    name: 'Aluminium 6061-T6',
    family: 'aluminium',
    grade: '6061-T6',
    physical: { hardness: ph({ value: 95, scale: 'HB' }), density: ph(2.7), kc: ph(800) },
    cutting: [
      cutting('carbide', [120, 300], [0.004, 0.008], engagement([0.25, 0.25], [0.5, 0.5], [1, 1])),
      cutting('hss', [60, 120], [0.003, 0.006], engagement([0.2, 0.2], [0.4, 0.4], [0.8, 0.8])),
    ],
    coolant: { need: 'required', reason: 'Aluminium welds to the flutes without air or mist.' },
    behaviour: [{ kind: 'chip-evacuation', text: 'Clear the chips: recut chips weld to the flutes and break small tools.' }],
    safety: [{ severity: 'caution', text: 'Hot, sharp chips: wear eye protection.' }],
  }),
  material({
    id: 'builtin.acrylic-cast',
    name: 'Acrylic (cast)',
    family: 'plastic',
    grade: 'Cast PMMA',
    physical: { density: ph(1.19), kc: ph(100) },
    cutting: [cutting('carbide', [100, 400], [0.01, 0.025], PLASTIC_LIMITS)],
    coolant: { need: 'recommended', reason: 'Air clears the chips so they are not recut and melted.' },
    behaviour: [{ kind: 'melts', text: 'Melts if the chips are thin or the tool dwells: keep the chips thick and keep moving.' }],
    safety: [{ severity: 'caution', text: 'Molten acrylic gives off irritating fumes: keep the chips thick and use extraction.' }],
  }),
  material({
    id: 'builtin.hdpe',
    name: 'HDPE',
    family: 'plastic',
    grade: 'HDPE',
    physical: { density: ph(0.95), kc: ph(60) },
    cutting: [cutting('carbide', [100, 500], [0.012, 0.03], engagement([0.5, 0.5], [1, 1], [2, 1]))],
    coolant: { need: 'recommended', reason: 'Air clears the stringy chips.' },
    behaviour: [{ kind: 'melts', text: 'Soft and stringy: thin chips wrap the tool and melt.' }],
    safety: [],
  }),
  material({
    id: 'builtin.pom',
    name: 'POM (Delrin)',
    family: 'plastic',
    grade: 'POM-C / POM-H',
    physical: { density: ph(1.41), kc: ph(120) },
    cutting: [cutting('carbide', [100, 500], [0.01, 0.025], PLASTIC_LIMITS)],
    coolant: { need: 'none', reason: 'Machines cleanly dry.' },
    behaviour: [],
    safety: [{ severity: 'caution', text: 'Overheated POM releases formaldehyde: keep the chips thick and avoid rubbing.' }],
  }),
  material({
    id: 'builtin.mdf',
    name: 'MDF',
    family: 'wood',
    grade: 'MDF',
    physical: { density: ph(0.75), kc: ph(40) },
    cutting: [cutting('carbide', [150, 700], [0.01, 0.03], engagement([0.5, 0.5], [1, 1], [2, 1]))],
    coolant: { need: 'avoid', reason: 'Mist or flood swells MDF; use dust extraction (an air blast is fine).' },
    behaviour: [],
    safety: [{ severity: 'hazard', text: 'MDF dust is hazardous: use dust extraction and a respirator.' }],
  }),
  material({
    id: 'builtin.hardwood',
    name: 'Hardwood (oak, maple)',
    family: 'wood',
    grade: 'Hardwood',
    physical: { hardness: ph({ value: 5700, scale: 'janka-N' }), density: ph(0.7), kc: ph(50) },
    cutting: [
      cutting('carbide', [150, 600], [0.008, 0.025], WOOD_LIMITS),
      cutting('hss', [80, 300], [0.006, 0.02], engagement([0.3, 0.3], [0.6, 0.6], [1, 1])),
    ],
    coolant: { need: 'none', reason: 'Cut dry with dust extraction.' },
    behaviour: [{ kind: 'grain-direction', text: 'Cuts across the grain tear out: leave a light finishing pass.' }],
    safety: [{ severity: 'hazard', text: 'Hardwood dust is hazardous: use dust extraction and a respirator.' }],
  }),
  material({
    id: 'builtin.plywood',
    name: 'Plywood',
    family: 'wood',
    grade: 'Birch plywood',
    physical: { density: ph(0.68), kc: ph(45) },
    cutting: [cutting('carbide', [150, 600], [0.008, 0.025], WOOD_LIMITS)],
    coolant: { need: 'none', reason: 'Cut dry with dust extraction.' },
    behaviour: [{ kind: 'grain-direction', text: 'The face ply tears out: a compression or down-cut tool keeps the top face clean.' }],
    safety: [{ severity: 'hazard', text: 'Wood and glue dust is hazardous: use dust extraction and a respirator.' }],
  }),
  material({
    id: 'builtin.pvc',
    name: 'PVC',
    family: 'plastic',
    grade: 'PVC',
    physical: { density: ph(1.38) },
    cutting: [],
    coolant: { need: 'none', reason: '' },
    behaviour: [],
    safety: [{ severity: 'do-not-machine', text: 'Do not machine PVC: it releases corrosive, toxic gas that harms you and the machine.' }],
  }),
  material({
    id: 'builtin.g10-fr4',
    name: 'G10 / FR4',
    family: 'composite',
    grade: 'Glass-epoxy laminate',
    physical: { density: ph(1.85), kc: ph(150) },
    cutting: [cutting('carbide', [100, 300], [0.005, 0.015], engagement([0.5, 0.5], [1, 1], [1, 1]))],
    coolant: { need: 'recommended', reason: 'A wet cut or extraction at the tool keeps the glass dust down.' },
    behaviour: [{ kind: 'chip-evacuation', text: 'The glass dust is abrasive: uncoated tools wear fast.' }],
    safety: [{ severity: 'hazard', text: 'Carbon fibre, G10 and FR4 dust is hazardous: use extraction and a respirator.' }],
  }),
]);

/** A built-in material by id, or undefined. */
export function builtinMaterial(id: string): Material | undefined {
  return BUILTIN_MATERIALS.find((m) => m.id === id);
}

/** What the library and the advisor know about a tool type. */
export interface ToolTypeSpec {
  readonly type: ToolType;
  readonly label: string;
  /**
   * The diameter of a solid round bar as stiff as the fluted body, as a
   * fraction of the cutting diameter: the "effective diameter" of the
   * deflection check (§5.2.4).
   */
  readonly effectiveDiameterRatio: Sourced<number>;
}

export const BUILTIN_TOOL_TYPES: readonly ToolTypeSpec[] = deepFreeze([
  { type: 'flat', label: 'Flat end mill', effectiveDiameterRatio: ph(0.8) },
  { type: 'ball', label: 'Ball end mill', effectiveDiameterRatio: ph(0.8) },
  { type: 'bull-nose', label: 'Bull-nose end mill', effectiveDiameterRatio: ph(0.8) },
  { type: 'v-bit', label: 'V-bit', effectiveDiameterRatio: ph(0.8) },
  { type: 'chamfer', label: 'Chamfer mill', effectiveDiameterRatio: ph(0.8) },
  { type: 'drill', label: 'Drill', effectiveDiameterRatio: ph(0.75) },
  { type: 'engraver', label: 'Engraver', effectiveDiameterRatio: ph(0.8) },
  { type: 'o-flute', label: 'O-flute (single flute, plastics)', effectiveDiameterRatio: ph(0.7) },
  { type: 'surfacing', label: 'Surfacing bit', effectiveDiameterRatio: ph(0.85) },
  { type: 'thread-mill', label: 'Thread mill', effectiveDiameterRatio: ph(0.75) },
] satisfies ToolTypeSpec[]);

/** The spec of a tool type (every `ToolType` has one). */
export function toolTypeSpec(type: ToolType): ToolTypeSpec {
  return BUILTIN_TOOL_TYPES.find((t) => t.type === type) as ToolTypeSpec;
}

export interface ToolMaterialSpec {
  readonly label: string;
  /** Young's modulus, GPa: the stiffness in the deflection check. */
  readonly youngsModulusGPa: Sourced<number>;
}

export const BUILTIN_TOOL_MATERIALS: Readonly<Record<ToolMaterial, ToolMaterialSpec>> = deepFreeze({
  carbide: { label: 'Solid carbide', youngsModulusGPa: ph(600) },
  hss: { label: 'High-speed steel', youngsModulusGPa: ph(210) },
  cobalt: { label: 'Cobalt HSS', youngsModulusGPa: ph(215) },
});
