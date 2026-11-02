/**
 * The library adapter: tools, materials, machine profiles and the setup,
 * on `@synthetos/library` records (MACHINING_ASSISTANT §2, §3, §8). Views
 * import from here, never from storage or the seed directly.
 *
 * - Materials are the package's built-ins (every number a flagged
 *   placeholder) plus my own forks, kept as `LibraryFork` edits and resolved
 *   over their parent version.
 * - Tools are `Tool` records; every edit goes through `reviseRecord`, so a
 *   change the schema refuses is never stored.
 * - Purchase and datasheet links render only through `safeExternalLink`.
 * - Stock and fixture are the package's `Stock` and `Fixture`.
 *
 * Records persist through workspace/storage.ts (localStorage today, account
 * sync later).
 */
import { computed } from '@preact/signals';
import {
  BUILTIN_MATERIALS,
  builtinMaterial,
  editFork,
  forkRecord,
  readFixture,
  readFork,
  readStock,
  readTool,
  resolveFork,
  reviseRecord,
  safeExternalLink,
  type Fixture,
  type LibraryFork,
  type Material,
  type MaterialFamily,
  type PurchaseLink,
  type Stock,
  type Tool,
} from '@synthetos/library';
import { SEED_TOOLS, type SeedTool } from './librarySeed.ts';
import { isArray, isObject, stored } from './storage.ts';

export { safeExternalLink };
export type { Fixture, Material, PurchaseLink, Stock, Tool };

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export const FAMILIES: Readonly<Record<MaterialFamily, string>> = {
  aluminium: 'Aluminium',
  'brass-copper': 'Brass and copper',
  steel: 'Steel',
  plastic: 'Plastics',
  wood: 'Wood',
  composite: 'Composites',
  foam: 'Foam',
  pcb: 'PCB',
};

/** A swatch colour per family, for the material list and the setup drawing (illustration only). */
export const FAMILY_COLOR: Readonly<Record<MaterialFamily, readonly [number, number, number]>> = {
  aluminium: [196, 205, 212],
  'brass-copper': [205, 172, 92],
  steel: [150, 158, 166],
  plastic: [200, 220, 230],
  wood: [214, 184, 140],
  composite: [150, 160, 110],
  foam: [214, 196, 160],
  pcb: [196, 140, 82],
};

export const TOOL_KINDS: Readonly<Record<string, string>> = {
  flat: 'End mill',
  ball: 'Ball nose',
  'bull-nose': 'Bull nose',
  'v-bit': 'V-bit',
  chamfer: 'Chamfer',
  drill: 'Drill',
  engraver: 'Engraver',
  'o-flute': 'O-flute',
  surfacing: 'Surfacing',
  'thread-mill': 'Thread mill',
};

export const SOURCE_LABELS: Readonly<Record<string, string>> = { manufacturer: 'Manufacturer', synthetos: 'Synthetos', user: 'Mine', ai: 'AI' };

export const NOT_OFFERED = 'Magnesium is not offered: its fine chips catch fire and burn too hot for water to put out.';

/** True when a material carries a do-not-machine note: no cutting data, and the advisor refuses it. */
export function doNotMachine(m: Material): boolean {
  return m.safety.some((s) => s.severity === 'do-not-machine');
}

// ---------------------------------------------------------------- types kept locally

export interface MachineProfile {
  readonly id: string;
  readonly name: string;
  readonly templateId: string;
  readonly drive: 'belt' | 'screw' | 'rack' | 'any';
  readonly travel: { readonly x: number; readonly y: number; readonly z: number };
  readonly spindle: string;
  readonly createdAt: string;
}

export interface SetupState {
  readonly bed: { readonly width: number; readonly depth: number; readonly thickness: number };
  readonly stock: Stock;
  readonly fixture: Fixture | null;
  readonly clamps: boolean;
}

export type ToolEntry = SeedTool;

// ---------------------------------------------------------------- stores

const isToolList = (v: unknown): v is ToolEntry[] => isArray(v) && v.every((t) => isObject(t) && typeof t['number'] === 'number' && readTool(t['tool']).ok);
const isForks = (v: unknown): v is LibraryFork[] => isArray(v) && v.every((f) => readFork(f).ok);
const isMachines = (v: unknown): v is MachineProfile[] => isArray(v) && v.every((m) => isObject(m) && typeof m['id'] === 'string' && typeof m['name'] === 'string' && isObject(m['travel']));
const isSelected = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isSetup = (v: unknown): v is SetupState =>
  isObject(v) && isObject(v['bed']) && readStock(v['stock']).ok && (v['fixture'] === null || readFixture(v['fixture']).ok) && typeof v['clamps'] === 'boolean';

export const toolStore = stored<readonly ToolEntry[]>('tools.v2', SEED_TOOLS, isToolList);
export const myMaterialStore = stored<readonly LibraryFork[]>('materials.v2', [], isForks);
export const machineStore = stored<readonly MachineProfile[]>('machines', [], isMachines);
export const selectedMachineStore = stored<string | null>('machine-selected', null, isSelected);

/** The sample fixture plate: a rounded 300 × 200 mm plate with a grid of holes (the study's sample). */
export function sampleFixture(width = 300, depth = 200): Fixture {
  const r = 12;
  const outline: [number, number][] = [];
  const corner = (cx: number, cy: number, a0: number): void => {
    for (let k = 0; k <= 6; k++) {
      const a = a0 + (k / 6) * (Math.PI / 2);
      outline.push([Math.round((cx + r * Math.cos(a)) * 1000) / 1000, Math.round((cy + r * Math.sin(a)) * 1000) / 1000]);
    }
  };
  corner(width - r, r, -Math.PI / 2);
  corner(width - r, depth - r, 0);
  corner(r, depth - r, Math.PI / 2);
  corner(r, r, Math.PI);
  const holes: [number, number, number][] = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) holes.push([25 + i * 50, 25 + j * 50, 3.25]);
  return { id: 'sample.fixture-plate', name: 'Fixture plate (sample)', source: { file: 'sample-fixture-plate.svg', kind: 'svg', hash: 'sample' }, outline, holes, height: 12, position: { x: 160, y: 120 }, material: 'Aluminium' };
}

