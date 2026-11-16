import { afterEach, expect, it } from 'vitest';
import { makeProjectStore } from '../src/projects/browserStore.ts';
import { sha256Hex } from '../src/projects/image.ts';
import { openProjectJob, pendingOpen } from '../src/workspace/fileBridge.ts';
import { activeJobStore, jobPersistence, SEED_JOB } from '../src/workspace/jobModel.ts';
import { emptyCache, readCache, saveCache } from '../src/workspace/cloud/cloudCache.ts';
import { projectRecords } from '../src/workspace/cloud/projectRecords.ts';
import { enqueue } from '../src/workspace/cloud/syncQueue.ts';
import { at, machine, memory, project, projectContext } from './syncFixtures.ts';
import { projectZip, zipFixture } from './zipFixtures.ts';

afterEach(() => { jobPersistence.value = null; pendingOpen.value = null; activeJobStore.value.value = null; });
it.each(['a', '9._-', 'a'.repeat(64)])('keeps valid id %s and Unicode file names through account cache reload', async id => {
  const { p, blobs } = await zipFixture(); const context = projectContext(); const cache = emptyCache(); const storage = memory();
  enqueue(cache, 'machine', machine.id, machine);
  const records = projectRecords({ subject: 'alice', records: context.records, cache, active: () => true,
    persist: () => saveCache(storage, 'alice', cache), change: () => {}, notice: () => {},
  });
  const imported = await makeProjectStore(records).importZip(await projectZip({ ...p, id }, blobs), { validateImage: async () => {} });
  const reloaded = readCache(storage, 'alice'); expect(reloaded.pending).toHaveLength(2);
  expect(reloaded.pending.find(p => p.kind === 'project')?.content).toEqual(imported);
  expect(reloaded.pending.find(p => p.kind === 'machine')?.content).toEqual(machine);
  expect(imported.files[0]?.name).toBe('切削 plate.nc');
});
it.each(['UPPER', 'my project', 'x'.repeat(65)])('refuses incompatible project id %s without losing unrelated pending edits on reload', async id => {
  const { p, blobs } = await zipFixture(); const context = projectContext(); const cache = emptyCache(); const storage = memory();
  enqueue(cache, 'machine', machine.id, machine); expect(saveCache(storage, 'alice', cache)).toBe(true);
  const before = readCache(storage, 'alice');
  const records = projectRecords({ subject: 'alice', records: context.records, cache, active: () => true,
    persist: () => saveCache(storage, 'alice', cache), change: () => {}, notice: () => {},
  });
  const store = makeProjectStore(records);
  await expect(store.importZip(await projectZip({ ...p, id }, blobs), { validateImage: async () => {} })).rejects.toThrow(/project id/);
  expect(readCache(storage, 'alice')).toEqual(before); expect(cache.pending).toEqual(before.pending);
  expect(await context.records.keys('projects')).toEqual([]); expect(await context.records.keys('blobs')).toEqual([]);
});
it.each(['victim', null])('binds imported jobs with project reference %s before opening and persistence', async foreign => {
  const { p, blobs } = await zipFixture(); const context = projectContext(); const store = context.local;
  const original = { ...SEED_JOB, id: 'existing-job', projectId: 'victim', name: 'Original job' };
  const victim = { ...project('victim'), jobs: [original] };
  await context.records.put('projects', victim.id, victim); await store.load();
  const file = p.files[0]!;
  const incoming = { ...p, id: 'incoming', jobs: [{ ...original, projectId: foreign, name: 'Imported job',
    file: { projectId: foreign, fileId: file.id, name: file.name, size: file.size, hash: file.hash },
  }] };
  const imported = await store.importZip(await projectZip(incoming, blobs), { validateImage: async () => {} });
  let persisted: Promise<unknown> | undefined;
  jobPersistence.value = job => { persisted = store.saveJob(job); return persisted.then(() => true); };
  const opened = await openProjectJob(imported.id, original.id, { projects: async () => store, hash: sha256Hex, machine: () => null,
    clock: { now: () => new Date(at), newId: () => 'opened-job' },
  });
  expect(opened.ok).toBe(true); expect(persisted).toBeDefined(); await persisted;
  expect(store.find('victim')?.jobs).toEqual([original]);
  expect(await context.records.get('projects', 'victim')).toEqual(victim);
  expect(imported.jobs[0]?.projectId).toBe('incoming'); expect(imported.jobs[0]?.file?.projectId).toBe('incoming');
  expect(store.find('incoming')?.jobs[0]).toMatchObject({ projectId: 'incoming', file: { projectId: 'incoming' }, name: 'Imported job' });
  if (opened.ok) expect(opened.job.projectId).toBe('incoming');
});
