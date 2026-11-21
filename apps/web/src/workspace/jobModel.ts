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
import {
  JOB_FORMAT,
  isBed,
  isJob,
  readFixture,
  type DrawingSource,
  type Fixture,
  type FixtureClamp,
  type Job,
  type JobDatum,
  type JobFile,
  type JobMachine,
  type JobPlacement,
  type JobReference,
  type JobSetup,
  type Stock,
  type StockCorner,
  type StockOutline,
  type ToolRef,
} from '@synthetos/library';
import { SAMPLE_HASH, SEED_SETUP, bedOf, legacySetupStore, machineRevision, type MachineBed, type MachineProfile, type SetupState } from './library.ts';
import { afterLoad, stored } from './storage.ts';

// The record types and the readers are the package's (`@synthetos/library` job.ts), shared with the account store.
export { JOB_FORMAT, isBed, isJob };
export type { DrawingSource, Job, JobDatum, JobFile, JobMachine, JobPlacement, JobReference, JobSetup, StockOutline, ToolRef };

export const DRAFT_NAME = 'Draft setup';
export const MIGRATED_DRAFT_NAME = 'Draft setup (from Setup)';

// ---------------------------------------------------------------- reading

const SHA256 = /^[0-9a-f]{64}$/;

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
    source: { kind: 'placeholder', note: 'A bed not tied to a machine. Its top is drawn at machine Z 0.' },
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
    placement: { wcs: 'G54', datum: { corner: stock.zero.corner, height: stock.zero.height }, plannedZero: null, frame: 'bed', datumFrom: { kind: 'file', hash: null } },
    createdAt: at,
    updatedAt: at,
  };
}

/** A fresh draft from the seed setup; the job's own Stock step sets the stock (OD-42: setup no longer does). */
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

/**
 * The job with its datum changed (the stock record mirrors it, as the Setup view's zero picker always did), and who
 * chose it for which file (`from`; by default the user, for the job's file). Picking a stock point leaves "use the
 * machine's work zero".
 */
export function withDatum(job: Job, datum: JobDatum, clock: JobClock = BROWSER_CLOCK, from: 'user' | 'file' = 'user'): Job {
  const { zeroFrom: _z, ...rest } = job.placement;
  void _z;
  const placement: JobPlacement = { ...rest, datum: { corner: datum.corner, height: datum.height }, datumFrom: { kind: from, hash: job.file?.hash ?? null } };
  return reviseJob(job, { setup: { ...job.setup, stock: { ...job.setup.stock, zero: { corner: datum.corner, height: datum.height } } }, placement }, clock);
}

/** The job placed at the board's work zero (`on`), or back at its stock point. Never writes to the board. */
export function withMachineZero(job: Job, on: boolean, clock: JobClock = BROWSER_CLOCK): Job {
  const { zeroFrom: _z, ...rest } = job.placement;
  void _z;
  const from = { kind: 'user' as const, hash: job.file?.hash ?? null };
  return reviseJob(job, { placement: on ? { ...rest, zeroFrom: 'machine', datumFrom: from } : { ...rest, datumFrom: from } }, clock);
}

/** True when the user chose this job's datum for its current file (or the job predates the record): run never changes it. */
export function datumPickedByUser(job: Job): boolean {
  const from = job.placement.datumFrom;
  if (from === undefined) return true;
  return from.kind === 'user' && from.hash === (job.file?.hash ?? null);
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

/**
 * The job's offset from its datum (`JobPlacement.offset`), zeros when none: X and Y on the stock, and Z, how far
 * zero is below the stock top (datum at the top) or above the stock bottom (datum at the bottom).
 */
export function placementOffset(job: Job): { readonly x: number; readonly y: number; readonly z: number } {
  const o = job.placement.offset;
  return { x: o?.x ?? 0, y: o?.y ?? 0, z: o?.z ?? 0 };
}

/** The machine directions a positive offset moves the zero at a corner: inward, toward the stock's middle; machine X and Y at the centre. */
export function inwardSigns(corner: StockCorner): { readonly x: 1 | -1; readonly y: 1 | -1 } {
  return { x: corner.includes('right') ? -1 : 1, y: corner.includes('back') ? -1 : 1 };
}

/** The planned work zero in bed-local coordinates: the datum corner of the stock, at its top or bottom, moved by the offset. */
export function datumPoint(job: Job): { readonly x: number; readonly y: number; readonly z: number } {
  const st = job.setup.stock;
  const { x0, y0, w, d } = stockFootprint(st);
  const c = job.placement.datum.corner;
  const o = placementOffset(job);
  const s = inwardSigns(c);
  const x = (c.includes('right') ? x0 + w : c.includes('left') ? x0 : x0 + w / 2) + s.x * o.x;
  const y = (c.includes('back') ? y0 + d : c.includes('front') ? y0 : y0 + d / 2) + s.y * o.y;
  // Z: positive is down from the top, or up from the bottom (CAM set to the model's top inside a thicker blank).
  const z = fixtureTop(job) + (job.placement.datum.height === 'top' ? st.thickness - o.z : o.z);
  return { x, y, z };
}

/** The job with its zero moved from the datum (`JobPlacement.offset`); all zeros removes the field. */
export function withOffset(job: Job, offset: { readonly x: number; readonly y: number; readonly z?: number }, clock: JobClock = BROWSER_CLOCK): Job {
  const { offset: _old, ...rest } = job.placement;
  void _old;
  const z = offset.z ?? 0;
  const none = offset.x === 0 && offset.y === 0 && z === 0;
  return reviseJob(job, { placement: none ? rest : { ...rest, offset: { x: offset.x, y: offset.y, ...(z === 0 ? {} : { z }) } } }, clock);
}

/**
 * Where the job's zero goes in machine coordinates now: the board's work zero (`liveZero`, while connected and the
 * position is established) when the job uses it, else the planned zero from the stock point.
 */
export function effectiveZero(job: Job, liveZero: { readonly x: number; readonly y: number; readonly z: number } | null): { readonly x: number; readonly y: number; readonly z: number } {
  return job.placement.zeroFrom === 'machine' && liveZero !== null ? liveZero : plannedZero(job);
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
