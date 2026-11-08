/**
 * The Job model (FLOW_ANALYSIS §4 steps 1-4): versioned Job records, the
 * migration of the old global setup into a named draft that keeps the
 * original until the draft persists, no live facts in a job, machine-owned
 * bed revisions pinned by jobs, the planned work zero through the
 * bed-to-machine transform (negative coordinates and Z included), the shared
 * scene from a job, projects that keep their jobs, and the one job opener
 * with its active-execution lock.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { readFixture } from '@synthetos/library';
import { all, byAttr, one, root } from './tree.ts';
import { loadStoredLibraries, memoryRecordStore, type StorageLike } from '../src/workspace/storage.ts';
import { legacySetupStore, machineStore, placeholderBed, SAMPLE_HASH, sampleFixture, saveMachineBed, SEED_SETUP, type MachineProfile } from '../src/workspace/library.ts';
import { activeJobStore, bedBehind, clampsAreIllustrative, datumPoint, draftJobStore, illustrativeClamps, isJob, jobFromSetup, MIGRATED_DRAFT_NAME, newDraftJob, plannedZero, reviseJob, SEED_JOB, withDatum, withMachine, withSetup, type Job, type JobClock } from '../src/workspace/jobModel.ts';
import { jobScene, liveFrame } from '../src/preview/sceneModel.ts';
import { PreviewSvg } from '../src/preview/PreviewSvg.ts';
import { ProjectStore, readProject, type ProjectDeps } from '../src/projects/store.ts';
import { closeJob, currentFile, currentPreview, DRAFT_FILE_KEY, executionLock, openJob, openProjectFile, openProjectJob, pendingOpen, reopenActiveJob, resetReopen, type OpenDeps } from '../src/workspace/fileBridge.ts';
import { applyImport, checkDrawing, rolesFor, scaled, skippedText } from '../src/projects/useInJob.ts';
import { parseDxfOutline, parseSvgOutline } from '../src/workspace/outline.ts';
import { analyseBytes } from '../src/gcode-worker/pipeline.ts';

const clock = (): JobClock => {
  let t = Date.parse('2026-11-03T09:00:00Z');
  let n = 0;
  return { now: () => new Date((t += 1000)), newId: () => `j${++n}` };
};

/** Reads a signal without TypeScript's control-flow narrowing after an assignment to it. */
const peek = <T,>(sig: { readonly value: T }): T => sig.value;

const SCENE_COLORS = { bed: [0.7, 0.6, 0.5, 1], fixture: [0.5, 0.6, 0.7, 1], clamp: [0.4, 0.4, 0.4, 1], stock: [0.8, 0.8, 0.8, 1] } as const;

function machine(id = 'm1', travel = { x: 750, y: 750, z: 65 }): MachineProfile {
  return { id, name: 'Shop X-Carve', templateId: 'xcarve', drive: 'belt', travel, spindle: 'Trim router', createdAt: '2026-11-01T00:00:00Z', revision: 1 };
}

/** A localStorage stand-in: a map, or one that refuses every write (a full quota). */
function fakeStorage(full = false): StorageLike & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      if (full) throw new DOMException('quota', 'QuotaExceededError');
      map.set(k, v);
    },
  };
}

function withStorage<T>(storage: StorageLike | null, fn: () => T): T {
  const g = globalThis as { localStorage?: unknown };
  const before = g.localStorage;
  if (storage === null) delete g.localStorage;
  else g.localStorage = storage;
  try {
    return fn();
  } finally {
    if (before === undefined) delete g.localStorage;
    else g.localStorage = before;
  }
}

