import { prepareImport } from '../src/workspace/cloud/importFlow.ts';
import { afterEach, expect, it, vi } from 'vitest';
import type { Tool } from '@synthetos/library';
import { BUILTIN_MATERIALS, readTool } from '@synthetos/library';
import type { CloudRecord } from '@synthetos/contracts';
import { LEGACY_SEED_TOOLS } from './legacySeedTools.ts';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import { cleanSeedTool } from '../src/workspace/tools/cleanSeedTool.ts';
import { queueSeedCleanup } from '../src/workspace/cloud/seedCleanup.ts';
import { emptyCache, readCache, saveCache, contentHash } from '../src/workspace/cloud/cloudCache.ts';
import { drainQueue, enqueue } from '../src/workspace/cloud/syncQueue.ts';
import { RecordsError, type RecordsClient } from '../src/cloud/recordsClient.ts';
import { toolStore } from '../src/workspace/library.ts';
import { loadStoredLibraries, readStored, writeStored } from '../src/workspace/storage.ts';
import { startLibrarySync } from '../src/workspace/cloud/librarySync.ts';
import { renderToString } from 'preact-render-to-string';
import { h } from 'preact';
import { ToolCuttingTab } from '../src/workspace/views/tools/ToolRecordsTabs.ts';
const old = LEGACY_SEED_TOOLS[0]!.tool;
const realRow = { materialRef: { id: 'builtin.al-6061', version: 1 }, fz: 0.02, source: 'user' as const, note: 'My measured value' };
function memory() { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: vi.fn((key: string, value: string) => { map.set(key, value); }) }; }
const record = (content: Tool, rev = 4): CloudRecord => ({ kind: 'tool', id: content.id, content, rev, archivedAt: null, sha256: 'a'.repeat(64) });
const client = (): RecordsClient => ({ list: vi.fn(async () => []), put: vi.fn(async (_kind, _id, parent, content) => record(content as Tool, (parent ?? 0) + 1)), archive: vi.fn() });
const hooks = () => ({ persist: vi.fn(() => true), change: vi.fn(), notice: vi.fn() });
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); toolStore.set(SEED_TOOLS); });

