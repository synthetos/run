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
  readFork,
  readMaterial,
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

/** One axis of a machine profile, in the profile's own words; each field maps to one TinyG key (Machines view). */
export interface AxisProfile {
  readonly stepAngle?: number;
  readonly microsteps?: number;
  readonly travelPerRev?: number;
  readonly maxVelocity?: number;
  readonly maxFeed?: number;
  readonly jerk?: number;
  readonly homingSearch?: number;
  readonly homingLatch?: number;
  readonly latchBackoff?: number;
  readonly zeroBackoff?: number;
  readonly minSwitch?: number;
  readonly maxSwitch?: number;
}

/**
 * Where a bed's dimensions came from (FLOW_ANALYSIS §5.7): a placeholder until someone measures the bed
 * or imports a drawing of it. Unverified dimensions are shown as Placeholder and never count as a fit check.
 */
export type BedSource =
  | { readonly kind: 'placeholder'; readonly note: string }
  | { readonly kind: 'measured'; readonly note: string; readonly at: string }
  | { readonly kind: 'drawing'; readonly file: string; readonly hash: string; readonly units: 'mm' | 'in'; readonly scale: number; readonly at: string };

/**
 * A machine's bed (spoilboard), one revision at a time. Bed-local coordinates put the front-left corner of
 * the bed's top face at (0, 0, 0), X right, Y back, Z up (the Setup view's own frame, kept). `toMachine` is
 * the bed-to-machine transform: the machine coordinates of that corner, so machine = bed-local + toMachine.
 */
export interface MachineBed {
  readonly revision: number;
  readonly width: number;
  readonly depth: number;
  readonly thickness: number;
  /** The bed's outline in bed-local XY when it came from a drawing; null for the plain rectangle. */
  readonly outline: readonly (readonly [number, number])[] | null;
  /** Holes in the bed (`[x, y, r]`, bed-local), from a drawing. */
  readonly holes: readonly (readonly [number, number, number])[];
  readonly toMachine: { readonly x: number; readonly y: number; readonly z: number };
  readonly source: BedSource;
  readonly savedAt: string;
}

/** Where the machine's home position sits relative to its bed, as the profile describes it (not measured). */
export type HomeFrame = 'front-left-top' | 'back-left-top' | 'front-right-top' | 'back-right-top';

export interface MachineProfile {
  readonly axes?: Readonly<Partial<Record<'x' | 'y' | 'z' | 'a', AxisProfile>>>;
  /** Switch type for every input (TinyG `st`): 0 normally open, 1 normally closed. */
  readonly switchType?: number;
  readonly id: string;
  readonly name: string;
  readonly templateId: string;
  readonly drive: 'belt' | 'screw' | 'rack' | 'any';
  readonly travel: { readonly x: number; readonly y: number; readonly z: number };
  readonly spindle: string;
  readonly createdAt: string;
  /** Bumped on every change to the profile; absent on records from before revisions (read as 1). */
  readonly revision?: number;
  /** The machine's bed; absent means the placeholder bed derived from its travel (`bedOf`). */
  readonly bed?: MachineBed;
  readonly homeFrame?: HomeFrame;
}

/** The setup as the Setup view kept it before jobs (storage `setup.v2`); read once, to migrate it into the draft job. */
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
/**
 * The old setup record, read leniently: the fixture's source hash never matched the library schema (the
 * sample's was "sample", a picked file's FNV-1a), so a strict read lost every stored fixture. The job
 * migration (jobModel.ts) repairs the hash; here the fixture only has to look like one.
 */
const looksLikeFixture = (v: unknown): v is Fixture => isObject(v) && typeof v['name'] === 'string' && isArray(v['outline']) && isArray(v['holes']) && typeof v['height'] === 'number' && isObject(v['position']) && isObject(v['source']);
const isSetup = (v: unknown): v is SetupState =>
  isObject(v) && isObject(v['bed']) && readStock(v['stock']).ok && (v['fixture'] === null || looksLikeFixture(v['fixture'])) && typeof v['clamps'] === 'boolean';