describe('Job records and the migration of the global setup', () => {
  it('migrates the old setup into a named draft: its own bed at machine 0, the fixture repaired, clamps as records, the datum from the stock', () => {
    const job = jobFromSetup({ ...SEED_SETUP, stock: { ...SEED_SETUP.stock, zero: { corner: 'back-right', height: 'bottom' } } }, MIGRATED_DRAFT_NAME, clock());
    expect(isJob(job)).toBe(true);
    expect(job.name).toBe('Draft setup (from Setup)');
    expect(job.projectId).toBeNull();
    expect(job.setup.bedFrom).toBe('own');
    expect(job.setup.bed).toMatchObject({ width: 790, depth: 790, thickness: 19, toMachine: { x: 0, y: 0, z: 0 }, source: { kind: 'placeholder' } });
    expect(job.setup.fixture?.source.hash).toBe(SAMPLE_HASH);
    expect(readFixture(job.setup.fixture).ok).toBe(true);
    expect(job.setup.clamps).toHaveLength(4);
    expect(clampsAreIllustrative(job.setup.clamps)).toBe(true);
    expect(job.placement).toEqual({ wcs: 'G54', datum: { corner: 'back-right', height: 'bottom' }, plannedZero: null, frame: 'bed' });
    // A fixture the schema still refuses after the hash repair is dropped, never kept half-read.
    const bad = jobFromSetup({ ...SEED_SETUP, fixture: { ...sampleFixture(), outline: [[0, 0]] } }, 'x', clock());
    expect(bad.setup.fixture).toBeNull();
  });

  it('a job holds no live session facts, and a stored record that carries some still reads as the job alone', () => {
    const job = newDraftJob(clock());
    expect(Object.keys(job).sort()).toEqual(['createdAt', 'file', 'id', 'machine', 'name', 'placement', 'projectId', 'revision', 'setup', 'updatedAt', 'v']);
    for (const key of ['homed', 'consent', 'offsets', 'resume', 'ofs', 'live']) expect(key in job).toBe(false);
    expect(isJob({ ...job, homed: true, consent: { c1: true }, offsets: { x: 1 } })).toBe(true);
    expect(isJob({ ...job, v: 2 })).toBe(false);
    expect(isJob({ ...job, setup: { ...job.setup, stock: { ...job.setup.stock, width: -1 } } })).toBe(false);
    expect(isJob({ ...job, placement: { ...job.placement, wcs: 'G55' } })).toBe(false);
    expect(SEED_JOB.id).toBe('seed-draft');
  });

  it('revisions bump on every change; illustrative clamps follow the stock, placed clamps do not; the datum mirrors into the stock', () => {
    const job = newDraftJob(clock());
    const moved = withSetup(job, { stock: { ...job.setup.stock, position: { x: 300, y: 300 } } });
    expect(moved.revision).toBe(2);
    expect(moved.setup.clamps[0]?.x).not.toBe(job.setup.clamps[0]?.x);
    const placed = withSetup(moved, { clamps: [{ kind: 'strap', x: 1, y: 2, w: 3, d: 4, h: 5 }] });
    const movedAgain = withSetup(placed, { stock: { ...placed.setup.stock, position: { x: 10, y: 10 } } });
    expect(movedAgain.setup.clamps).toEqual([{ kind: 'strap', x: 1, y: 2, w: 3, d: 4, h: 5 }]);
    const datum = withDatum(job, { corner: 'center', height: 'bottom' });
    expect(datum.setup.stock.zero).toEqual({ corner: 'center', height: 'bottom' });
    expect(datum.placement.datum).toEqual({ corner: 'center', height: 'bottom' });
    expect(illustrativeClamps({ ...job.setup.stock, shape: 'round' })).toEqual([]);
  });

  it('the first load migrates setup.v2 into job.draft.v1 and leaves the original untouched; a refused write keeps both as they were', () => {
    const legacy = { ...SEED_SETUP, bed: { width: 600, depth: 400, thickness: 12 }, fixture: null, clamps: false };
    const ok = fakeStorage();
    ok.map.set('run.ws.setup.v2', JSON.stringify({ v: 1, value: legacy }));
    withStorage(ok, () => loadStoredLibraries());
    expect(draftJobStore.saved.value).toBe(true);
    expect(draftJobStore.value.value?.setup.bed.width).toBe(600);
    expect(draftJobStore.value.value?.name).toBe(MIGRATED_DRAFT_NAME);
    expect(activeJobStore.value.value?.id).toBe(draftJobStore.value.value?.id);
    expect(JSON.parse(ok.map.get('run.ws.setup.v2') ?? '').value).toEqual(legacy);
    expect(ok.map.has('run.ws.job.draft.v1')).toBe(true);
    expect(ok.map.has('run.ws.job.active.v1')).toBe(true);
    // The same page with a full quota: the draft is migrated in memory, nothing is written, nothing is lost.
    const full = fakeStorage(true);
    full.map.set('run.ws.setup.v2', JSON.stringify({ v: 1, value: legacy }));
    draftJobStore.value.value = null;
    activeJobStore.value.value = null;
    withStorage(full, () => loadStoredLibraries());
    expect(draftJobStore.saved.value).toBe(false);
    expect(peek(draftJobStore.value)?.setup.bed.depth).toBe(400);
    expect([...full.map.keys()]).toEqual(['run.ws.setup.v2']);
    expect(legacySetupStore.value.value.bed).toEqual(legacy.bed);
  });
});

