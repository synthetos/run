/**
 * The library adapter: the minimal local types and records for tools,
 * materials, machine profiles and the setup (bed, stock, fixture), behind one
 * module so that swapping in `packages/library` (branch library-advisor,
 * MACHINING_ASSISTANT §2/§3) is a change to this file only. Views import
 * from here, never from storage or the seed directly.
 *
 * Records persist through workspace/storage.ts (localStorage today, cloud
 * sync later). Every seeded number is a placeholder and is labelled so.
 */
import { computed } from '@preact/signals';
import { FAMILIES, NOT_OFFERED, SEED_MATERIALS, SEED_MY_MATERIALS, SEED_TOOLS, SOURCE_LABELS, TOOL_KINDS } from './librarySeed.ts';
import { isArray, isObject, stored } from './storage.ts';

export { FAMILIES, NOT_OFFERED, SOURCE_LABELS, TOOL_KINDS };

// ---------------------------------------------------------------- URLs (§8)

/**
 * A purchase or datasheet link people typed: http(s) only, no credentials.
 * Returns the normalised URL or null. Rendered only as a plain external link
 * (new tab, `rel="noopener noreferrer nofollow"`), never fetched.
 */
export function safeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username !== '' || u.password !== '') return null;
    return u.href;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- types

export interface Purchase {
  readonly kind: 'store' | 'link';
  readonly vendor: string;
  /** Only ever a link a person entered, checked by `safeUrl`. The seed has none. */
  readonly url?: string;
  readonly sku?: string;
  readonly price?: number;
  readonly currency?: string;
  readonly boughtAt?: string;
}

export interface SafetyNote {
  readonly level: 'warn' | 'danger';
  readonly text: string;
}

export interface CuttingRow {
  readonly toolMaterial: string;
  readonly vc: readonly [number, number];
  readonly fz: readonly (readonly [number, number])[];
  readonly ap: Readonly<Record<string, number>>;
  readonly ae: Readonly<Record<string, number>>;
}

export interface MaterialRecord {
  readonly id: string;
  readonly version: number;
  readonly source: 'builtin';
  readonly name: string;
  readonly family: string;
  readonly grade: string;
  readonly color: readonly [number, number, number] | readonly number[];
  readonly cutting: readonly CuttingRow[];
  readonly coolant: { readonly need: string; readonly reason: string };
  readonly behaviour: readonly string[];
  readonly safety: readonly SafetyNote[];
  readonly description: string;
  readonly doNotMachine: boolean;
  readonly stockForms: readonly { readonly kind: string; readonly label: string; readonly sizes: readonly number[] }[];
  readonly physical: Readonly<Record<string, string | number>>;
}

export interface MyMaterialRecord {
  readonly id: string;
  readonly source: 'mine';
  readonly forkOf: { readonly id: string; readonly version: number };
  readonly overrides: { readonly name?: string; readonly grade?: string; readonly notes?: string; readonly purchase?: readonly Purchase[]; readonly [key: string]: unknown };
}

/** A material as the views show it: a built-in, or one of mine resolved over its built-in. */
export interface Material extends Omit<MaterialRecord, 'source'> {
  readonly source: 'builtin' | 'mine';
  readonly forkOf?: { readonly id: string; readonly version: number };
  readonly notes: string;
  readonly purchase: readonly Purchase[];
}

export interface ToolCuttingData {
  readonly materialRef: string;
  readonly vc: number;
  readonly fz: number;
  readonly ap: number;
  readonly ae: number;
  readonly coolant: string;
  readonly source: string;
  readonly note: string;
}

