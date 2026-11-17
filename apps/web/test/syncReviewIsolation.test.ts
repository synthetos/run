import { afterEach, expect, it, vi } from 'vitest';
import { readProject } from '@synthetos/library';
import { FilesError } from '../src/cloud/filesClient.ts';
import { ProjectStore } from '../src/projects/store.ts';
import { projectStore } from '../src/projects/browserStore.ts';
import { sha256Hex } from '../src/projects/image.ts';
import type { ProjectRecordStore } from '../src/projects/blobStore.ts';
import { stored } from '../src/workspace/storage.ts';
import { emptyCache, readCache, saveCache } from '../src/workspace/cloud/cloudCache.ts';
import { projectRecords } from '../src/workspace/cloud/projectRecords.ts';
import { hashProjectImages, uploadProjectFiles } from '../src/workspace/cloud/projectFiles.ts';
import { startLibrarySync, librarySyncView } from '../src/workspace/cloud/librarySync.ts';
import { api, at, filesApi, machine, memory, project, projectContext, record } from './syncFixtures.ts';

const hooks = () => ({ persist: vi.fn(() => true), change: vi.fn(), notice: vi.fn() });
const stops: (() => void)[] = [];
afterEach(() => { for (const stop of stops.splice(0)) stop(); });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function storeOn(records: ProjectRecordStore): ProjectStore {
  let id = 0;
  return new ProjectStore({ records, now: () => new Date(at), newId: () => `added-${++id}`, hash: sha256Hex,
    encodeImage: async () => ({ blob: new Blob(['encoded-webp']), width: 2, height: 2 }) });
}

