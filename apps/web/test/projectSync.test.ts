import { afterEach, describe, expect, it, vi } from 'vitest';
import { readProject, type Project } from '@synthetos/library';
import { FilesError } from '../src/cloud/filesClient.ts';
import { RecordsError } from '../src/cloud/recordsClient.ts';
import { projectStore } from '../src/projects/browserStore.ts';
import { sha256Hex } from '../src/projects/image.ts';
import { emptyCache, readCache, saveCache } from '../src/workspace/cloud/cloudCache.ts';
import { startProjectSync } from '../src/workspace/cloud/projectSync.ts';
import { accountProjects, projectDownload } from '../src/workspace/cloud/projectSyncState.ts';
import { drainQueue, enqueue, visibleRecords } from '../src/workspace/cloud/syncQueue.ts';
import { api, at, filesApi, memory, project, projectContext, record } from './syncFixtures.ts';
const stops: (() => void)[] = [];
afterEach(() => { for (const stop of stops.splice(0)) stop(); });
async function harness() {
  const context = projectContext(); const p = await context.local.create('Plate');
  await context.local.add(p.id, [new File(['G0 X1'], 'plate.nc')]);
  const cache = emptyCache(); const storage = memory(); const client = api(); const notice = vi.fn();
  const persist = () => saveCache(storage, 'alice', cache);
  let allowed = true;
  const sync = startProjectSync({ subject: 'alice', context, cache, allowed: () => allowed, persist, change: vi.fn(), notice }); stops.push(sync.stop);
  const hooks = { persist, change: sync.show, notice, prepare: sync.prepare };
  return { context, cache, storage, client, notice, sync, hooks, p: context.local.find(p.id)!, pause: () => { allowed = false; sync.wake(); }, drain: () => drainQueue(cache, client, () => allowed, new AbortController().signal, hooks) };
}
describe('project queue', () => {
  it('uploads bytes before the record and retains the queue across reload', async () => {
    const h = await harness(); const order: string[] = [];
    vi.mocked(h.context.files.put).mockImplementation(async () => { order.push('file'); });
    vi.mocked(h.client.put).mockImplementation(async (kind, _id, _parent, content) => { order.push('record'); return record(kind, content as typeof h.p); });
    enqueue(h.cache, 'project', h.p.id, h.p);
    expect(await h.drain()).toBe('saved'); expect(order).toEqual(['file', 'record']);
    expect(readCache(h.storage, 'alice').records[0]?.content).toEqual(h.p);
  });
  it.each([[409, 'busy', 'retry'], [413, 'quota', 'quota'], [422, 'mismatch', 'refused'], [502, 'failed', 'retry']] as const)('keeps the record pending when files return %s', async (status, reason, result) => {
    const h = await harness(); vi.mocked(h.context.files.put).mockRejectedValueOnce(new FilesError(status, reason));
    enqueue(h.cache, 'project', h.p.id, h.p);
    expect(await h.drain()).toBe(result); expect(h.client.put).not.toHaveBeenCalled(); expect(h.cache.pending).toHaveLength(1);
    if (status === 422) expect(h.notice).toHaveBeenCalledWith(expect.stringContaining('plate.nc'));
    expect(await h.drain()).toBe('saved'); expect(h.cache.pending).toEqual([]);
  });
  it('pauses between the file and record and retains the pending project', async () => {
    const h = await harness(); vi.mocked(h.context.files.put).mockImplementation(async () => { h.pause(); });
    enqueue(h.cache, 'project', h.p.id, h.p); expect(await h.drain()).toBe('saving');
    expect(h.client.put).not.toHaveBeenCalled(); expect(h.cache.pending).toHaveLength(1);
  });
  it('hashes existing images from stored WebP bytes and validates optional hashes', async () => {
    const h = await harness(); const blob = new Blob(['legacy-webp']);
    const image = { id: 'image.one', name: 'photo.webp', size: blob.size, width: 2, height: 2, addedAt: at };
    await h.context.records.put('blobs', image.id, blob);
    enqueue(h.cache, 'project', h.p.id, { ...h.p, images: [image], cover: image.id });
    expect(await h.drain()).toBe('saved');
    const content = h.cache.records[0]!.content as typeof h.p;
    expect(content.images[0]?.hash).toBe(await sha256Hex(await blob.arrayBuffer()));
    expect(readProject(content).ok).toBe(true);
    expect(readProject({ ...content, images: [{ ...image, hash: 'bad' }] }).ok).toBe(false);
  });
  it('hashes newly encoded images immediately in ProjectStore', async () => {
    const { local } = projectContext(); const p = await local.create('Photos');
    await local.add(p.id, [new File(['original'], 'photo.jpg', { type: 'image/jpeg' })]);
    expect(local.find(p.id)?.images[0]?.hash).toBe(await sha256Hex(await new Blob(['webp']).arrayBuffer()));
  });
  it('preserves both project versions on conflict and archives before garbage collection', async () => {
    const h = await harness(); const remote = { ...h.p, name: 'Account plate' }; h.cache.records = [record('project', remote)];
    vi.mocked(h.client.put).mockRejectedValueOnce(new RecordsError(409, record('project', remote, 2)));
    enqueue(h.cache, 'project', h.p.id, h.p); expect(await h.drain()).toBe('saved');
    expect(visibleRecords(h.cache).map(r => (r.content as Project).name)).toEqual(['Account plate', 'Plate (from this browser)']);
    vi.mocked(h.client.archive).mockImplementation(async () => ({ ...record('project', remote, 3), archivedAt: 1 }));
    enqueue(h.cache, 'project', h.p.id, null); expect(await h.drain()).toBe('saved');
    expect(h.context.files.remove).not.toHaveBeenCalled(); expect(h.cache.fileDeletes).toEqual([h.p.files[0]!.hash]);
    await h.sync.cleanup(new AbortController().signal); expect(h.context.files.remove).toHaveBeenCalledWith(h.p.files[0]!.hash, expect.any(AbortSignal));
    expect(readCache(h.storage, 'alice').fileDeletes).toEqual([]);
  });
});
describe('account project downloads', () => {
  it('lists metadata without a GET, downloads on open, and isolates bytes by account', async () => {
    const context = projectContext(); const cache = emptyCache(); const blob = new Blob(['cloud']); const hash = await sha256Hex(await blob.arrayBuffer());
    const p = { ...project(), files: [{ id: 'remote.file', name: 'cloud.nc', size: blob.size, hash, role: 'gcode' as const, note: '', addedAt: at }] };
    cache.records = [record('project', p)]; vi.mocked(context.files.get).mockResolvedValue(blob);
    const sync = startProjectSync({ subject: 'alice', context, cache, allowed: () => true, persist: () => true, change: vi.fn(), notice: vi.fn() }); stops.push(sync.stop);
    sync.show(); await vi.waitFor(() => expect(accountProjects.value).toEqual([p.id]));
    expect(context.files.get).not.toHaveBeenCalled();
    await projectDownload.open(p.id); expect(accountProjects.value).toEqual([]);
    expect(await (await projectStore()).blob('remote.file')).toEqual(blob);
    expect(await context.records.get('blobs', 'remote.file')).toBeUndefined();
    expect(await context.records.get('blobs', 'account/alice/remote.file')).toEqual(blob);
    sync.stop();
    const bob = startProjectSync({ subject: 'bob', context: { ...context, files: filesApi() }, cache: emptyCache(), allowed: () => true, persist: () => true, change: vi.fn(), notice: vi.fn() }); stops.push(bob.stop);
    bob.show(); await vi.waitFor(async () => expect((await projectStore()).list).toEqual([]));
    expect(await (await projectStore()).blob('remote.file')).toBeNull();
  });
  it('rejects mismatching downloaded bytes before writing them', async () => {
    const h = await harness(); const remote = { ...h.p, id: 'remote.project', files: h.p.files.map(f => ({ ...f, id: 'remote.file' })) };
    h.cache.records = [record('project', remote)]; vi.mocked(h.context.files.get).mockResolvedValue(new Blob(['wrong'])); h.sync.show();
    await vi.waitFor(() => expect(accountProjects.value).toContain(remote.id));
    await expect(projectDownload.open(remote.id)).rejects.toBeInstanceOf(FilesError);
    expect(await h.context.records.get('blobs', 'account/alice/remote.file')).toBeUndefined();
  });
});