export interface ToolRecord {
  readonly id: string;
  readonly number: number;
  readonly type: string;
  readonly name: string;
  readonly diameter: number;
  readonly flutes: number;
  readonly fluteLength: number;
  readonly overall: number;
  readonly shank: number;
  readonly stickout: number;
  readonly angle?: number;
  readonly maxRpm: number;
  readonly material: string;
  readonly coating: string;
  readonly manufacturer: string;
  readonly partNumber: string;
  readonly description: string;
  readonly notes: string;
  readonly cuttingData: readonly ToolCuttingData[];
  readonly life: { readonly minutes: Readonly<Record<string, number>>; readonly expected: Readonly<Record<string, number>> };
  readonly purchase: readonly Purchase[];
}

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
  readonly stock: { readonly shape: 'block' | 'round' | 'sheet'; readonly width: number; readonly depth: number; readonly diameter: number; readonly thickness: number; readonly materialId: string; readonly x: number; readonly y: number; readonly zero: string; readonly zeroHeight: 'top' | 'bottom' };
  readonly fixture: {
    readonly name: string;
    readonly file: string | null;
    readonly kind: 'dxf' | 'svg' | 'sample';
    readonly outline: readonly (readonly [number, number])[];
    readonly holes: readonly (readonly [number, number, number])[];
    readonly height: number;
    readonly x: number;
    readonly y: number;
  } | null;
  readonly clamps: boolean;
}

// ---------------------------------------------------------------- stores

const isToolList = (v: unknown): v is ToolRecord[] => isArray(v) && v.every((t) => isObject(t) && typeof t['id'] === 'string' && typeof t['diameter'] === 'number' && isArray(t['purchase']));
const isMyMaterials = (v: unknown): v is MyMaterialRecord[] => isArray(v) && v.every((m) => isObject(m) && typeof m['id'] === 'string' && isObject(m['forkOf']) && isObject(m['overrides']));
const isMachines = (v: unknown): v is MachineProfile[] => isArray(v) && v.every((m) => isObject(m) && typeof m['id'] === 'string' && typeof m['name'] === 'string' && isObject(m['travel']));
const isSelected = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isSetup = (v: unknown): v is SetupState => isObject(v) && isObject(v['bed']) && isObject(v['stock']);

export const toolStore = stored<readonly ToolRecord[]>('tools', SEED_TOOLS, isToolList);
export const myMaterialStore = stored<readonly MyMaterialRecord[]>('materials', SEED_MY_MATERIALS, isMyMaterials);
export const machineStore = stored<readonly MachineProfile[]>('machines', [], isMachines);
export const selectedMachineStore = stored<string | null>('machine-selected', null, isSelected);

