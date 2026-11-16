import { expect, it, vi } from 'vitest';
import { readProject, type Project } from '@synthetos/library';
import { makeProjectStore } from '../src/projects/browserStore.ts';
import { sha256Hex } from '../src/projects/image.ts';
import { contentKey } from '../src/projects/blobStore.ts';
import { readProjectArchive } from '../src/projects/zip/import.ts';
import { exportProjectZip } from '../src/projects/zip/export.ts';
import { writeZip } from '../src/projects/zip/writer.ts';
import { MAX_MANIFEST } from '../src/projects/zip/paths.ts';
import { SEED_JOB } from '../src/workspace/jobModel.ts';
import { projectContext } from './syncFixtures.ts';
import { projectZip, zipFixture } from './zipFixtures.ts';

const options = () => ({ validateImage: vi.fn(async () => {}), progress: vi.fn() });
it('refuses unreadable jobs in the actual stored record instead of silently dropping them', async () => {
  const { p } = await zipFixture(); const context = projectContext();
  await context.records.put('projects', p.id, { ...p, jobs: [{}] }); await context.local.load();
  expect(context.local.find(p.id)?.jobs).toEqual([]);
  await expect(exportProjectZip(context.local, p.id)).rejects.toThrow(/valid project record/);
});
it('exports the stored record and bytes offline, adding a legacy image hash', async () => {
  const { p, blobs } = await zipFixture(); const context = projectContext();
  const image = { ...p.images[0]! }; delete image.hash;
  await context.records.put('projects', p.id, { ...p, images: [image] });
  for (const [id, blob] of blobs) await context.records.put('blobs', id, blob);
  await context.local.load(); const download = vi.fn(); const zip = await exportProjectZip(context.local, p.id, { download });
  const result = await readProjectArchive(zip, options());
  expect(result.project).toEqual(p); expect(readProject(result.project).ok).toBe(true); expect(download).not.toHaveBeenCalled();
  expect(await result.blobs.get('f1')!.text()).toBe('G0 X1\n');
  expect(context.local.find(p.id)?.images[0]?.hash).toBeUndefined();
});
it('fetches missing account bytes once before export and reports progress', async () => {
  const { p, blobs } = await zipFixture(); const context = projectContext(); await context.records.put('projects', p.id, p); await context.local.load();
  const progress = vi.fn(); const download = vi.fn(async () => { for (const [id, blob] of blobs) await context.records.put('blobs', id, blob); });
  await exportProjectZip(context.local, p.id, { progress, download });
  expect(download).toHaveBeenCalledExactlyOnceWith(p.id); expect(progress).toHaveBeenCalledWith(expect.stringContaining('Downloading'));
});
it.each(['missing', 'size', 'digest'])('refuses export with a named file when bytes are %s', async reason => {
  const { p } = await zipFixture(); const context = projectContext(); await context.records.put('projects', p.id, p); await context.local.load();
  if (reason !== 'missing') await context.records.put('blobs', 'f1', new Blob([reason === 'size' ? 'short' : 'G0 X2\n']));
  await expect(exportProjectZip(context.local, p.id)).rejects.toThrow('切削 plate.nc');
});
it('names the missing file when an account download fails', async () => {
  const { p } = await zipFixture(); const context = projectContext(); await context.records.put('projects', p.id, p); await context.local.load();
  await expect(exportProjectZip(context.local, p.id, { download: async () => { throw new Error('offline'); } })).rejects.toThrow('切削 plate.nc');
});
it('imports a complete archive and deduplicates content across retained file ids', async () => {
  const { p, blobs } = await zipFixture(); const context = projectContext();
  const same = { ...p, files: [...p.files, { ...p.files[0]!, id: 'f2', name: 'another.nc' }] }; blobs.set('f2', blobs.get('f1')!);
  const result = await context.local.importZip(await projectZip(same, blobs), options());
  expect(result).toEqual(same); expect(await (await context.local.blob('f2'))!.text()).toBe(await blobs.get('f1')!.text());
  const keys = await context.records.keys('blobs'); expect(keys.filter(key => key.startsWith('content/'))).toHaveLength(2);
  expect(await context.records.get('blobs', 'f1')).toEqual({ contentHash: p.files[0]!.hash });
  const fresh = makeProjectStore(context.records); await fresh.load(); expect(await (await fresh.blob('f1'))!.text()).toBe('G0 X1\n');
  await context.local.removeFile(result.id, 'f1'); expect(await (await context.local.blob('f2'))!.text()).toBe('G0 X1\n');
});
it('renames an id collision, retargets both job references and preserves shared bytes on deletion', async () => {
  const { p, blobs } = await zipFixture(); const context = projectContext();
  const withJob = { ...p, jobs: [{ ...SEED_JOB, projectId: p.id, file: { ...p.files[0]!, projectId: p.id, fileId: 'f1' } }] };
  const zip = await projectZip(withJob, blobs); const first = await context.local.importZip(zip, options()); const second = await context.local.importZip(zip, options());
  expect(second.id).not.toBe(first.id); expect(second.name).toBe(`${first.name} (imported)`);
  expect(second.jobs[0]?.projectId).toBe(second.id); expect(second.jobs[0]?.file?.projectId).toBe(second.id); expect(second.files[0]?.id).toBe('f1');
  await context.local.remove(first.id); expect(await (await context.local.blob('f1'))!.text()).toBe('G0 X1\n');
  await context.local.remove(second.id); expect(await context.records.get('blobs', contentKey(p.files[0]!.hash))).toBeUndefined();
});
it('refuses a different file reusing an existing id without changing existing bytes', async () => {
  const { p, zip } = await zipFixture(); const context = projectContext(); await context.local.importZip(zip, options());
  await context.records.put('blobs', 'f1', new Blob(['other bytes']));
  await expect(context.local.importZip(zip, options())).rejects.toThrow(/id already held/);
  expect(await (await context.local.blob('f1'))!.text()).toBe('other bytes'); expect(context.local.list).toHaveLength(1);
  expect(context.local.find(p.id)?.files[0]?.hash).toBe(p.files[0]?.hash);
});
it('does not replace a missing legacy image whose old hash is unknown', async () => {
  const { p, zip } = await zipFixture(); const context = projectContext(); const image = { ...p.images[0]! }; delete image.hash;
  await context.records.put('projects', p.id, { ...p, images: [image] }); await context.local.load();
  await expect(context.local.importZip(zip, options())).rejects.toThrow(/missing bytes cannot be verified/);
  expect(await context.records.keys('blobs')).toEqual([]); expect(context.local.list).toHaveLength(1);
});
it.each(['missing', 'size', 'hash', 'image hash', 'image decode', 'extra'])('refuses the entire import before writing on %s', async failure => {
  const { p, blobs } = await zipFixture(); const context = projectContext(); const opts = options();
  let project = p;
  if (failure === 'missing') blobs.delete('f1');
  if (failure === 'size') blobs.set('f1', new Blob(['wrong size']));
  if (failure === 'hash') blobs.set('f1', new Blob(['G0 X2\n']));
  if (failure === 'image hash') { const image = { ...p.images[0]! }; delete image.hash; project = { ...p, images: [image] }; }
  if (failure === 'image decode') opts.validateImage.mockRejectedValue(new Error('photo.webp is not a WebP image.'));
  const extra = failure === 'extra' ? [{ name: 'files/stray/unlisted.nc', blob: new Blob(['stray']) }] : [];
  await expect(context.local.importZip(await projectZip(project, blobs, extra), opts)).rejects.toThrow();
  expect(context.local.list).toEqual([]); expect(await context.records.keys('blobs')).toEqual([]); expect(await context.records.keys('projects')).toEqual([]);
});
it.each(['invalid json', 'shape', 'strict', 'no manifest', 'large manifest'])('refuses %s', async kind => {
  const { p } = await zipFixture();
  let text = JSON.stringify(p);
  if (kind === 'invalid json') text = '{';
  if (kind === 'shape') text = '{}';
  if (kind === 'strict') text = JSON.stringify({ ...p, unexpected: true });
  if (kind === 'large manifest') text = ' '.repeat(MAX_MANIFEST + 1);
  const zip = await writeZip([{ name: kind === 'no manifest' ? 'files/a/a' : 'project.json', blob: new Blob([text]) }]);
  await expect(readProjectArchive(zip, options())).rejects.toThrow(/project/);
});
it.each(['file', 'image', 'pixels', 'total', 'count', 'id', 'duplicate id'])('refuses the manifest limit or identity violation: %s', async kind => {
  const { p } = await zipFixture(); let next: Project = p;
  if (kind === 'file') next = { ...p, files: [{ ...p.files[0]!, role: 'other', size: 21 * 1024 * 1024 }] };
  if (kind === 'image') next = { ...p, images: [{ ...p.images[0]!, size: 11 * 1024 * 1024 }] };
  if (kind === 'pixels') next = { ...p, images: [{ ...p.images[0]!, width: 2001 }] };
  if (kind === 'total') next = { ...p, files: Array.from({ length: 11 }, (_, i) => ({ ...p.files[0]!, id: `f${i}`, size: 50 * 1024 * 1024 })) };
  if (kind === 'count') next = { ...p, files: Array.from({ length: 1000 }, (_, i) => ({ ...p.files[0]!, id: `f${i}` })) };
  if (kind === 'id') next = { ...p, id: 'account/alice/private' };
  if (kind === 'duplicate id') next = { ...p, files: [{ ...p.files[0]!, id: 'i1' }] };
  const zip = await writeZip([{ name: 'project.json', blob: new Blob([JSON.stringify(next)]) }]);
  await expect(readProjectArchive(zip, options())).rejects.toThrow();
});
it('imports an empty file with its real digest', async () => {
  const { p } = await zipFixture(); const empty = new Blob(); const hash = await sha256Hex(await empty.arrayBuffer());
  const next = { ...p, images: [], cover: null, files: [{ ...p.files[0]!, size: 0, hash }] }; const context = projectContext();
  await context.local.importZip(await projectZip(next, new Map([['f1', empty]])));
  expect((await context.local.blob('f1'))?.size).toBe(0);
});