export const toolStore = stored<readonly ToolEntry[]>('tools.v2', SEED_TOOLS, isToolList);
export const myMaterialStore = stored<readonly LibraryFork[]>('materials.v2', [], isForks);
const isOwnMaterials = (v: unknown): v is Material[] => isArray(v) && v.every((m) => readMaterial(m).ok);
/** Materials I created from scratch (full records, versioned with `reviseRecord`). */
export const ownMaterialStore = stored<readonly Material[]>('materials.own.v1', [], isOwnMaterials);
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
  return { id: 'sample.fixture-plate', name: 'Fixture plate (sample)', source: { file: 'sample-fixture-plate.svg', kind: 'svg', hash: SAMPLE_HASH }, outline, holes, height: 12, position: { x: 160, y: 120 }, material: 'Aluminium' };
}

/** The fixture schema wants a SHA-256; a built-in or unverified source carries this all-zero one and says so. */
export const SAMPLE_HASH = '0'.repeat(64);

const AL = BUILTIN_MATERIALS[0] as Material;

export const SEED_SETUP: SetupState = {
  bed: { width: 790, depth: 790, thickness: 19 },
  stock: { shape: 'block', width: 180, depth: 120, thickness: 6.35, materialRef: { id: AL.id, version: AL.version }, position: { x: 160, y: 120 }, zero: { corner: 'front-left', height: 'top' } },
  fixture: sampleFixture(),
  clamps: true,
};
/**
 * The pre-job setup record (`setup.v2`). Kept for the migration into the draft job only (jobModel.ts): it is
 * never written again and never deleted, so the original stays until the draft has been persisted.
 */
export const legacySetupStore = stored<SetupState>('setup.v2', SEED_SETUP, isSetup);

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
  ...ownMaterialStore.value.value.map((material) => ({ material, source: 'mine' as const })),
]);

/** How many materials are mine (copies and my own). */
export const myMaterialCount = computed(() => allMaterials.value.filter((m) => m.source === 'mine').length);

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

/** The fields of a material the create/edit form writes (everything but id, version and forkOf). */
export type MaterialFields = Omit<Material, 'id' | 'version' | 'forkOf'>;

const EDIT_FIELDS: readonly (keyof MaterialFields)[] = ['name', 'family', 'grade', 'physical', 'cutting', 'coolant', 'behaviour', 'safety', 'stockForms', 'purchase', 'description', 'notes'];

function firstIssue(r: { readonly ok: false; readonly issues: readonly { readonly path: string; readonly message: string }[] }): string {
  const i = r.issues[0];
  return i === undefined ? 'The material was refused.' : `${i.path === '' ? '' : `${i.path}: `}${i.message}`;
}

/** Creates one of my own materials. Returns its id, or why the schema refused it. */
export function createMaterial(fields: MaterialFields): { readonly id: string } | { readonly error: string } {
  const slug = fields.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'material';
  const id = `mine.${slug}-${Date.now().toString(36)}`.slice(0, 64);
  const r = readMaterial({ ...JSON.parse(JSON.stringify(fields)), id, version: 1 });
  if (!r.ok) return { error: firstIssue(r) };
  ownMaterialStore.set([...ownMaterialStore.value.value, r.value]);
  return { id };
}

