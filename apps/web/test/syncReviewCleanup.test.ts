import { afterEach, expect, it, vi } from 'vitest';
import type { Project } from '@synthetos/library';
import { RecordsError } from '../src/cloud/recordsClient.ts';
import { emptyCache, readCache, saveCache } from '../src/workspace/cloud/cloudCache.ts';
import { startProjectSync } from '../src/workspace/cloud/projectSync.ts';
import { syncRunner } from '../src/workspace/cloud/syncRunner.ts';
import { drainQueue, enqueue } from '../src/workspace/cloud/syncQueue.ts';
import { api, at, machine, memory, project, projectContext, record } from './syncFixtures.ts';

const stops: (() => void)[] = [];
afterEach(() => { for (const stop of stops.splice(0)) stop(); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function withFiles(): Project {
  return { ...project(), files: [{ id: 'f1', name: 'old.nc', hash: 'a'.repeat(64), size: 3, role: 'gcode', note: '', addedAt: at }],
    images: [{ id: 'i1', name: 'old.webp', hash: 'b'.repeat(64), size: 4, width: 2, height: 2, addedAt: at }], cover: 'i1' };
}
it('drains an edit queued during file DELETE before reporting saved (review repro 3)', async () => {
  const context = projectContext(); const cache = emptyCache(); cache.fileDeletes = ['a'.repeat(64)];
  const storage = memory(); const held = deferred(); const started = deferred(); const statuses: string[] = [];
  vi.mocked(context.files.remove).mockImplementation(async () => { started.resolve(); await held.promise; });
  const hooks = { persist: () => saveCache(storage, 'alice', cache), change: vi.fn(), notice: vi.fn() };
  const projects = startProjectSync({ subject: 'alice', context, cache, allowed: () => true, ...hooks }); stops.push(projects.stop);
  const client = api(); const scheduled = vi.fn(() => 1);
  const runner = syncRunner({ cache, client, allowed: () => true, hooks, cleanup: projects.cleanup, status: value => { statuses.push(value); }, unavailable: vi.fn(), setTimeout: scheduled, clearTimeout: vi.fn() }); stops.push(runner.stop);
  runner.wake(); await started.promise;
  enqueue(cache, 'machine', machine.id, machine); runner.wake();
  expect(statuses).not.toContain('saved'); expect(client.put).not.toHaveBeenCalled();
  held.resolve(); await vi.waitFor(() => expect(statuses.at(-1)).toBe('saved'));
  expect(client.put).toHaveBeenCalledOnce(); expect(cache.pending).toEqual([]); expect(scheduled).not.toHaveBeenCalled();
  expect(readCache(storage, 'alice').records[0]?.content).toEqual(machine);
});
it.each(['remove', 'replace'])('remembers removed file and image hashes on %s before archiving the project (review repro 4)', async action => {
  const old = withFiles(); const cache = emptyCache(); cache.records = [record('project', old)]; const storage = memory();
  const next: Project = action === 'remove' ? { ...old, files: [], images: [], cover: null } : {
    ...old, files: [{ ...old.files[0]!, hash: 'c'.repeat(64) }], images: [{ ...old.images[0]!, hash: 'd'.repeat(64) }],
  };
  const hooks = { persist: () => saveCache(storage, 'alice', cache), change: vi.fn(), notice: vi.fn() }; const client = api();
  vi.mocked(client.put).mockImplementation(async () => {
    expect(readCache(storage, 'alice').fileDeletes).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
    return record('project', next, 2);
  });
  enqueue(cache, 'project', old.id, next);
  expect(await drainQueue(cache, client, () => true, new AbortController().signal, hooks)).toBe('saved');
  expect(cache.fileDeletes).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  vi.mocked(client.archive).mockResolvedValue({ ...record('project', next, 3), archivedAt: 1 });
  enqueue(cache, 'project', old.id, null);
  expect(await drainQueue(cache, client, () => true, new AbortController().signal, hooks)).toBe('saved');
  expect(cache.fileDeletes).toEqual(action === 'remove' ? ['a'.repeat(64), 'b'.repeat(64)] : ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)]);
});
it('keeps cleanup candidates when a pending upload is superseded before its record is saved', async () => {
  const cache = emptyCache(); const old = withFiles(); const next = { ...old, files: [], images: [], cover: null };
  enqueue(cache, 'project', old.id, old); enqueue(cache, 'project', old.id, next);
  const client = api();
  expect(await drainQueue(cache, client, () => true, new AbortController().signal, { persist: () => true, change: vi.fn(), notice: vi.fn() })).toBe('saved');
  expect(client.put).toHaveBeenCalledOnce(); expect(cache.fileDeletes).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
});
it.each(['delete', 'replace'])('skips an obsolete legacy image when the project changes during hashing: %s', async action => {
  const context = projectContext(); const raw = context.records; const cache = emptyCache();
  const held = deferred(); const started = deferred(); const oldBlob = new Blob(['old legacy image']);
  const newBlob = new Blob(['replacement image']);
  await raw.put('blobs', 'legacy-image', oldBlob); await raw.put('blobs', 'replacement-image', newBlob);
  const image = { id: 'legacy-image', name: 'legacy.webp', size: oldBlob.size, width: 2, height: 2, addedAt: at };
  const old = { ...project(), images: [image], cover: image.id };
  const replacement = { ...old, images: [{ ...image, id: 'replacement-image', size: newBlob.size }], cover: 'replacement-image' };
  let paused = false;
  const records = { ...raw, async get(kind: Parameters<typeof raw.get>[0], id: string) {
    if (kind === 'blobs' && id === image.id && !paused) { paused = true; started.resolve(); await held.promise; }
    return raw.get(kind, id);
  } };
  const hooks = { persist: () => true, change: vi.fn(), notice: vi.fn() };
  const sync = startProjectSync({ subject: 'alice', context: { ...context, records }, cache, allowed: () => true, ...hooks }); stops.push(sync.stop);
  const client = api(); enqueue(cache, 'project', old.id, old);
  const signal = new AbortController().signal;
  const draining = drainQueue(cache, client, () => true, signal, { ...hooks, prepare: sync.prepare });
  await started.promise; enqueue(cache, 'project', old.id, action === 'delete' ? null : replacement); held.resolve();
  expect(await draining).toBe('saved'); await sync.cleanup(signal);
  expect(cache.pending).toEqual([]); expect(cache.fileDeletes ?? []).toEqual([]);
  expect(context.files.remove).not.toHaveBeenCalled(); expect(hooks.notice).not.toHaveBeenCalled();
  if (action === 'delete') {
    expect(context.files.put).not.toHaveBeenCalled(); expect(client.put).not.toHaveBeenCalled();
  } else {
    expect(context.files.put).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^[a-f0-9]{64}$/), newBlob, signal);
    expect(client.put).toHaveBeenCalledOnce();
    expect(cache.records[0]?.content).toMatchObject({ images: [{ id: 'replacement-image', hash: expect.any(String) }] });
  }
});
it.each([false, true])('collects files after a lost archive response and reload (refresh archived head: %s; review repro 6)', async refreshed => {
  const old = withFiles(); const initial = emptyCache(); initial.records = [record('project', old)];
  const storage = memory(); const client = api(); const notice = vi.fn();
  vi.mocked(client.archive).mockRejectedValueOnce(new RecordsError(502));
  enqueue(initial, 'project', old.id, null);
  expect(await drainQueue(initial, client, () => true, new AbortController().signal, { persist: () => saveCache(storage, 'alice', initial), change: vi.fn(), notice })).toBe('retry');
  const reloaded = readCache(storage, 'alice'); const archived = { ...record('project', old, 2), archivedAt: 1 };
  if (refreshed) reloaded.records = [archived];
  // Exercise accept's bookkeeping independently of candidates already remembered before the lost request.
  reloaded.fileDeletes = [];
  vi.mocked(client.archive).mockRejectedValueOnce(new RecordsError(409, archived));
  expect(await drainQueue(reloaded, client, () => true, new AbortController().signal, { persist: () => saveCache(storage, 'alice', reloaded), change: vi.fn(), notice })).toBe('saved');
  expect(reloaded.pending).toEqual([]); expect(reloaded.fileDeletes).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  expect(readCache(storage, 'alice').fileDeletes).toEqual(reloaded.fileDeletes); expect(notice).not.toHaveBeenCalled();
});
it('retains a new edit queued while an already-applied archive response arrives', async () => {
  const old = withFiles(); const cache = emptyCache(); cache.records = [record('project', old)]; const client = api();
  enqueue(cache, 'project', old.id, null);
  vi.mocked(client.archive).mockImplementation(async () => {
    enqueue(cache, 'project', old.id, { ...old, name: 'Restored' });
    throw new RecordsError(409, { ...record('project', old, 2), archivedAt: 1 });
  });
  expect(await drainQueue(cache, client, () => true, new AbortController().signal, { persist: () => true, change: vi.fn(), notice: vi.fn() })).toBe('saved');
  expect(client.put).toHaveBeenCalledWith('project', old.id, 2, expect.objectContaining({ name: 'Restored' }), expect.any(AbortSignal));
  expect(cache.records[0]?.content).toMatchObject({ name: 'Restored' });
});