const AL = BUILTIN_MATERIALS[0] as Material;

export const SEED_SETUP: SetupState = {
  bed: { width: 790, depth: 790, thickness: 19 },
  stock: { shape: 'block', width: 180, depth: 120, diameter: 150, thickness: 6.35, materialRef: { id: AL.id, version: AL.version }, position: { x: 160, y: 120 }, zero: { corner: 'front-left', height: 'top' } },
  fixture: sampleFixture(),
  clamps: true,
};
export const setupStore = stored<SetupState>('setup.v2', SEED_SETUP, isSetup);

// ---------------------------------------------------------------- materials

export interface MaterialView {
  readonly material: Material;
  readonly source: 'builtin' | 'mine';
  /** For one of mine: the fork record. */
  readonly fork?: LibraryFork;
}

function resolved(fork: LibraryFork): MaterialView | null {
  const parent = builtinMaterial(fork.forkOf.id);
  if (parent === undefined || fork.kind !== 'material') return null;
  const r = resolveFork(fork as LibraryFork & { readonly kind: 'material' }, parent);
  return r.ok ? { material: r.value, source: 'mine', fork } : null;
}

export const allMaterials = computed<readonly MaterialView[]>(() => [
  ...BUILTIN_MATERIALS.map((material) => ({ material, source: 'builtin' as const })),
  ...myMaterialStore.value.value.map(resolved).filter((m): m is MaterialView => m !== null),
]);

export function materialView(id: string): MaterialView | null {
  return allMaterials.value.find((m) => m.material.id === id) ?? null;
}

export function material(id: string): Material | null {
  return materialView(id)?.material ?? null;
}

export function materialColor(id: string): readonly number[] {
  const m = material(id);
  return m === null ? FAMILY_COLOR.aluminium : FAMILY_COLOR[m.family];
}

/** Makes my own copy of a built-in material: a fork that inherits every value until one is changed. */
export function forkMaterial(id: string): string | null {
  const base = builtinMaterial(id);
  if (base === undefined || doNotMachine(base)) return null;
  const list = myMaterialStore.value.value;
  const forkId = `mine.${base.id.replace(/^builtin\./, '')}-${Date.now().toString(36)}`.slice(0, 64);
  const fork = forkRecord('material', base, forkId);
  if (!fork.ok) return null;
  const named = editFork(fork.value as LibraryFork & { readonly kind: 'material' }, base, 'name', `My ${base.name}`);
  myMaterialStore.set([...list, named.ok ? named.value : fork.value]);
  return forkId;
}

/** Edits one field of one of my materials. Returns why the edit was refused, or null. */
export function editMyMaterial(id: string, path: 'name' | 'notes' | 'purchase', value: unknown): string | null {
  const list = myMaterialStore.value.value;
  const fork = list.find((f) => f.id === id);
  const parent = fork === undefined ? undefined : builtinMaterial(fork.forkOf.id);
  if (fork === undefined || parent === undefined) return 'This material is not one of yours.';
  const next = editFork(fork as LibraryFork & { readonly kind: 'material' }, parent, path, value);
  if (!next.ok) return next.issues[0]?.message ?? 'The change was refused.';
  myMaterialStore.set(list.map((f) => (f.id === id ? next.value : f)));
  return null;
}

// ---------------------------------------------------------------- tools

/** Revises a tool (a new version, checked by the schema). Returns why it was refused, or null. */
export function updateTool(id: string, patch: Readonly<Record<string, unknown>>): string | null {
  const list = toolStore.value.value;
  const entry = list.find((t) => t.tool.id === id);
  if (entry === undefined) return 'No such tool.';
  const next = reviseRecord('tool', entry.tool, patch);
  if (!next.ok) return next.issues[0]?.message ?? 'The change was refused.';
  toolStore.set(list.map((t) => (t.tool.id === id ? { ...t, tool: next.value } : t)));
  return null;
}

export function addTool(): string {
  const list = toolStore.value.value;
  const number = Math.max(0, ...list.map((t) => t.number)) + 1;
  const tool: Tool = {
    id: `mine.t${number}-${Date.now().toString(36)}`,
    version: 1,
    name: `New tool ${number}`,
    type: 'flat',
    geometry: { diameter: 3.175, shank: 3.175, flutes: 2, fluteLength: 12, overallLength: 38 },
    toolMaterial: 'carbide',
    coating: 'uncoated',
    description: '',
    notes: '',
    purchase: [],
    cuttingData: [],
    life: { minutes: 0, byMaterial: [] },
    tags: [],
    images: [],
  };
  toolStore.set([...list, { number, store: null, tool }]);
  return tool.id;
}

export function money(n: number | undefined, currency = 'USD'): string {
  return n === undefined ? '—' : `${currency === 'USD' ? '$' : `${currency} `}${n.toFixed(2)}`;
}

// ---------------------------------------------------------------- machines

/** The selected machine profile, or null. */
export const selectedMachine = computed<MachineProfile | null>(() => {
  const id = selectedMachineStore.value.value;
  return machineStore.value.value.find((m) => m.id === id) ?? null;
});