it('keeps all six starter tools with no invented cutting rows, notes or usage', () => {
  expect(SEED_TOOLS).toHaveLength(6);
  for (const [i, entry] of SEED_TOOLS.entries()) {
    expect(entry).toEqual({ ...LEGACY_SEED_TOOLS[i], tool: { ...LEGACY_SEED_TOOLS[i]!.tool, cuttingData: [], notes: '', life: { minutes: 0, byMaterial: [] } } });
    expect(readTool(entry.tool).ok).toBe(true);
    expect(cleanSeedTool(entry.tool)).toBe(entry.tool);
    expect(renderToString(h(ToolCuttingTab, { tool: entry.tool, unit: 'mm' }))).toContain('No cutting data for this tool yet.');
  }
});
it('cleans exact legacy values once; preserves unflagged rows, geometry, number and all other fields', () => {
  for (const entry of LEGACY_SEED_TOOLS) {
    const before = { ...entry.tool, cuttingData: [...entry.tool.cuttingData, realRow] };
    const next = cleanSeedTool(before);
    expect(next).toEqual({ ...before, cuttingData: [realRow], notes: '', life: { minutes: 0, byMaterial: [] } });
    expect(cleanSeedTool(next)).toBe(next);
    expect(next.geometry).toBe(before.geometry); expect(next.cuttingData[0]).toBe(realRow);
  }
});
it('preserves user notes and any usage change, even when other fields still need cleanup', () => {
  for (const life of [
    { ...old.life, minutes: old.life.minutes + 1 },
    { ...old.life, byMaterial: [] },
    { ...old.life, byMaterial: old.life.byMaterial.map((row, i) => i === 0 ? { ...row, minutes: 147 } : row) },
    { ...old.life, byMaterial: old.life.byMaterial.map((row, i) => i === 0 ? { ...row, materialRef: { ...row.materialRef, version: 2 } } : row) },
    { ...old.life, byMaterial: old.life.byMaterial.map((row, i) => i === 0 ? { ...row, materialRef: { ...row.materialRef, id: 'builtin.mdf' } } : row) },
  ]) {
    const before = { ...old, notes: `${old.notes} My change.`, life };
    expect(cleanSeedTool(before)).toEqual({ ...before, cuttingData: [] });
  }
  const reordered = { ...old, life: { byMaterial: old.life.byMaterial.map(r => ({ minutes: r.minutes, materialRef: { version: r.materialRef.version, id: r.materialRef.id } })), minutes: old.life.minutes } };
  expect(cleanSeedTool(reordered).life).toEqual({ minutes: 0, byMaterial: [] });
});
it('only touches seed-prefixed ids; unknown seed tools lose flagged rows but keep notes and usage', () => {
  for (const id of ['mine.t1', 'copy-seed.t1', 'seedling.t1']) { const tool = { ...old, id }; expect(cleanSeedTool(tool)).toBe(tool); }
  const tool = { ...old, id: 'seed.other' };
  expect(cleanSeedTool(tool)).toEqual({ ...tool, cuttingData: [] });
});
it('loads and persists browser cleanup once without changing custom entries or T numbers', () => {
  const storage = memory(); vi.stubGlobal('localStorage', storage);
  const saved = [{ ...LEGACY_SEED_TOOLS[0]!, number: 42 }, { ...LEGACY_SEED_TOOLS[1]!, tool: { ...LEGACY_SEED_TOOLS[1]!.tool, id: 'mine.tool' } }];
  writeStored('tools.v2', saved); loadStoredLibraries();
  const cleaned = [{ ...saved[0]!, tool: cleanSeedTool(saved[0]!.tool) }, saved[1]!];
  expect(toolStore.value.value).toEqual(cleaned);
  expect(readStored('tools.v2', (v): v is unknown[] => Array.isArray(v))).toEqual(cleaned);
  storage.setItem.mockClear(); loadStoredLibraries(); expect(storage.setItem).not.toHaveBeenCalled();
});
it('queues account cleanup at the existing revision, keeps pending edits and never revives deleted seeds', () => {
  const cache = emptyCache(); cache.records = [record(old), { ...record(LEGACY_SEED_TOOLS[1]!.tool), archivedAt: 1 }];
  expect(queueSeedCleanup(cache)).toBe(true); expect(cache.pending).toMatchObject([{ parent: 4, cleanup: true, content: cleanSeedTool(old) }]);
  expect(queueSeedCleanup(cache)).toBe(false);
  const storage = memory(); saveCache(storage, 'alice', cache); expect(readCache(storage, 'alice')).toEqual(cache);
  expect(readCache(storage, 'bob')).toEqual(emptyCache());
  enqueue(cache, 'tool', old.id, { ...old, name: 'Pending edit', notes: 'Mine' });
  queueSeedCleanup(cache); expect(cache.pending[0]?.cleanup).toBeUndefined();
  expect(cache.pending[0]?.content).toMatchObject({ name: 'Pending edit', notes: 'Mine', cuttingData: [] });
  enqueue(cache, 'tool', old.id, null); expect(queueSeedCleanup(cache)).toBe(false); expect(cache.pending[0]?.content).toBeNull();
});
it('cleans resumed imports without changing checkpoint hashes or duplicating earlier copies', async () => {
  const source = { kind: 'tool' as const, id: old.id, content: old };
  const cache = emptyCache(); cache.importSource = [source];
  expect(await prepareImport(cache, [], () => true)).toBe(true);
  expect(cache.pending[0]?.content).toEqual(cleanSeedTool(old));
  cache.importSource = [source];
  expect(await prepareImport(cache, [], () => true)).toBe(true); expect(cache.pending).toHaveLength(1);
  const prior = emptyCache(); prior.importSource = [source]; prior.imports[`tool:${old.id}:${await contentHash(old)}`] = old.id;
  expect(await prepareImport(prior, [], () => true)).toBe(true); expect(prior.pending).toEqual([]);
  const same = emptyCache(); same.records = [record(old)];
  expect(await prepareImport(same, [source], () => true)).toBe(true); expect(same.pending).toEqual([]);
  const different = emptyCache(); different.records = [record({ ...old, name: 'Account version' })];
  expect(await prepareImport(different, [source], () => true)).toBe(true);
  expect(different.pending[0]?.id).toMatch(/^import-/);
  expect(different.pending[0]?.content).toMatchObject({ cuttingData: [], notes: '', life: { minutes: 0, byMaterial: [] } });
});
it('rebases a pure cleanup on a conflicting account edit without overwriting it or creating a copy', async () => {
  const cache = emptyCache(); cache.records = [record(old)]; queueSeedCleanup(cache);
  const updated = { ...old, name: 'Account edit', notes: 'My real note', life: { minutes: 5, byMaterial: [] }, cuttingData: [...old.cuttingData, realRow] };
  const api = client(); vi.mocked(api.put).mockRejectedValueOnce(new RecordsError(409, record(updated, 8)));
  const h = hooks(); expect(await drainQueue(cache, api, () => true, new AbortController().signal, h)).toBe('saved');
  expect(api.put).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.put).mock.calls[1]?.slice(0, 4)).toEqual(['tool', old.id, 8, { ...updated, cuttingData: [realRow] }]);
  expect(cache.pending).toEqual([]); expect(cache.records[0]?.content).toEqual({ ...updated, cuttingData: [realRow] }); expect(h.notice).not.toHaveBeenCalled();
});
it.each(['already-clean', 'archived', 'absent'] as const)('does not write again when the conflicting account tool is %s', async kind => {
  const cache = emptyCache(); cache.records = [record(old)]; queueSeedCleanup(cache);
  const current = kind === 'absent' ? null : { ...record(kind === 'already-clean' ? cleanSeedTool(old) : old, 9), archivedAt: kind === 'archived' ? 10 : null };
  const api = client(); vi.mocked(api.put).mockRejectedValueOnce(new RecordsError(409, current));
  expect(await drainQueue(cache, api, () => true, new AbortController().signal, hooks())).toBe('saved'); expect(api.put).toHaveBeenCalledOnce(); expect(cache.pending).toEqual([]);
});
it('applies cached and freshly downloaded account cleanup through gated sync, without repeat writes', async () => {
  const storage = memory(); const cache = emptyCache(); cache.records = [record(old)]; saveCache(storage, 'account', cache);
  const api = client(); const downloaded = { ...old, notes: 'Custom account note' };
  vi.mocked(api.list).mockImplementation(async kind => kind === 'tool' ? [record(downloaded, 5)] : []);
  vi.mocked(api.put).mockRejectedValueOnce(new RecordsError(409, record(downloaded, 5)));
  let allowed = false;
  const sync = startLibrarySync({ subject: 'account', display: 'Account', storage, client: api, allowed: () => allowed, setTimeout: () => 0, clearTimeout: () => {} });
  expect(toolStore.value.value.find(e => e.tool.id === old.id)?.tool.cuttingData).toEqual([]); expect(api.put).not.toHaveBeenCalled();
  allowed = true; sync.wake(); await settle();
  expect(toolStore.value.value.find(e => e.tool.id === old.id)?.tool).toEqual({ ...downloaded, cuttingData: [], life: { minutes: 0, byMaterial: [] } });
  const count = vi.mocked(api.put).mock.calls.length; expect(count).toBe(2); sync.wake(); await settle(); expect(api.put).toHaveBeenCalledTimes(count);
  sync.stop();
});