describe('machine-owned bed revisions', () => {
  it('a job pins the machine’s bed revision; revising the machine’s bed leaves the job on its revision until it takes the new one', () => {
    const m = machine();
    machineStore.value.value = [m];
    const job = withMachine(newDraftJob(clock()), m);
    expect(job.machine).toEqual({ id: 'm1', revision: 1, name: 'Shop X-Carve' });
    expect(job.setup.bedFrom).toBe('machine');
    expect(job.setup.bed).toEqual(placeholderBed(m));
    expect(job.setup.bed.source.kind).toBe('placeholder');
    expect(job.setup.bed.toMachine).toEqual({ x: 0, y: 0, z: -65 });
    const saved = saveMachineBed('m1', { ...placeholderBed(m), width: 800, depth: 820, source: { kind: 'measured', note: 'tape', at: '2026-11-03' } });
    expect(saved?.revision).toBe(1);
    const revised = machineStore.value.value[0] as MachineProfile;
    expect(revised.revision).toBe(2);
    expect(bedBehind(job, revised)).toBe(true);
    expect(job.setup.bed.width).toBe(750);
    const taken = withMachine(job, revised);
    expect(taken.setup.bed.width).toBe(800);
    expect(taken.setup.bed.revision).toBe(1);
    expect(taken.machine?.revision).toBe(2);
    expect(bedBehind(taken, revised)).toBe(false);
    // A different machine's revision never counts as "behind" for this job.
    expect(bedBehind(taken, machine('m2'))).toBe(false);
    expect(saveMachineBed('nope', placeholderBed(m))).toBeNull();
  });
});

