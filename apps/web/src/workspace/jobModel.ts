/**
 * The Job model (docs/design/FLOW_ANALYSIS.md §3, §4 step 1): one durable
 * record that links a project's G-code file version, a machine revision with
 * its bed, and the setup (stock, fixture, clamps, tools) with the planned
 * work-zero placement.
 *
 * Ownership: a project holds files and jobs; a machine revision owns its bed
 * and bed-to-machine transform (library.ts `MachineBed`); a job owns its file
 * version, a pinned copy of the machine's bed revision, its stock, fixture,
 * clamps, tool mapping and placement. Revising a library machine never
 * changes a job's pinned bed: the job offers to take the new revision.
 *
 * Nothing live is ever in a job: homing, consent, the board's offsets and
 * permission to resume are session facts and are never restored from here.
 *
 * Two stores, both in this browser's localStorage through storage.ts:
 * - `draftJobStore`: the one local draft ("Draft setup"), for one-off files
 *   that are not in a project. The old global setup (`setup.v2`) migrates
 *   into it the first time; the original record is left untouched.
 * - `activeJobStore`: the job the Run and Setup views show, for the lifetime
 *   of the document and across reloads. A project job here is a copy; the
 *   project record is the authority and is written through `jobPersistence`.
 */
import { computed, signal } from '@preact/signals';
import { readFixture, readStock, type Fixture, type FixtureClamp, type Stock, type StockCorner } from '@synthetos/library';
import { SAMPLE_HASH, SEED_SETUP, bedOf, legacySetupStore, machineRevision, type MachineBed, type MachineProfile, type SetupState } from './library.ts';
import { afterLoad, isArray, isObject, stored } from './storage.ts';

export const JOB_FORMAT = 1;

/** The G-code file a job runs: a project file version (by id and SHA-256), or a local file (no project, hash only). */
export interface JobFile {
  readonly projectId: string | null;
  readonly fileId: string | null;
  readonly name: string;
  /** SHA-256 of the bytes, hex: the durable identity of the file version (never the preview's FNV key). */
  readonly hash: string;
  readonly size: number;
}

export interface JobMachine {
  readonly id: string;
  readonly revision: number;
  readonly name: string;
}

export interface ToolRef {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly number: number;
}

/** A file used by the job for reference only (a photo, a model, notes): never geometry. */
export interface JobReference {
  readonly fileId: string;
  readonly name: string;
  readonly hash: string;
}

export interface DrawingSource {
  readonly file: string;
  readonly kind: 'dxf' | 'svg';
  readonly hash: string;
}

/** A stock outline imported from a drawing (owner decision 5: deliberate, limited support). Bed-local, like the stock. */
export interface StockOutline {
  readonly outline: readonly (readonly [number, number])[];
  readonly holes: readonly (readonly [number, number, number])[];
  readonly source: DrawingSource;
}

export interface JobSetup {
  /** The bed this job is planned on: a pinned copy of the machine's bed revision, or the draft's own bed. */
  readonly bed: MachineBed;
  readonly bedFrom: 'machine' | 'own';
  /**
   * The stock. Its `position` is the centre of its footprint in bed-local coordinates and its `zero` mirrors
   * `placement.datum` (the Setup view's own semantics, kept and labelled through the migration).
   */
  readonly stock: Stock;
  readonly stockOutline: StockOutline | null;
  /** The fixture; its `position` is the centre of its footprint in bed-local coordinates. */
  readonly fixture: Fixture | null;
  /** Clamps as records. The four `toe` clamps the Setup view used to draw are illustrative and follow the stock. */
  readonly clamps: readonly FixtureClamp[];
  readonly tools: readonly ToolRef[];
  readonly references: readonly JobReference[];
}

export interface JobDatum {
  readonly corner: StockCorner;
  readonly height: 'top' | 'bottom';
}

