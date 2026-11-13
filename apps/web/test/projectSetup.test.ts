import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { JobSetupPanel } from '../src/workspace/views/SetupView.ts';
import { activeJobStore, withSetup } from '../src/workspace/jobModel.ts';
import { describe, expect, it } from 'vitest';
import { BUILTIN_MATERIALS } from '@synthetos/library';
import { EMPTY_SETUP, type Project } from '../src/projects/store.ts';
import { projectSetupForJob, setupDescription } from '../src/projects/setupForJob.ts';
import { chooseProjectSetup, pendingSetupChoice } from '../src/projects/setupChoice.ts';
import { newDraftJob } from '../src/workspace/jobModel.ts';
import type { MachineProfile } from '../src/workspace/library.ts';
const clock = { now: () => new Date('2026-11-13'), newId: () => 'job' };
const machine: MachineProfile = { id: 'mill', name: 'My mill', templateId: 'custom', drive: 'screw', travel: { x: 400, y: 400, z: 100 }, spindle: '', createdAt: '', revision: 2 };
const hardwood = BUILTIN_MATERIALS.find(m => m.id === 'builtin.hardwood')!;
const records = { machines: [machine], materials: BUILTIN_MATERIALS };
const project = (setup: Project['setup']): Project => ({ v: 1, id: 'p', name: 'Bracket', description: '', cover: null, images: [], files: [], links: [], setup, jobs: [], tags: [], createdAt: '', updatedAt: '' });
describe('project setup resolution', () => {
  it('applies machine, actual stock dimensions and material', () => {
    const job = newDraftJob(clock);
    const result = projectSetupForJob(project({ ...EMPTY_SETUP, machine: { id: machine.id, name: machine.name, version: 2 }, stock: { id: 'stock', name: 'Block 90 × 80 × 10 mm' }, stockSnapshot: { ...job.setup.stock, width: 90, depth: 80, thickness: 10 }, material: { id: hardwood.id, name: hardwood.name, version: hardwood.version } }), job, records, clock);
    expect(result.job.machine).toMatchObject({ id: machine.id, revision: 2 });
    expect(result.job.setup.stock).toMatchObject({ width: 90, depth: 80, thickness: 10, materialRef: { id: hardwood.id, version: hardwood.version } });
    expect(result.note).toBe('From project Bracket: Hardwood (oak, maple), Block 90 × 80 × 10 mm, My mill.');
    expect(result.differs).toBe(true);
  });
  it('applies a partial setup and preserves unspecified choices', () => {
    const job = newDraftJob(clock);
    expect(job.setup.stock.materialRef.id).toBe('builtin.mdf');
    const result = projectSetupForJob(project({ ...EMPTY_SETUP, material: { id: hardwood.id, name: hardwood.name } }), job, records, clock);
    expect(result.job.setup.stock.width).toBe(job.setup.stock.width);
    expect(result.job.machine).toBeNull();
    expect(result.job.setup.stock.materialRef.id).toBe(hardwood.id);
  });
  it('names deleted and older records and description-only stock, never guessing', () => {
    const job = newDraftJob(clock);
    const result = projectSetupForJob(project({ ...EMPTY_SETUP, machine: { id: machine.id, name: 'Old mill', version: 1 }, material: { id: hardwood.id, version: 999, name: 'Old hardwood' }, stock: { id: 'stock', name: 'Old block' } }), job, records, clock);
    expect(result.job).toBe(job);
    expect(result.note).toContain('Old hardwood (recorded version unavailable)');
    expect(result.note).toContain('Old mill (recorded version unavailable)');
    expect(result.note).toContain('Old block (dimensions not recorded)');
    expect(setupDescription(job, { machines: [], materials: [] })).toContain('unavailable');
  });
  it('an empty project does not change the job or emit a misleading note', () => {
    const job = newDraftJob(clock);
    expect(projectSetupForJob(project(EMPTY_SETUP), job, records, clock)).toEqual({ job, differs: false, note: '' });
  });
  it('asks once and cancels an obsolete choice', async () => {
    const old = chooseProjectSetup('Hardwood', 'Aluminium');
    const current = chooseProjectSetup('Hardwood', 'MDF');
    expect(await old).toBe('cancel');
    expect(pendingSetupChoice.value?.job).toBe('MDF');
    pendingSetupChoice.value?.answer('project');
    expect(await current).toBe('project');
    expect(pendingSetupChoice.value).toBeNull();
  });
});

it('a missing material cannot silently display the first option (Aluminium)', () => {
  const before = activeJobStore.value.value;
  const job = newDraftJob(clock);
  try {
    activeJobStore.value.value = withSetup(job, { stock: { ...job.setup.stock, materialRef: { id: 'deleted-hardwood', version: 2 } } }, clock);
    const html = renderToString(h(JobSetupPanel, { step: 'stock', locked: false, onView: () => undefined }));
    expect(html).toContain('selected value="missing/deleted-hardwood/2"');
    expect(html).toContain('deleted-hardwood version 2 (unavailable)');
  } finally { activeJobStore.value.value = before; }
});