it('also cleans the kept account version after a user-edit conflict, preserving the normal conflict copy', async () => {
  const storage = memory(); const cache = emptyCache(); cache.records = [record(old)];
  enqueue(cache, 'tool', old.id, { ...old, notes: 'My pending note' }); saveCache(storage, 'race', cache);
  const current = { ...old, name: 'New account name', notes: 'Account note' };
  const api = client(); vi.mocked(api.list).mockImplementation(async kind => kind === 'tool' ? [record(current, 6)] : []);
  vi.mocked(api.put).mockRejectedValueOnce(new RecordsError(409, record(current, 6)));
  const sync = startLibrarySync({ subject: 'race', display: 'Race', storage, client: api, allowed: () => true, setTimeout: () => 0, clearTimeout: () => {} });
  for (let i = 0; i < 20; i++) { await settle(); await new Promise(r => setTimeout(r, 1)); }
  const tools = toolStore.value.value;
  expect(tools.find(e => e.tool.id === old.id)?.tool).toEqual({ ...current, cuttingData: [], life: { minutes: 0, byMaterial: [] } });
  expect(tools.find(e => e.tool.id.startsWith('copy-'))?.tool.notes).toBe('My pending note');
  expect(tools.every(e => e.tool.cuttingData.length === 0)).toBe(true);
  expect(readCache(storage, 'race').pending).toEqual([]); sync.stop();
});

it('leaves other record kinds and clean tools alone', () => {
  const cache = emptyCache(); const material = BUILTIN_MATERIALS[0]!;
  cache.records = [{ ...record(old), kind: 'material', id: material.id, content: material }, record(SEED_TOOLS[0]!.tool), record({ ...old, id: 'mine.tool' })];

  expect(queueSeedCleanup(cache)).toBe(false); expect(cache.pending).toEqual([]);
  enqueue(cache, 'tool', old.id, old); cache.pending[0] = { ...cache.pending[0]!, cleanup: true };
  expect(queueSeedCleanup(cache)).toBe(true); expect(cache.pending[0]?.cleanup).toBe(true);
});

it('preserves an edit made while an automatic cleanup write is in flight', async () => {
  const cache = emptyCache(); cache.records = [record(old)]; queueSeedCleanup(cache);
  const cleaned = cleanSeedTool(old); const api = client();
  vi.mocked(api.put).mockImplementationOnce(async () => {
    enqueue(cache, 'tool', old.id, { ...cleaned, notes: 'Typed while saving' });
    throw new RecordsError(409, record({ ...cleaned, notes: 'Newer account note' }, 7));
  });
  expect(await drainQueue(cache, api, () => true, new AbortController().signal, hooks())).toBe('saved');
  expect(cache.records.find(r => r.id === old.id)?.content).toMatchObject({ notes: 'Newer account note' });
  expect(cache.records.find(r => r.id.startsWith('copy-'))?.content).toMatchObject({ notes: 'Typed while saving' });
});