/** The sample fixture plate: a rounded 300 × 200 mm plate with a grid of holes (the study's sample). */
export function sampleFixture(width = 300, depth = 200): NonNullable<SetupState['fixture']> {
  const r = 12;
  const outline: [number, number][] = [];
  const corner = (cx: number, cy: number, a0: number): void => {
    for (let k = 0; k <= 6; k++) {
      const a = a0 + (k / 6) * (Math.PI / 2);
      outline.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  corner(width - r, r, -Math.PI / 2);
  corner(width - r, depth - r, 0);
  corner(r, depth - r, Math.PI / 2);
  corner(r, r, Math.PI);
  const holes: [number, number, number][] = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) holes.push([25 + i * 50, 25 + j * 50, 3.25]);
  return { name: 'Fixture plate (sample)', file: null, kind: 'sample', outline, holes, height: 12, x: 160, y: 120 };
}

export const SEED_SETUP: SetupState = {
  bed: { width: 790, depth: 790, thickness: 19 },
  stock: { shape: 'block', width: 180, depth: 120, diameter: 150, thickness: 6.35, materialId: 'al6061', x: 160, y: 120, zero: 'front-left', zeroHeight: 'top' },
  fixture: sampleFixture(),
  clamps: true,
};
export const setupStore = stored<SetupState>('setup', SEED_SETUP, isSetup);

// ---------------------------------------------------------------- resolvers

const builtinById = new Map(SEED_MATERIALS.map((m) => [m.id, m]));

export function builtinMaterials(): readonly MaterialRecord[] {
  return SEED_MATERIALS;
}

export function material(id: string): Material | null {
  const b = builtinById.get(id);
  if (b !== undefined) return { ...b, notes: '', purchase: [] };
  const mine = myMaterialStore.value.value.find((m) => m.id === id);
  if (mine === undefined) return null;
  const base = builtinById.get(mine.forkOf.id);
  if (base === undefined) return null;
  const o = mine.overrides;
  return {
    ...base,
    id: mine.id,
    source: 'mine',
    forkOf: mine.forkOf,
    name: typeof o.name === 'string' ? o.name : base.name,
    grade: typeof o.grade === 'string' ? o.grade : base.grade,
    notes: typeof o.notes === 'string' ? o.notes : '',
    purchase: o.purchase ?? [],
  };
}

export const allMaterials = computed<readonly Material[]>(() => [
  ...SEED_MATERIALS.map((m) => ({ ...m, notes: '', purchase: [] }) as Material),
  ...myMaterialStore.value.value.map((m) => material(m.id)).filter((m): m is Material => m !== null),
]);

/** Makes my own copy of a built-in material; it inherits every value until one is changed. */
export function forkMaterial(id: string): string | null {
  const base = builtinById.get(id);
  if (base === undefined || base.doNotMachine) return null;
  const list = myMaterialStore.value.value;
  const n = list.filter((m) => m.forkOf.id === id).length + 1;
  const record: MyMaterialRecord = { id: `my-${id}-${n}-${list.length + 1}`, source: 'mine', forkOf: { id, version: base.version }, overrides: { name: `My ${base.name.charAt(0).toLowerCase()}${base.name.slice(1)}` } };
  myMaterialStore.set([...list, record]);
  return record.id;
}

export function updateMyMaterial(id: string, overrides: Partial<MyMaterialRecord['overrides']>): void {
  myMaterialStore.set(myMaterialStore.value.value.map((m) => (m.id === id ? { ...m, overrides: { ...m.overrides, ...overrides } } : m)));
}

export function updateTool(id: string, patch: Partial<ToolRecord>): void {
  toolStore.set(toolStore.value.value.map((t) => (t.id === id ? { ...t, ...patch } : t)));
}

export function addTool(): string {
  const list = toolStore.value.value;
  const number = Math.max(0, ...list.map((t) => t.number)) + 1;
  const tool: ToolRecord = {
    id: `T${number}-${Date.now().toString(36)}`,
    number,
    type: 'flat',
    name: `New tool ${number}`,
    diameter: 3.175,
    flutes: 2,
    fluteLength: 12,
    overall: 38,
    shank: 3.175,
    stickout: 20,
    maxRpm: 24000,
    material: 'Carbide',
    coating: 'Uncoated',
    manufacturer: '',
    partNumber: '',
    description: '',
    notes: '',
    cuttingData: [],
    life: { minutes: {}, expected: {} },
    purchase: [],
  };
  toolStore.set([...list, tool]);
  return tool.id;
}

/** The share of expected life used, summed across materials (the study's tool wear). */
export function toolWear(tool: ToolRecord): { readonly used: number; readonly minutes: number; readonly dull: boolean } {
  const m = tool.life.minutes;
  const e = tool.life.expected;
  let used = 0;
  let minutes = 0;
  for (const [mat, min] of Object.entries(m)) {
    minutes += min;
    const exp = e[mat];
    if (exp !== undefined && exp > 0) used += min / exp;
  }
  return { used, minutes, dull: used >= 0.9 };
}

export function money(n: number | undefined, currency = 'USD'): string {
  return n === undefined ? '—' : `${currency === 'USD' ? '$' : `${currency} `}${n.toFixed(2)}`;
}

/** The selected machine profile, or null. */
export const selectedMachine = computed<MachineProfile | null>(() => {
  const id = selectedMachineStore.value.value;
  return machineStore.value.value.find((m) => m.id === id) ?? null;
});