it('collects uploaded files when a new project is removed before its record PUT', async () => {
  const h = await harness();
  vi.mocked(h.context.files.put).mockImplementation(async () => { enqueue(h.cache, 'project', h.p.id, null); });
  enqueue(h.cache, 'project', h.p.id, h.p);
  expect(await h.drain()).toBe('saved'); expect(h.client.put).not.toHaveBeenCalled();
  expect(h.cache.fileDeletes).toEqual([h.p.files[0]!.hash]);
  await h.sync.cleanup(new AbortController().signal); expect(h.context.files.remove).toHaveBeenCalledOnce();
});
it('does not expose account drafts through the local ProjectStore', async () => {
  const context = projectContext();
  await context.records.put('projects', 'account/alice/secret', project('secret'));
  await context.records.put('projects', 'download/alice/secret', 'metadata marker');
  await context.local.load(); expect(context.local.list).toEqual([]);
});
it('does not publish a stale record when edited while its file upload is in flight', async () => {
  const h = await harness(); let edited = false;
  vi.mocked(h.context.files.put).mockImplementation(async () => {
    if (!edited) { edited = true; enqueue(h.cache, 'project', h.p.id, { ...h.p, name: 'Latest name' }); }
  });
  enqueue(h.cache, 'project', h.p.id, h.p); expect(await h.drain()).toBe('saved');
  expect(h.client.put).toHaveBeenCalledOnce(); expect(h.cache.records[0]?.content).toMatchObject({ name: 'Latest name' });
});
it('does not mark a local-id collision downloaded when the account names different files', async () => {
  const h = await harness(); const remote = { ...h.p, files: [{ ...h.p.files[0]!, id: 'other.file', hash: 'b'.repeat(64) }] };
  h.cache.records = [record('project', remote)]; h.sync.show();
  await vi.waitFor(() => expect(accountProjects.value).toContain(remote.id));
  expect(h.context.files.get).not.toHaveBeenCalled();
});
