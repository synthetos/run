/** Inputs for the advisor tests. `cited*` values carry sources; the seed's are placeholders. */
import { BUILTIN_TOOL_MATERIALS, BUILTIN_TOOL_TYPES, builtinMaterial, type Material, type SourceCitation, type Tool } from '@synthetos/library';
import type { AdvisorContext, MachineCaps, ModelData } from '../src/index.ts';

export const SOURCE: SourceCitation = { kind: 'handbook', title: 'Test handbook', version: '1st ed.', locator: 'table 1' };

export function machine(overrides: Partial<MachineCaps> = {}): MachineCaps {
  return {
    frameClass: 'medium',
    spindle: { kind: 'vfd', minRpm: 6000, maxRpm: 24_000, powerKw: 1.5, sControlled: true },
    maxFeed: { xy: 5000, z: 1000 },
    motion: { accel: 1000, jerk: 20_000, junctionDeviation: 0.05 },
    ...overrides,
  };
}

export const MAKITA_DIAL = [
  { setting: '1', rpm: 10_000 },
  { setting: '2', rpm: 12_000 },
  { setting: '3', rpm: 17_000 },
  { setting: '4', rpm: 22_000 },
  { setting: '5', rpm: 27_000 },
  { setting: '6', rpm: 30_000 },
];

export function dialMachine(): MachineCaps {
  return machine({ frameClass: 'hobby', spindle: { kind: 'dial-router', minRpm: 10_000, maxRpm: 30_000, powerKw: 0.71, sControlled: false, dial: MAKITA_DIAL } });
}

export function tool(overrides: Partial<Record<keyof Tool, unknown>> = {}): Tool {
  return {
    id: 'tool-1',
    version: 1,
    name: '1/8 in 2-flute',
    type: 'flat',
    geometry: { diameter: 3.175, shank: 3.175, flutes: 2, fluteLength: 12, overallLength: 38, stickout: 18 },
    toolMaterial: 'carbide',
    coating: 'uncoated',
    description: '',
    notes: '',
    purchase: [],
    cuttingData: [],
    life: { minutes: 0, byMaterial: [] },
    tags: [],
    images: [],
    ...overrides,
  } as Tool;
}

/** A material whose every value is cited (no placeholder). */
export function citedMaterial(overrides: Partial<Record<keyof Material, unknown>> = {}): Material {
  return {
    id: 'mine.al',
    version: 1,
    name: 'Cited 6061',
    family: 'aluminium',
    grade: '6061-T6',
    physical: { density: { value: 2.7, source: SOURCE }, kc: { value: 800, source: SOURCE } },
    cutting: [
      {
        toolMaterial: 'carbide',
        vc: { value: { min: 100, max: 300 }, source: SOURCE },
        chipload: { value: { kind: 'factor', min: 0.004, max: 0.008 }, source: SOURCE },
        engagement: { value: { hobby: { ap: 0.25, ae: 0.25 }, medium: { ap: 0.5, ae: 0.5 }, rigid: { ap: 1, ae: 1 } }, source: SOURCE },
      },
    ],
    coolant: { need: 'required', reason: 'Aluminium welds to the flutes without air or mist.' },
    behaviour: [],
    safety: [],
    stockForms: [],
    purchase: [],
    description: '',
    notes: '',
    ...overrides,
  } as Material;
}

/** Model data whose every value is cited. */
export const CITED_MODEL: ModelData = {
  frameClassFactor: { hobby: { value: 0.6, source: SOURCE }, medium: { value: 0.8, source: SOURCE }, rigid: { value: 1, source: SOURCE } },
  toolTypes: BUILTIN_TOOL_TYPES.map((t) => ({ ...t, effectiveDiameterRatio: { value: t.effectiveDiameterRatio.value, source: SOURCE } })),
  toolMaterials: {
    carbide: { label: 'Carbide', youngsModulusGPa: { value: BUILTIN_TOOL_MATERIALS.carbide.youngsModulusGPa.value, source: SOURCE } },
    hss: { label: 'HSS', youngsModulusGPa: { value: 210, source: SOURCE } },
    cobalt: { label: 'Cobalt', youngsModulusGPa: { value: 215, source: SOURCE } },
  },
};

export function context(overrides: Partial<AdvisorContext> = {}): AdvisorContext {
  return {
    machine: machine(),
    tool: tool(),
    material: citedMaterial(),
    coolant: 'air',
    operation: { kind: 'pocket', ap: 1, ae: 1.2 },
    model: CITED_MODEL,
    ...overrides,
  };
}

export const AL_6061 = builtinMaterial('builtin.al-6061') as Material;