export interface JobPlacement {
  readonly wcs: 'G54';
  /** The CAM file's datum as the user describes it: the stock corner and face its zero sits at. */
  readonly datum: JobDatum;
  /** An explicit planned work zero in machine coordinates (the Place step, later); null derives it from the datum. */
  readonly plannedZero: { readonly x: number; readonly y: number; readonly z: number } | null;
  /** The frame the setup is described in: bed-local, moved into machine coordinates by the bed's transform. */
  readonly frame: 'bed';
}

export interface Job {
  readonly v: typeof JOB_FORMAT;
  readonly id: string;
  readonly projectId: string | null;
  readonly name: string;
  /** Bumped on every change. */
  readonly revision: number;
  readonly file: JobFile | null;
  readonly machine: JobMachine | null;
  readonly setup: JobSetup;
  readonly placement: JobPlacement;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const DRAFT_NAME = 'Draft setup';
export const MIGRATED_DRAFT_NAME = 'Draft setup (from Setup)';

// ---------------------------------------------------------------- reading

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPt = (v: unknown): boolean => isArray(v) && v.length === 2 && v.every(isNum);
const isHole = (v: unknown): boolean => isArray(v) && v.length === 3 && v.every(isNum);
const SHA256 = /^[0-9a-f]{64}$/;

export function isBed(v: unknown): v is MachineBed {
  if (!isObject(v) || !isNum(v['revision']) || !isNum(v['width']) || !isNum(v['depth']) || !isNum(v['thickness'])) return false;
  if (!(v['outline'] === null || (isArray(v['outline']) && v['outline'].every(isPt))) || !isArray(v['holes']) || !v['holes'].every(isHole)) return false;
  const t = v['toMachine'];
  const s = v['source'];
  return isObject(t) && isNum(t['x']) && isNum(t['y']) && isNum(t['z']) && isObject(s) && typeof s['kind'] === 'string' && typeof v['savedAt'] === 'string';
}

const isClamp = (v: unknown): v is FixtureClamp => isObject(v) && typeof v['kind'] === 'string' && ['x', 'y', 'w', 'd', 'h'].every((k) => isNum(v[k]));
const isToolRef = (v: unknown): v is ToolRef => isObject(v) && typeof v['id'] === 'string' && isNum(v['version']) && typeof v['name'] === 'string' && isNum(v['number']);
const isReference = (v: unknown): v is JobReference => isObject(v) && typeof v['fileId'] === 'string' && typeof v['name'] === 'string' && typeof v['hash'] === 'string';
const isSource = (v: unknown): v is DrawingSource => isObject(v) && typeof v['file'] === 'string' && (v['kind'] === 'dxf' || v['kind'] === 'svg') && typeof v['hash'] === 'string';
const isStockOutline = (v: unknown): v is StockOutline => isObject(v) && isArray(v['outline']) && v['outline'].every(isPt) && isArray(v['holes']) && v['holes'].every(isHole) && isSource(v['source']);
const CORNERS: readonly StockCorner[] = ['front-left', 'front-right', 'back-left', 'back-right', 'center'];

export function isJob(v: unknown): v is Job {
  if (!isObject(v) || v['v'] !== JOB_FORMAT || typeof v['id'] !== 'string' || typeof v['name'] !== 'string' || !isNum(v['revision'])) return false;
  if (!(v['projectId'] === null || typeof v['projectId'] === 'string') || typeof v['createdAt'] !== 'string' || typeof v['updatedAt'] !== 'string') return false;
  const f = v['file'];
  if (!(f === null || (isObject(f) && (f['projectId'] === null || typeof f['projectId'] === 'string') && (f['fileId'] === null || typeof f['fileId'] === 'string') && typeof f['name'] === 'string' && typeof f['hash'] === 'string' && isNum(f['size'])))) return false;
  const m = v['machine'];
  if (!(m === null || (isObject(m) && typeof m['id'] === 'string' && isNum(m['revision']) && typeof m['name'] === 'string'))) return false;
  const s = v['setup'];
  if (!isObject(s) || !isBed(s['bed']) || !(s['bedFrom'] === 'machine' || s['bedFrom'] === 'own') || !readStock(s['stock']).ok) return false;
  if (!(s['stockOutline'] === null || isStockOutline(s['stockOutline'])) || !(s['fixture'] === null || readFixture(s['fixture']).ok)) return false;
  if (!isArray(s['clamps']) || !s['clamps'].every(isClamp) || !isArray(s['tools']) || !s['tools'].every(isToolRef) || !isArray(s['references']) || !s['references'].every(isReference)) return false;
  const p = v['placement'];
  if (!isObject(p) || p['wcs'] !== 'G54' || p['frame'] !== 'bed') return false;
  const d = p['datum'];
  if (!isObject(d) || !CORNERS.includes(d['corner'] as StockCorner) || !(d['height'] === 'top' || d['height'] === 'bottom')) return false;
  const z = p['plannedZero'];
  return z === null || (isObject(z) && isNum(z['x']) && isNum(z['y']) && isNum(z['z']));
}

const isJobOrNull = (v: unknown): v is Job | null => v === null || isJob(v);

// ---------------------------------------------------------------- building

/** The Setup view's old bed, as the draft's own bed: the front-left corner of its top at machine (0, 0, 0), as it was drawn. */
export function ownBed(bed: SetupState['bed'], at: string): MachineBed {
  return {
    revision: 0,
    width: bed.width,
    depth: bed.depth,
    thickness: bed.thickness,
    outline: null,
    holes: [],
    toMachine: { x: 0, y: 0, z: 0 },
    source: { kind: 'placeholder', note: 'The Setup view’s bed, not tied to a machine: its top is drawn at machine Z 0.' },
    savedAt: at,
  };
}

/**
 * A stock record the schema accepts: only round stock carries a diameter (the old seed carried one on a block,
 * so the stored setup never read back). Round stock without one takes its width.
 */
export function normalStock(stock: Stock): Stock {
  const { diameter, ...rest } = stock;
  return stock.shape === 'round' ? { ...rest, diameter: diameter ?? stock.width } : rest;
}

/** The four illustrative toe clamps the Setup view drew on a block or sheet's front and back edges, as records. */
export function illustrativeClamps(stock: Stock): readonly FixtureClamp[] {
  if (stock.shape === 'round') return [];
  const sw = stock.width;
  const sd = stock.depth;
  const sx = stock.position.x - sw / 2;
  const sy = stock.position.y - sd / 2;
  const h = Math.max(6, stock.thickness * 0.6);
  return ([[sx + sw * 0.15, sy - 8], [sx + sw * 0.85, sy - 8], [sx + sw * 0.15, sy + sd + 8], [sx + sw * 0.85, sy + sd + 8]] as const).map(([cx, cy]) => ({ kind: 'toe', x: cx - 14, y: cy - 10, w: 28, d: 20, h }));
}

/** True when every clamp is one of the illustrative toe clamps (they follow the stock; placed clamps do not). */
export function clampsAreIllustrative(clamps: readonly FixtureClamp[]): boolean {
  return clamps.length > 0 && clamps.every((c) => c.kind === 'toe');
}

/** A fixture with a source hash the schema accepts: a hash that is not a SHA-256 (the sample's, an FNV one) becomes the unverified one. */
export function repairFixture(fixture: Fixture | null): Fixture | null {
  if (fixture === null) return null;
  const fixed: Fixture = SHA256.test(fixture.source.hash) ? fixture : { ...fixture, source: { ...fixture.source, hash: SAMPLE_HASH } };
  return readFixture(fixed).ok ? fixed : null;
}

export interface JobClock {
  readonly now: () => Date;
  readonly newId: () => string;
}

export const BROWSER_CLOCK: JobClock = { now: () => new Date(), newId: () => crypto.randomUUID() };

/** A job built from a setup (the old global one, or the seed), with no file and no machine. */
export function jobFromSetup(setup: SetupState, name: string, clock: JobClock): Job {
  const at = clock.now().toISOString();
  const fixture = repairFixture(setup.fixture);
  const stock = normalStock(setup.stock);
  return {
    v: JOB_FORMAT,
    id: clock.newId(),
    projectId: null,
    name,
    revision: 1,
    file: null,
    machine: null,
    setup: { bed: ownBed(setup.bed, at), bedFrom: 'own', stock, stockOutline: null, fixture, clamps: setup.clamps ? illustrativeClamps(stock) : [], tools: [], references: [] },
    placement: { wcs: 'G54', datum: { corner: stock.zero.corner, height: stock.zero.height }, plannedZero: null, frame: 'bed' },
    createdAt: at,
    updatedAt: at,
  };
}

/** A fresh draft from the seed setup. */
export function newDraftJob(clock: JobClock = BROWSER_CLOCK): Job {
  return jobFromSetup(SEED_SETUP, DRAFT_NAME, clock);
}

/** The job the prerendered page shows before the stores load: the seed, with fixed ids and dates so hydration matches. */
export const SEED_JOB: Job = jobFromSetup(SEED_SETUP, DRAFT_NAME, { now: () => new Date(0), newId: () => 'seed-draft' });

/** A new job with another job's setup and placement (the bench carries over): a new id, revision 1, no file, no project. */
export function cloneJob(base: Job, clock: JobClock = BROWSER_CLOCK): Job {
  const at = clock.now().toISOString();
  return { ...base, id: clock.newId(), projectId: null, file: null, revision: 1, createdAt: at, updatedAt: at };
}

/** A changed job: the next revision. */
export function reviseJob(job: Job, patch: Partial<Omit<Job, 'id' | 'v' | 'revision' | 'createdAt' | 'updatedAt'>>, clock: JobClock = BROWSER_CLOCK): Job {
  return { ...job, ...patch, revision: job.revision + 1, updatedAt: clock.now().toISOString() };
}

/** The job with a changed setup; illustrative clamps follow the stock. */
export function withSetup(job: Job, patch: Partial<JobSetup>, clock: JobClock = BROWSER_CLOCK): Job {
  const setup: JobSetup = { ...job.setup, ...patch, ...(patch.stock === undefined ? {} : { stock: normalStock(patch.stock) }) };
  const stockChanged = patch.stock !== undefined && patch.stock !== job.setup.stock;
  const clamps = stockChanged && clampsAreIllustrative(setup.clamps) ? illustrativeClamps(setup.stock) : setup.clamps;
  const datum = stockChanged ? { corner: setup.stock.zero.corner, height: setup.stock.zero.height } : job.placement.datum;
  return reviseJob(job, { setup: { ...setup, clamps }, placement: { ...job.placement, datum } }, clock);
}

/** The job with its datum changed (the stock record mirrors it, as the Setup view's zero picker always did). */
export function withDatum(job: Job, datum: JobDatum, clock: JobClock = BROWSER_CLOCK): Job {
  return reviseJob(job, { setup: { ...job.setup, stock: { ...job.setup.stock, zero: datum } }, placement: { ...job.placement, datum } }, clock);
}

/** The job planned on a machine: its id, revision and a pinned copy of the machine's bed revision. */
export function withMachine(job: Job, machine: MachineProfile | null, clock: JobClock = BROWSER_CLOCK): Job {
  if (machine === null) return reviseJob(job, { machine: null }, clock);
  return reviseJob(job, { machine: { id: machine.id, revision: machineRevision(machine), name: machine.name }, setup: { ...job.setup, bed: bedOf(machine), bedFrom: 'machine' } }, clock);
}

/** The job's bed is behind the machine's current bed revision (the job keeps its pinned copy until asked). */
export function bedBehind(job: Job, machine: MachineProfile | null): boolean {
  return job.machine !== null && machine !== null && machine.id === job.machine.id && job.setup.bedFrom === 'machine' && bedOf(machine).revision !== job.setup.bed.revision;
}

// ---------------------------------------------------------------- geometry (bed-local, as the Setup view describes it)

export function fixtureTop(job: Job): number {
  return job.setup.fixture?.height ?? 0;
}

/** The stock's footprint in bed-local coordinates: Setup's `position` is its centre. */
export function stockFootprint(stock: Stock): { readonly x0: number; readonly y0: number; readonly w: number; readonly d: number } {
  const w = stock.shape === 'round' ? (stock.diameter ?? stock.width) : stock.width;
  const d = stock.shape === 'round' ? (stock.diameter ?? stock.width) : stock.depth;
  return { x0: stock.position.x - w / 2, y0: stock.position.y - d / 2, w, d };
}

/** The planned work zero in bed-local coordinates: the datum corner of the stock, at its top or bottom. */
export function datumPoint(job: Job): { readonly x: number; readonly y: number; readonly z: number } {
  const st = job.setup.stock;
  const { x0, y0, w, d } = stockFootprint(st);
  const c = job.placement.datum.corner;
  const x = c.includes('right') ? x0 + w : c.includes('left') ? x0 : x0 + w / 2;
  const y = c.includes('back') ? y0 + d : c.includes('front') ? y0 : y0 + d / 2;
  const z = fixtureTop(job) + (job.placement.datum.height === 'top' ? st.thickness : 0);
  return { x, y, z };
}

/** The planned work zero in machine coordinates: the explicit one, or the datum moved by the bed's transform. */
export function plannedZero(job: Job): { readonly x: number; readonly y: number; readonly z: number } {
  if (job.placement.plannedZero !== null) return job.placement.plannedZero;
  const p = datumPoint(job);
  const t = job.setup.bed.toMachine;
  return { x: p.x + t.x, y: p.y + t.y, z: p.z + t.z };
}

// ---------------------------------------------------------------- stores

export const draftJobStore = stored<Job | null>('job.draft.v1', null, isJobOrNull);
export const activeJobStore = stored<Job | null>('job.active.v1', null, isJobOrNull);

/** The job the Run and Setup views show. Null only before the stores load (the prerendered page). */
export const activeJob = computed<Job | null>(() => activeJobStore.value.value);

/**
 * Writes a project job back into its project (projects/browserStore.ts registers it). Resolves false when the
 * project refused or no longer exists; the job then stays active for this page only.
 */
export const jobPersistence = signal<((job: Job) => Promise<boolean>) | null>(null);

/**
 * Migrates once: with no draft stored, the old global setup (or the seed) becomes the named draft. The
 * original `setup.v2` record is never touched, so a refused write (quota, blocked storage) loses nothing:
 * the next load migrates again.
 */
export function migrateSetupToDraft(clock: JobClock = BROWSER_CLOCK): Job {
  const existing = draftJobStore.value.value;
  if (existing !== null) return existing;
  const legacy = legacySetupStore.value.value;
  const draft = jobFromSetup(legacy, legacy === SEED_SETUP ? DRAFT_NAME : MIGRATED_DRAFT_NAME, clock);
  draftJobStore.set(draft);
  return draft;
}

/** After the stores load: migrate, and make the draft active when nothing is. */
export function loadJobs(clock: JobClock = BROWSER_CLOCK): void {
  const draft = migrateSetupToDraft(clock);
  if (activeJobStore.value.value === null) activeJobStore.set(draft);
}

afterLoad(() => loadJobs());

/** Makes `job` the active one; a draft is also the draft store's, a project job is also written to its project. */
export function setActiveJob(job: Job): void {
  activeJobStore.set(job);
  if (job.projectId === null) draftJobStore.set(job);
  else void jobPersistence.value?.(job);
}

/** Changes the active job (the next revision) and persists it. No-op before the stores load. */
export function updateActiveJob(change: (job: Job) => Job): Job | null {
  const current = activeJobStore.value.value;
  if (current === null) return null;
  const next = change(current);
  setActiveJob(next);
  return next;
}

/** True when a change could not be kept in this browser's storage (the UI says so). */
export const jobSaved = computed(() => activeJobStore.saved.value && draftJobStore.saved.value);