describe('the planned zero and the scene in machine coordinates', () => {
  function planned(): Job {
    const m = machine('m1', { x: 750, y: 750, z: 65 });
    let job = withMachine(newDraftJob(clock()), m);
    // The bed's front-left top corner measured at machine (-10, -20, -65): negative X and Y, Z below home.
    job = withSetup(job, { bed: { ...job.setup.bed, toMachine: { x: -10, y: -20, z: -65 }, source: { kind: 'measured', note: 't', at: 'now' } } });
    return withSetup(job, { stock: { ...job.setup.stock, width: 180, depth: 120, thickness: 6.35, position: { x: 100, y: 60 } }, fixture: { ...sampleFixture(), height: 12, position: { x: 150, y: 100 } } });
  }

  it('front-left top of the stock, through the bed transform (Setup’s centre semantics kept)', () => {
    const job = planned();
    expect(datumPoint(job)).toEqual({ x: 10, y: 0, z: 18.35 });
    expect(plannedZero(job)).toEqual({ x: 0, y: -20, z: -46.65 });
    const back = withDatum(job, { corner: 'back-right', height: 'bottom' });
    expect(plannedZero(back)).toEqual({ x: 180, y: 100, z: -53 });
    const explicit = reviseJob(job, { placement: { ...job.placement, plannedZero: { x: 1, y: 2, z: 3 } } });
    expect(plannedZero(explicit)).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('bed, fixture, stock, clamps and the path offset agree in one machine frame', () => {
    const job = planned();
    const scene = jobScene(job, SCENE_COLORS, [196, 205, 212]);
    const bed = scene.layers.solids.find((s) => s.tag === 'bed');
    const stock = scene.layers.solids.find((s) => s.tag === 'stock');
    const fixture = scene.layers.solids.find((s) => s.tag === 'fixture');
    expect(bed).toMatchObject({ kind: 'box', min: [-10, -20, -84], max: [740, 730, -65] });
    expect(stock).toMatchObject({ kind: 'box', min: [0, -20, -53], max: [180, 100, -46.65] });
    expect(fixture?.kind).toBe('prism');
    expect(fixture !== undefined && fixture.kind === 'prism' ? [fixture.z0, fixture.z1] : null).toEqual([-65, -53]);
    expect(scene.layers.solids.filter((s) => s.tag === 'clamp')).toHaveLength(4);
    expect(scene.pathOffset).toEqual([0, -20, -46.65]);
    expect(scene.zero).toEqual(scene.pathOffset);
    expect(scene.heights).toEqual({ bedTop: -65, fixtureTop: -53, stockTop: -46.65, aboveTable: { bedTop: 19, fixtureTop: 31, stockTop: 37.35 } });
    expect(scene.bedPlaceholder).toBe(false);
    expect(scene.bedLabel).toBe('Bed of Shop X-Carve, revision 0 · 750 × 750 mm · measured');
    // Fixture holes under the stock are hidden; the rest are rings on the fixture top.
    expect(scene.layers.rings.every((r) => r.center[2] === -53)).toBe(true);
    expect(scene.layers.rings.length).toBeLessThan(sampleFixture().holes.length);
    // The draft's own bed is a placeholder at machine 0.
    const draft = jobScene(newDraftJob(clock()), SCENE_COLORS, null);
    expect(draft.bedPlaceholder).toBe(true);
    expect(draft.layers.solids[0]).toMatchObject({ tag: 'bed', min: [0, 0, -19], max: [790, 790, 0] });
    expect(draft.bedLabel).toBe('Bed · 790 × 790 mm · placeholder');
  });

  it('the live frame: the tool at the reported machine position, the work zero from machine minus work (inches converted)', () => {
    expect(liveFrame({ mpo: { x: 10, y: 20, z: -5 }, pos: { x: 4, y: 5, z: 1 }, unit: 1 })).toEqual({ tool: [10, 20, -5], zero: [6, 15, -6] });
    // `mpo` is always millimetres; `pos` follows the board's units.
    expect(liveFrame({ mpo: { x: 25.4, y: 0, z: 0 }, pos: { x: 1, y: 0, z: 0 }, unit: 0 })).toEqual({ tool: [25.4, 0, 0], zero: [0, 0, 0] });
    // Unhomed at power-up: machine 0, 0, 0 with no offset, so the tool sits at the bed's front-left corner.
    expect(liveFrame({ mpo: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 } })).toEqual({ tool: [0, 0, 0], zero: [0, 0, 0] });
    expect(liveFrame({ mpo: { x: 1, y: 2 }, pos: { x: 1, y: 2, z: 3 } })).toBeNull();
    expect(liveFrame({ mpo: { x: 1, y: 2, z: 3 }, pos: { x: 1, y: Number.NaN, z: 3 } })).toBeNull();
  });

  it('the SVG fallback draws the solids under a translated path group and the zero', () => {
    const job = planned();
    const scene = jobScene(job, SCENE_COLORS, null);
    const full = analyseBytes(Uint8Array.from('G21 G90\nG0 X10 Y10\nG1 X20 F600\nM30\n', (c) => c.charCodeAt(0)), { dialect: 'tinyg-en', mode: 'full' }).result;
    const el = root(h(PreviewSvg, { segments: full.segments, showRapids: true, highlight: -1, envelope: null, scene: scene.layers, pathOffset: scene.pathOffset, zero: scene.zero }));
    expect(String(one(el, byAttr('data-preview', 'scene-bed')).props['d'])).toBe('M-10 20L740 20L740 -730L-10 -730Z');
    expect(one(el, byAttr('data-preview', 'scene-stock')).props['class']).toBe('pv-solid pv-stock');
    expect(one(el, byAttr('data-preview', 'path-group')).props['transform']).toBe('translate(0 20)');
    expect(all(el, byAttr('data-preview', 'zero'))).toHaveLength(1);
    const viewBox = String(one(el, (e) => e.tag === 'svg').props['viewBox']).split(' ').map(Number);
    expect(viewBox[0]).toBeLessThan(-10);
    expect((viewBox[0] as number) + (viewBox[2] as number)).toBeGreaterThan(740);
  });
});

describe('projects keep their jobs', () => {
  function harness(): { store: ProjectStore; deps: ProjectDeps } {
    const records = memoryRecordStore();
    let n = 0;
    const deps: ProjectDeps = { records, now: () => new Date(Date.parse('2026-11-03T10:00:00Z') + 1000 * ++n), newId: () => `id-${++n}`, hash: (b) => Promise.resolve(`h${b.byteLength}`.padEnd(64, '0')), encodeImage: () => Promise.reject(new Error('no')) };
    return { store: new ProjectStore(deps), deps };
  }

  it('two projects with different setups reopen correctly; a job that no longer reads is dropped, the rest kept', async () => {
    const { store, deps } = harness();
    const a = await store.create('Plate');
    const b = await store.create('Bracket');
    const c = clock();
    const ja = reviseJob(withSetup(newDraftJob(c), { stock: { ...SEED_SETUP.stock, width: 100 } }), { projectId: a.id, name: 'Plate job' }, c);
    const jb = reviseJob(withSetup(newDraftJob(c), { stock: { ...SEED_SETUP.stock, width: 250 } }), { projectId: b.id, name: 'Bracket job' }, c);
    await store.saveJob(ja);
    await store.saveJob(jb);
    await store.saveJob(reviseJob(ja, { name: 'Plate job 2' }, c));
    expect(store.find(a.id)?.jobs.map((j) => [j.name, j.setup.stock.width])).toEqual([['Plate job 2', 100]]);
    const again = new ProjectStore(deps);
    await again.load();
    expect(again.find(b.id)?.jobs[0]?.setup.stock.width).toBe(250);
    expect(again.find(a.id)?.jobs[0]?.revision).toBe(4);
    const stored = again.find(a.id);
    if (stored === null) throw new Error('no project');
    await deps.records.put('projects', a.id, { ...stored, jobs: [{ v: 1, id: 'junk' }, jb] });
    const third = new ProjectStore(deps);
    await third.load();
    expect(third.find(a.id)?.jobs.map((j) => j.name)).toEqual(['Bracket job']);
    expect(readProject({ ...a, jobs: undefined })?.jobs).toEqual([]);
    await expect(store.saveJob(newDraftJob(c))).rejects.toThrow('A draft job has no project.');
    await store.removeJob(b.id, jb.id);
    expect(store.find(b.id)?.jobs).toEqual([]);
  });
});

describe('the one job opener', () => {
  function deps(): { deps: OpenDeps; store: ProjectStore } {
    const { store } = (() => {
      const records = memoryRecordStore();
      let n = 0;
      const d: ProjectDeps = { records, now: () => new Date(Date.parse('2026-11-03T10:00:00Z') + 1000 * ++n), newId: () => `p${++n}`, hash: (b) => Promise.resolve(`h${b.byteLength}`.padEnd(64, '0')), encodeImage: () => Promise.reject(new Error('no')) };
      return { store: new ProjectStore(d) };
    })();
    return { store, deps: { projects: () => Promise.resolve(store), hash: (b) => Promise.resolve(`h${b.byteLength}`.padEnd(64, '0')), machine: () => machine(), clock: clock() } };
  }

  it('a project file opened from Projects or the picker is the same job; other bytes go to the draft, which keeps its setup', async () => {
    const { deps: d, store } = deps();
    executionLock.value = null;
    pendingOpen.value = null;
    draftJobStore.value.value = null;
    // The bench carries over: a fixture height chosen in the draft before the file is opened goes into the new job.
    activeJobStore.value.value = withSetup(newDraftJob(d.clock), { fixture: { ...sampleFixture(), height: 33 } });
    const p = await store.create('Plate');
    await store.add(p.id, [new File(['G0 X1\nG1 X2\n'], 'plate.nc')]);
    const file = store.find(p.id)?.files[0];
    if (file === undefined) throw new Error('no file');
    const fromProject = await openJob(new File(['G0 X1\nG1 X2\n'], 'plate.nc'), { kind: 'project', projectId: p.id, fileId: file.id }, d);
    if (!fromProject.ok) throw new Error(fromProject.reason);
    const job: Job = fromProject.job;
    expect(job.projectId).toBe(p.id);
    expect(job.machine?.id).toBe('m1');
    expect(job.setup.fixture?.height).toBe(33);
    expect(job.revision).toBe(1);
    expect(job.file).toEqual({ projectId: p.id, fileId: file.id, name: 'plate.nc', hash: file.hash, size: 12 });
    expect(store.find(p.id)?.jobs.map((j) => j.id)).toEqual([job.id]);
    expect(peek(pendingOpen)?.job.id).toBe(job.id);
    const fromPicker = await openJob(new File(['G0 X1\nG1 X2\n'], 'plate.nc'), { kind: 'picker' }, d);
    expect(fromPicker.ok ? fromPicker.job.id : fromPicker.reason).toBe(job.id);
    expect(activeJobStore.value.value?.id).toBe(job.id);
    // Other bytes: the local draft takes the file and keeps its setup from file to file.
    const other = await openJob(new File(['G0 X5\n'], 'other.nc'), { kind: 'picker' }, d);
    if (!other.ok) throw new Error(other.reason);
    const draft: Job = other.job;
    expect(draft.projectId).toBeNull();
    expect(draft.file?.name).toBe('other.nc');
    const third = await openJob(new File(['G0 X7\n'], 'third.nc'), { kind: 'sample' }, d);
    expect(third.ok ? third.job.id : third.reason).toBe(draft.id);
    expect(third.ok ? third.job.setup.stock : null).toEqual(draft.setup.stock);
    // Reopening a project job by id yields the same identity, from the stored bytes.
    const reopened = await openProjectJob(p.id, job.id, d);
    expect(reopened.ok ? reopened.job.id : reopened.reason).toBe(job.id);
    expect(peek(pendingOpen)?.file.name).toBe('plate.nc');
    expect((await openProjectJob(p.id, 'nope', d)).ok).toBe(false);
    resetReopen();
  });

  it('nothing replaces the preview while an execution owns it, whichever way the request came', async () => {
    const { deps: d, store } = deps();
    const p = await store.create('Plate');
    await store.add(p.id, [new File(['G0 X1\n'], 'a.nc')]);
    const file = store.find(p.id)?.files[0];
    pendingOpen.value = null;
    executionLock.value = 'Job running: the job owns the preview.';
    for (const source of [{ kind: 'picker' } as const, { kind: 'sample' } as const, { kind: 'project', projectId: p.id, fileId: file?.id ?? '' } as const]) {
      const r = await openJob(new File(['G0 X1\n'], 'a.nc'), source, d);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toContain('Stop the current job before opening another file');
    }
    expect(pendingOpen.value).toBeNull();
    executionLock.value = null;
  });

  it('closing clears the preview, preserves setup and saved jobs, and stays closed on reload', async () => {
    const { deps: d, store } = deps();
    executionLock.value = null;
    const p = await store.create('Bracket');
    await store.add(p.id, [new File(['G21 G0 X12\n'], 'bracket.cnc')]);
    const file = store.find(p.id)?.files[0];
    if (file === undefined) throw new Error('no file');
    const opened = await openProjectFile(p.id, file.id, d);
    if (!opened.ok) throw new Error(opened.reason);
    currentFile.value = { name: file.name, bytes: new TextEncoder().encode('G21 G0 X12\n') };
    await store.keepAside(DRAFT_FILE_KEY, new Blob(['old demo']));
    const closed = closeJob(d);
    await Promise.resolve();
    expect(await store.aside(DRAFT_FILE_KEY)).toBeNull();
    expect(closed.ok).toBe(true);
    expect(activeJobStore.value.value?.file).toBeNull();
    expect(activeJobStore.value.value?.projectId).toBeNull();
    expect(activeJobStore.value.value?.setup).toEqual(opened.job.setup);
    expect(pendingOpen.value).toBeNull();
    expect(currentFile.value).toBeNull();
    expect(currentPreview.value).toBeNull();
    expect(store.find(p.id)?.jobs[0]?.file?.name).toBe('bracket.cnc');
    resetReopen();
    expect(await reopenActiveJob(d)).toBeNull();
    const reopened = await openProjectFile(p.id, file.id, d);
    expect(reopened.ok && reopened.job.id).toBe(opened.job.id);
    expect(store.find(p.id)?.jobs).toHaveLength(1);
  });

  it('closing cancels an opener that is still reading a file; a late result cannot reopen it', async () => {
    const { deps: d } = deps();
    executionLock.value = null;
    let release!: (hash: string) => void;
    const hash = new Promise<string>((resolve) => { release = resolve; });
    const opening = openJob(new File(['G0 X9\n'], 'slow.nc'), { kind: 'picker' }, { ...d, hash: () => hash });
    expect(closeJob(d).ok).toBe(true);
    release('h6'.padEnd(64, '0'));
    expect(await opening).toEqual({ ok: false, reason: 'The file request was cancelled.' });
    expect(activeJobStore.value.value?.file).toBeNull();
    expect(pendingOpen.value).toBeNull();
  });

  it('neither running nor paused execution allows a close or a stored-file replacement', async () => {
    const { deps: d } = deps();
    const job = activeJobStore.value.value;
    for (const state of ['running', 'paused']) {
      executionLock.value = `Job ${state}.`;
      expect(closeJob(d).ok).toBe(false);
      expect((await openProjectFile('project', 'file', d)).ok).toBe(false);
      expect(activeJobStore.value.value).toBe(job);
    }
    executionLock.value = null;
  });

  it('a delayed draft cleanup cannot erase the next opened file', async () => {
    const { deps: d, store } = deps();
    executionLock.value = null;
    let release!: (projects: ProjectStore) => void;
    const projects = new Promise<ProjectStore>((resolve) => { release = resolve; });
    expect(closeJob({ ...d, projects: () => projects }).ok).toBe(true);
    expect((await openJob(new File(['G0 X8\n'], 'next.nc'), { kind: 'picker' }, d)).ok).toBe(true);
    release(store);
    await Promise.resolve();
    expect(await (await store.aside(DRAFT_FILE_KEY))?.text()).toBe('G0 X8\n');
  });
});

describe('Use in Job: roles and the drawing import', () => {
  it('roles follow the file: G-code opens, drawings become fixture, stock or bed, anything else is a reference', () => {
    expect(rolesFor({ name: 'plate.nc', role: 'gcode' })).toEqual(['gcode', 'reference']);
    expect(rolesFor({ name: 'fixture.svg', role: 'drawing' })).toEqual(['fixture', 'stock', 'bed', 'reference']);
    expect(rolesFor({ name: 'part.step', role: 'model' })).toEqual(['reference']);
    expect(rolesFor({ name: 'photo.pdf', role: 'other' })).toEqual(['reference']);
  });

  it('a bad or oversize drawing is refused with the reason and the stored file is untouched; units and scale apply before accepting', () => {
    const svg = '<svg><rect x="0" y="0" width="12" height="8"/><circle cx="2" cy="2" r="0.5"/><text>hi</text><path d="M0 0 C1 1 2 2 3 3 Z"/></svg>';
    const check = checkDrawing({ name: 'plate.svg', size: svg.length }, svg);
    expect(check.ok).toBe(true);
    if (!check.ok) throw new Error('refused');
    expect(check.parsed.skipped).toEqual({ text: 1, curves: 1 });
    expect(skippedText(check.parsed)).toBe('Not read: 1 text, 1 curves (drawn as straight chords).');
    const inches = scaled(check.parsed, 'in', 1);
    expect([inches.width, inches.depth]).toEqual([304.8, 203.2]);
    expect(inches.holes[0]?.[2]).toBe(12.7);
    expect(scaled(check.parsed, 'mm', 2).width).toBe(24);
    const big = checkDrawing({ name: 'huge.dxf', size: 21 * 1024 * 1024 }, '');
    expect(big.ok).toBe(false);
    expect(!big.ok && big.reason).toContain('The file stays in the project.');
    const empty = checkDrawing({ name: 'notes.svg', size: 10 }, '<svg><text>x</text></svg>');
    expect(!empty.ok && empty.reason).toContain('No closed outline or circle was found');
    const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'SPLINE', '10', '1', '0', 'LWPOLYLINE', '10', '0', '20', '0', '10', '10', '20', '0', '10', '10', '20', '5', '0', 'ENDSEC', '0', 'EOF'].join('\n');
    expect(parseDxfOutline(dxf).skipped).toEqual({ SPLINE: 1 });
    expect(parseSvgOutline('<svg><rect width="1" height="1"/><image href="x"/><use href="#a"/></svg>').skipped).toEqual({ image: 1, use: 1 });
  });

  it('accepting a fixture or stock outline changes the active job; a bed drawing needs the job’s machine and becomes its next bed revision', () => {
    const c = clock();
    machineStore.value.value = [machine()];
    activeJobStore.value.value = newDraftJob(c);
    const svg = '<svg><rect x="0" y="0" width="300" height="200"/><circle cx="25" cy="25" r="3"/></svg>';
    const file = { id: 'f1', name: 'plate.svg', size: svg.length, hash: 'a'.repeat(64), role: 'drawing' as const, note: '', addedAt: '' };
    const check = checkDrawing(file, svg);
    if (!check.ok) throw new Error('refused');
    const fixture = applyImport('fixture', file, check, { units: 'mm', scale: 1, height: 15, bedTopZ: 0 });
    expect(fixture.ok).toBe(true);
    // The sample fixture's position is kept (a replaced fixture stays where it was); the source is the stored file's.
    expect(activeJobStore.value.value?.setup.fixture).toMatchObject({ source: { file: 'plate.svg', kind: 'svg', hash: 'a'.repeat(64) }, height: 15, position: { x: 160, y: 120 } });
    const stock = applyImport('stock', file, check, { units: 'mm', scale: 1, height: 6, bedTopZ: 0 });
    expect(stock.ok).toBe(true);
    expect(activeJobStore.value.value?.setup.stockOutline?.outline).toHaveLength(4);
    expect(activeJobStore.value.value?.setup.stock).toMatchObject({ shape: 'sheet', width: 300, depth: 200, thickness: 6 });
    const noMachine = applyImport('bed', file, check, { units: 'mm', scale: 1, height: 19, bedTopZ: -60 });
    expect(noMachine.ok).toBe(false);
    expect(!noMachine.ok && noMachine.reason).toContain('Choose a machine');
    activeJobStore.value.value = withMachine(activeJobStore.value.value as Job, machine());
    const bed = applyImport('bed', file, check, { units: 'in', scale: 1, height: 19, bedTopZ: -60 });
    expect(bed.ok).toBe(true);
    const m = machineStore.value.value[0];
    expect(m?.bed).toMatchObject({ revision: 1, width: 7620, depth: 5080, thickness: 19, toMachine: { x: 0, y: 0, z: -60 }, source: { kind: 'drawing', file: 'plate.svg', hash: 'a'.repeat(64), units: 'in', scale: 1 } });
    expect(activeJobStore.value.value?.setup.bed.revision).toBe(1);
    expect(activeJobStore.value.value?.setup.bedFrom).toBe('machine');
    expect(activeJobStore.value.value?.machine?.revision).toBe(2);
    activeJobStore.value.value = null;
    machineStore.value.value = [];
  });
});