/** Saves an edit of one of my materials (a copy or my own); built-ins are never edited. Returns why it was refused, or null. */
export function updateMaterial(id: string, fields: MaterialFields): string | null {
  const own = ownMaterialStore.value.value.find((m) => m.id === id);
  if (own !== undefined) {
    const r = reviseRecord('material', own, JSON.parse(JSON.stringify(fields)) as Record<string, unknown>);
    if (!r.ok) return firstIssue(r);
    ownMaterialStore.set(ownMaterialStore.value.value.map((m) => (m.id === id ? r.value : m)));
    return null;
  }
  const list = myMaterialStore.value.value;
  const fork = list.find((f) => f.id === id);
  const parent = fork === undefined ? undefined : builtinMaterial(fork.forkOf.id);
  const current = material(id);
  if (fork === undefined || parent === undefined || current === null) return 'Only your own materials can be edited. Make your own copy first.';
  let next = fork as LibraryFork & { readonly kind: 'material' };
  for (const field of EDIT_FIELDS) {
    if (JSON.stringify(current[field]) === JSON.stringify(fields[field])) continue;
    const r = editFork(next, parent, field, JSON.parse(JSON.stringify(fields[field])));
    if (!r.ok) return firstIssue(r);
    next = r.value as LibraryFork & { readonly kind: 'material' };
  }
  myMaterialStore.set(list.map((f) => (f.id === id ? next : f)));
  return null;
}

/** Deletes one of my materials. Built-ins cannot be deleted. Returns false when it is not mine. */
export function deleteMaterial(id: string): boolean {
  if (ownMaterialStore.value.value.some((m) => m.id === id)) {
    ownMaterialStore.set(ownMaterialStore.value.value.filter((m) => m.id !== id));
    return true;
  }
  if (myMaterialStore.value.value.some((f) => f.id === id)) {
    myMaterialStore.set(myMaterialStore.value.value.filter((f) => f.id !== id));
    return true;
  }
  return false;
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

/** A profile's revision (records from before revisions read as 1). */
export function machineRevision(m: MachineProfile): number {
  return m.revision ?? 1;
}

/** The default spoilboard thickness assumed until measured, mm. */
export const PLACEHOLDER_BED_THICKNESS = 19;

/**
 * The bed a profile implies until one is recorded: the travel's footprint, a 19 mm board, its top at the
 * bottom of Z travel below home (home at the front-left, Z at the top). Every number is a placeholder.
 */
export function placeholderBed(m: Pick<MachineProfile, 'travel'>): MachineBed {
  return {
    revision: 0,
    width: m.travel.x,
    depth: m.travel.y,
    thickness: PLACEHOLDER_BED_THICKNESS,
    outline: null,
    holes: [],
    toMachine: { x: 0, y: 0, z: -m.travel.z },
    source: { kind: 'placeholder', note: 'From the profile’s travel: measure the bed and where its top sits below home.' },
    savedAt: '',
  };
}

/** The machine's bed: its recorded revision, or the placeholder. */
export function bedOf(m: MachineProfile): MachineBed {
  return m.bed ?? placeholderBed(m);
}

/** True when the bed's dimensions are not from a measurement or drawing (shown as Placeholder, excluded from fit certainty). */
export function bedIsPlaceholder(bed: MachineBed): boolean {
  return bed.source.kind === 'placeholder';
}

/** Changes a profile: a new revision of it. Returns false when there is no such machine. */
export function updateMachine(id: string, patch: Partial<Omit<MachineProfile, 'id' | 'revision'>>): boolean {
  const list = machineStore.value.value;
  const m = list.find((x) => x.id === id);
  if (m === undefined) return false;
  machineStore.set(list.map((x) => (x.id === id ? { ...x, ...patch, revision: machineRevision(x) + 1 } : x)));
  return true;
}

/** Saves a bed as the machine's next bed revision (a new machine revision too). Returns the saved bed, or null. */
export function saveMachineBed(id: string, bed: Omit<MachineBed, 'revision' | 'savedAt'>, now: () => Date = () => new Date()): MachineBed | null {
  const m = machineStore.value.value.find((x) => x.id === id);
  if (m === undefined) return null;
  const next: MachineBed = { ...bed, revision: (m.bed?.revision ?? 0) + 1, savedAt: now().toISOString() };
  updateMachine(id, { bed: next });
  return next;
}
