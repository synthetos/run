import { afterEach, expect, it, vi } from 'vitest';
import type { RecordKind } from '@synthetos/contracts';
import { BUILTIN_MATERIALS } from '@synthetos/library';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import { filesClient, FilesError } from '../src/cloud/filesClient.ts';
import { RecordsError } from '../src/cloud/recordsClient.ts';
import { stored, loadStoredLibraries } from '../src/workspace/storage.ts';
import { emptyCache, readCache, saveCache } from '../src/workspace/cloud/cloudCache.ts';
import { fromRecords, toRecords, browserCopy } from '../src/workspace/cloud/libraryRecords.ts';
import { startLibrarySync, librarySyncActions, librarySyncView } from '../src/workspace/cloud/librarySync.ts';
import { drainQueue, enqueue, visibleRecords } from '../src/workspace/cloud/syncQueue.ts';
import { api, machine, memory, project, projectContext, record } from './syncFixtures.ts';
const stops: (() => void)[] = [];
afterEach(() => { for (const stop of stops.splice(0)) stop(); });
function localBindings(storage = memory(), machines: unknown[] = [machine]) {
  for (const name of ['tools.v2', 'materials.v2', 'materials.own.v1']) stored(name, [], (v): v is unknown[] => Array.isArray(v), () => storage);
  const profiles = stored('machines', machines, (v): v is unknown[] => Array.isArray(v), () => storage);
  loadStoredLibraries(); return profiles;
}
it('round-trips four kinds through persisted cache and the queue', async () => {
  const cache = emptyCache(); const storage = memory(); const client = api();
  const values = { tool: SEED_TOOLS[0]!.tool, material: BUILTIN_MATERIALS[0]!, machine, project: project() };
  for (const kind of Object.keys(values) as RecordKind[]) enqueue(cache, kind, values[kind].id, values[kind]);
  saveCache(storage, 'a', cache); const loaded = readCache(storage, 'a'); expect(loaded.pending).toHaveLength(4);
  expect(await drainQueue(loaded, client, () => true, new AbortController().signal, { persist: () => true, change: vi.fn(), notice: vi.fn() })).toBe('saved');
  expect(visibleRecords(loaded).map(r => r.kind)).toEqual(['tool', 'material', 'machine', 'project']);
});
it('merges account machines by id while keeping local-only and rejected profiles', () => {
  const invalid = { ...machine, id: 'invalid', spindle: 42 };
  const records = toRecords('machines', [machine, invalid]); expect(records).toHaveLength(1);
  expect(fromRecords('machines', [{ ...records[0]!, content: { ...machine, name: 'Account' } }], [machine, invalid])).toEqual([invalid, { ...machine, name: 'Account' }]);
  expect(browserCopy(machine, 'copy.one')).toMatchObject({ name: 'My router (from this browser)' });
});
it('not now leaves machines and projects local; consent uses one prompt with all counts', async () => {
  const storage = memory(); const profiles = localBindings(storage); const context = projectContext(); await context.local.create('Local plate'); const client = api();
  const sync = startLibrarySync({ subject: 'counts', display: '@a', storage, client, projects: context, allowed: () => true, setTimeout: () => 1, clearTimeout: () => {} }); stops.push(sync.stop);
  await vi.waitFor(() => expect(client.list).toHaveBeenCalledTimes(4));
  expect(librarySyncView.value).toMatchObject({ ask: true, counts: { tool: 0, material: 0, machine: 1, project: 1 } });
  librarySyncActions.notNow(); profiles.set([{ ...machine, name: 'Still local' }]);
  expect(client.put).not.toHaveBeenCalled(); expect(context.files.put).not.toHaveBeenCalled();
  await librarySyncActions.copy(); await vi.waitFor(() => expect(librarySyncView.value.status).toBe('saved'));
  expect(client.put).toHaveBeenCalledWith('machine', machine.id, null, expect.objectContaining({ name: 'Still local' }), expect.any(AbortSignal));
  expect(client.put).toHaveBeenCalledWith('project', expect.any(String), null, expect.objectContaining({ name: 'Local plate' }), expect.any(AbortSignal));
});
it('names refused machine profiles and keeps them local through account activity', async () => {
  const storage = memory(); const invalid = { ...machine, spindle: 42 }; const profiles = localBindings(storage, [invalid]); const client = api();
  const sync = startLibrarySync({ subject: 'refused', display: '@a', storage, client, allowed: () => true, setTimeout: () => 1, clearTimeout: () => {} }); stops.push(sync.stop);
  await vi.waitFor(() => expect(client.list).toHaveBeenCalledTimes(4));
  expect(librarySyncView.value.notice).toContain('Not saved to your account: My router'); expect(profiles.value.value).toEqual([invalid]); expect(client.put).not.toHaveBeenCalled();
  sync.stop(); expect(profiles.value.value).toEqual([invalid]);
});
it('keeps both machines after a concurrent edit', async () => {
  const cache = emptyCache(); const client = api(); const latest = { ...machine, name: 'Remote' };
  cache.records = [record('machine', machine)]; enqueue(cache, 'machine', machine.id, machine);
  vi.mocked(client.put).mockRejectedValueOnce(new RecordsError(409, record('machine', latest, 2)));
  expect(await drainQueue(cache, client, () => true, new AbortController().signal, { persist: () => true, change: vi.fn(), notice: vi.fn() })).toBe('saved');
  expect(visibleRecords(cache).map(r => r.content.name)).toEqual(['Remote', 'My router (from this browser)']);
});
it('files client sends same-origin bytes and distinguishes busy from in-use deletion', async () => {
  const hash = 'a'.repeat(64); const blob = new Blob(['bytes']); const signal = new AbortController().signal;
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 201 })); const files = filesClient(fetch);
  await files.put(hash, blob, signal);
  expect(fetch).toHaveBeenCalledWith(`/api/files/${hash}`, expect.objectContaining({ method: 'PUT', body: blob, signal, credentials: 'same-origin', redirect: 'error', headers: { 'content-type': 'application/octet-stream', 'x-synthetos-request': '1' } }));
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'busy' }, { status: 409 })); await expect(files.remove(hash, signal)).rejects.toMatchObject({ reason: 'busy' });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'in_use' }, { status: 409 })); await expect(files.remove(hash, signal)).resolves.toBeUndefined();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ files: [{ sha256: hash, size: 5, createdAt: 1 }] })); expect(await files.list(signal)).toHaveLength(1);
  vi.mocked(fetch).mockResolvedValueOnce(new Response(blob)); expect((await files.get(hash, signal)).size).toBe(5);
  await expect(files.get('bad', signal)).rejects.toBeInstanceOf(FilesError);
});