it.each(['account/alice/photo', 'download/alice/photo', 'draft/alice/photo', 'aside/file'])('does not read or upload another namespace through the blob id %s (review repro 5)', async id => {
  const { records: raw } = projectContext(); const secret = new Blob(['Alice private WebP']);
  await raw.put('blobs', id, secret);
  const p = { ...project('bob.project'), images: [{ id, name: 'photo.webp', size: secret.size, width: 2, height: 2, addedAt: at }], cover: id };
  expect(readProject(p).ok).toBe(true);
  const records = projectRecords({ subject: 'bob', records: raw, cache: emptyCache(), active: () => true, ...hooks() });
  const files = filesApi();
  expect(await records.get('blobs', id)).toBeUndefined();
  expect(await records.keys('blobs')).not.toContain(id);
  await expect(hashProjectImages(p, records)).rejects.toBeInstanceOf(FilesError);
  const hashed = { ...p, images: [{ ...p.images[0]!, hash: await sha256Hex(await secret.arrayBuffer()) }] };
  await expect(uploadProjectFiles(hashed, { records, files, active: () => true, allowed: () => true }, new AbortController().signal)).rejects.toBeInstanceOf(FilesError);
  expect(files.put).not.toHaveBeenCalled();
  expect(await (await raw.get('blobs', id) as Blob).text()).toBe('Alice private WebP');
});
it('stores slash-containing ids as opaque components in the current account', async () => {
  const { records: raw } = projectContext(); const records = projectRecords({ subject: 'bob', records: raw, cache: emptyCache(), active: () => true, ...hooks() });
  const blob = new Blob(['Bob photo']);
  await records.put('blobs', 'account/alice/photo', blob);
  expect(await records.get('blobs', 'account/alice/photo')).toEqual(blob);
  expect(await raw.get('blobs', 'account/bob/account%2Falice%2Fphoto')).toEqual(blob);
  expect(await raw.get('blobs', 'account/alice/photo')).toBeUndefined();
});
it('keeps added files and encoded images with an unconsented local project after sign-out and reload (review repro 1)', async () => {
  const { records: raw, local } = projectContext(); const p = await local.create('Browser only');
  const cache = emptyCache(); let active = true;
  const records = projectRecords({ subject: 'alice', records: raw, cache, active: () => active, ...hooks() });
  const account = storeOn(records); await account.load();
  await account.add(p.id, [new File(['G0 X1'], 'new.nc'), new File(['original photo'], 'photo.jpg', { type: 'image/jpeg' })]);
  active = false;
  const fresh = storeOn(raw); await fresh.load(); const saved = fresh.find(p.id)!;
  expect(await (await fresh.blob(saved.files[0]!.id))!.text()).toBe('G0 X1');
  expect(await (await fresh.blob(saved.images[0]!.id))!.text()).toBe('encoded-webp');
  expect(cache.pending).toEqual([]);
  expect((await raw.keys('blobs')).some(id => id.startsWith('account/'))).toBe(false);
  const bob = storeOn(projectRecords({ subject: 'bob', records: raw, cache: emptyCache(), active: () => true, ...hooks() }));
  await bob.load(); expect(bob.find(p.id)).toEqual(saved);
  expect(await bob.blob(saved.files[0]!.id)).not.toBeNull();
});
it('keeps blobs for a new account project scoped to that account', async () => {
  const { records: raw } = projectContext(); const cache = emptyCache();
  const account = storeOn(projectRecords({ subject: 'alice', records: raw, cache, active: () => true, ...hooks() }));
  const p = await account.create('Account only'); await account.add(p.id, [new File(['G0 X1'], 'new.nc')]);
  const id = account.find(p.id)!.files[0]!.id;
  expect(await raw.get('blobs', id)).toBeUndefined(); expect(await raw.get('blobs', `account/alice/${id}`)).toBeInstanceOf(Blob);
});
it('restores browser draft bytes through the draft API without exposing reserved blob keys', async () => {
  const { records: raw, local } = projectContext();
  await local.keepAside('draft-file', new Blob(['browser draft']));
  const records = projectRecords({ subject: 'bob', records: raw, cache: emptyCache(), active: () => true, ...hooks() });
  const account = storeOn(records);
  expect(await (await account.aside('draft-file'))!.text()).toBe('browser draft');
  expect(await account.blob('aside/draft-file')).toBeNull();
  await account.keepAside('draft-file', new Blob(['Bob draft']));
  expect(await (await account.aside('draft-file'))!.text()).toBe('Bob draft');
  expect(await (await local.aside('draft-file'))!.text()).toBe('browser draft');
});
it.each(['switch', 'sign out'])('does not publish a stopped account edit after %s (review repro 2)', async action => {
  const { records: raw, local } = projectContext(); const storage = memory();
  const profiles = stored('machines', [machine], (v): v is typeof machine[] => Array.isArray(v), () => storage);
  const aliceMachine = { ...machine, name: 'Alice secret' }; const bobMachine = { ...machine, name: 'Bob machine' };
  const alice = emptyCache(); alice.records = [record('machine', aliceMachine), record('project', project())];
  const bob = emptyCache(); bob.records = [record('machine', bobMachine)];
  saveCache(storage, 'alice', alice); saveCache(storage, 'bob', bob);
  const held = deferred(); const started = deferred(); let holding = false;
  const records = { ...raw, async put(kind: Parameters<typeof raw.put>[0], id: string, value: unknown) {
    if (holding && kind === 'projects' && id === 'download/alice/project.one') { started.resolve(); await held.promise; }
    await raw.put(kind, id, value);
  } };
  const options = { storage, client: api(), allowed: () => false, setTimeout: () => 1, clearTimeout: () => {} };
  const first = startLibrarySync({ ...options, subject: 'alice', display: 'Alice', projects: { local, records, files: filesApi() } }); stops.push(first.stop);
  await vi.waitFor(async () => expect((await projectStore()).find('project.one')).not.toBeNull());
  holding = true;
  const edit = (await projectStore()).rename('project.one', 'Delayed edit'); const outcome = edit.catch(error => error);
  await started.promise; first.stop();
  if (action === 'switch') { const next = startLibrarySync({ ...options, subject: 'bob', display: 'Bob' }); stops.push(next.stop); }
  const expected = action === 'switch' ? 'Bob machine' : machine.name;
  expect(profiles.value.value[0]?.name).toBe(expected);
  held.resolve(); expect(await outcome).toBeInstanceOf(Error);
  expect(profiles.value.value[0]?.name).toBe(expected);
  expect(librarySyncView.value.display).toBe(action === 'switch' ? 'Bob' : '');
  expect(readCache(storage, 'alice').pending[0]?.content).toMatchObject({ name: 'Delayed edit' });
  expect(await raw.get('projects', 'account/alice/project.one')).toMatchObject({ name: 'Delayed edit' });
  expect(await raw.get('projects', 'account/bob/project.one')).toBeUndefined();
  first.stop(); expect(profiles.value.value[0]?.name).toBe(expected);
});
