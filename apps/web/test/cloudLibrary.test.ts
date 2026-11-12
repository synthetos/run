import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudRecord } from '@synthetos/contracts';
import { BUILTIN_MATERIALS, forkRecord } from '@synthetos/library';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import { stored, loadStoredLibraries, storedBinding, type StorageLike } from '../src/workspace/storage.ts';
import { RecordsError, recordsClient, type RecordsClient } from '../src/cloud/recordsClient.ts';
import { cacheKey, canonical, contentHash, emptyCache, readCache, saveCache } from '../src/workspace/cloud/cloudCache.ts';
import { toRecords, fromRecords, browserCopy, validContent } from '../src/workspace/cloud/libraryRecords.ts';
import { enqueue, drainQueue, visibleRecords, retryDelay } from '../src/workspace/cloud/syncQueue.ts';
import { prepareImport } from '../src/workspace/cloud/importFlow.ts';
import { librarySyncActions, librarySyncView, librarySavedText, startLibrarySync } from '../src/workspace/cloud/librarySync.ts';
const tool = { ...SEED_TOOLS[0]!.tool, id: 'mine.one', name: 'My tool' };
const rec = (content = tool, rev = 1): CloudRecord => ({ id: content.id, kind: 'tool', rev, archivedAt: null, content, sha256: 'a'.repeat(64) });
const signal = () => new AbortController().signal;
function memory(): StorageLike { const values = new Map<string, string>(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }; }
const client = (): RecordsClient => ({ list: vi.fn(async () => []), put: vi.fn(async (_k, _id, parent, content) => rec(content as typeof tool, (parent ?? 0) + 1)), archive: vi.fn(async () => ({ ...rec(), archivedAt: 1 })) });
const hooks = () => ({ persist: vi.fn(() => true), change: vi.fn(), notice: vi.fn() });
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
afterEach(() => vi.restoreAllMocks());
describe('account library cache and adapters', () => {
  it('isolates accounts, handles absent/broken/blocked storage, and hashes stable content', async () => {
    const storage = memory(); const cache = emptyCache(); cache.consent = true;
    expect(saveCache(storage, 'alice', cache)).toBe(true);
    expect(readCache(storage, 'alice').consent).toBe(true);
    expect(readCache(storage, 'bob')).toEqual(emptyCache());
    expect(readCache(null, 'alice')).toEqual(emptyCache());
    expect(saveCache(null, 'a', cache)).toBe(false);
    const broken = { getItem() { throw Error(); }, setItem() { throw Error(); } };
    expect(readCache(broken, 'a')).toEqual(emptyCache()); expect(saveCache(broken, 'a', cache)).toBe(false);
    for (const raw of ['null', '{}', '{', '{"v":2}']) { storage.setItem(cacheKey('a'), raw); expect(readCache(storage, 'a')).toEqual(emptyCache()); }
    expect(canonical({ b: [2, null], a: 1 })).toBe(canonical({ a: 1, b: [2, null] }));
    expect(await contentHash({ b: 2, a: 1 })).toBe(await contentHash({ a: 1, b: 2 }));
    expect(canonical(undefined)).toBe('null');
  });
  it('excludes unchanged seeds, preserves tool numbering and resolves user material forks', () => {
    expect(toRecords('tools.v2', SEED_TOOLS)).toEqual([]);
    const renumbered = SEED_TOOLS.map(e => ({ ...e, number: e.number + 20 }));
    const uploaded = toRecords('tools.v2', renumbered);
    expect(uploaded).toHaveLength(SEED_TOOLS.length);
    expect((fromRecords('tools.v2', uploaded) as typeof SEED_TOOLS).map(e => e.number)).toEqual(renumbered.map(e => e.number));
    expect(toRecords('tools.v2', null)).toEqual([]); expect(toRecords('unknown', [])).toEqual([]);
    const records = toRecords('tools.v2', [{ number: 9, store: null, tool }]);
    expect(records[0]?.content).toMatchObject({ firmwareSlot: { t: 9, lengthOffset: 0 } });
    const parent = BUILTIN_MATERIALS[0]!; const fork = forkRecord('material', parent, 'mine.material');
    if (!fork.ok) throw Error('fixture');
    expect(toRecords('materials.v2', [fork.value])).toMatchObject([{ kind: 'material', id: 'mine.material' }]);
    expect(toRecords('materials.v2', [{ ...fork.value, forkOf: { id: 'missing', version: 1 } }])).toEqual([]);
    expect(toRecords('materials.own.v1', [parent])).toHaveLength(1);
    expect(fromRecords('materials.v2', records)).toEqual([]);
    expect(fromRecords('materials.own.v1', [])).toEqual([]);
    const entries = fromRecords('tools.v2', records) as typeof SEED_TOOLS;
    expect(entries.find(e => e.tool.id === tool.id)?.number).toBe(9);
    expect(validContent('tool', {})).toBe(false); expect(validContent('material', parent)).toBe(true);
    expect(browserCopy(tool, 'copy.one')).toMatchObject({ id: 'copy.one', name: 'My tool (from this browser)' });
  });
});
describe('records HTTP client', () => {
  it('reads all pages and sends CAS and archive with same-origin protection', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => rec({ ...tool, id: `t${String(i).padStart(3, '0')}` }));
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ records: rows })).mockResolvedValueOnce(Response.json({ records: [] })).mockImplementation(async () => Response.json({ record: rec() }));
    const api = recordsClient(fetch);
    expect(await api.list('tool', signal())).toHaveLength(100);
    expect(fetch.mock.calls[1]?.[0]).toBe('/api/records/tool?include_archived=1&after=t099');
    await api.put('tool', tool.id, null, tool, signal()); await api.archive('tool', tool.id, 1, signal());
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({ credentials: 'same-origin', method: 'PUT', redirect: 'error', headers: { 'x-synthetos-request': '1' }, body: JSON.stringify({ parent_rev: null, content: tool }) });
    expect(fetch.mock.calls[3]?.[1]).toMatchObject({ method: 'DELETE', body: '{"parent_rev":1}' });
  });
  it.each([401, 503, 409, 413, 500])('preserves HTTP %i', async status => {
    const api = recordsClient(async () => Response.json({ current: status === 409 ? rec() : null }, { status }));
    await expect(api.put('tool', tool.id, 1, tool, signal())).rejects.toMatchObject({ status });
  });
  it('rejects malformed responses and unordered pagination', async () => {
    for (const body of [null, {}, { records: [null] }, { records: [rec(), rec()] }]) await expect(recordsClient(async () => Response.json(body)).list('tool', signal())).rejects.toMatchObject({ status: 502 });
    await expect(recordsClient(async () => new Response('bad', { status: 503 })).list('tool', signal())).rejects.toMatchObject({ status: 503 });
  });
});
describe('CAS queue and consented import', () => {
  it('queues edits immediately, coalesces, archives, and checks the pause gate before each call', async () => {
    const cache = emptyCache(); const api = client(); const h = hooks();
    enqueue(cache, 'tool', tool.id, tool); enqueue(cache, 'tool', tool.id, { ...tool, name: 'Latest' });
    expect(cache.pending).toHaveLength(1); expect(visibleRecords(cache)[0]?.content.name).toBe('Latest');
    expect(await drainQueue(cache, api, () => false, signal(), h)).toBe('saving'); expect(api.put).not.toHaveBeenCalled();
    expect(await drainQueue(cache, api, () => true, signal(), h)).toBe('saved');
    enqueue(cache, 'tool', tool.id, null); expect(visibleRecords(cache)).toEqual([]);
    expect(await drainQueue(cache, api, () => true, signal(), h)).toBe('saved'); expect(api.archive).toHaveBeenCalled();
    enqueue(cache, 'tool', 'new', tool); enqueue(cache, 'tool', 'new', null); await drainQueue(cache, api, () => true, signal(), h); expect(cache.pending).toEqual([]);
  });
  it('a 409 preserves the server and saves the edit as a copy; a lost response is idempotent', async () => {
    const cache = emptyCache(); cache.records = [rec()]; const edit = { ...tool, name: 'Changed' }; enqueue(cache, 'tool', tool.id, edit);
    const api = client(); vi.mocked(api.put).mockRejectedValueOnce(new RecordsError(409, rec()));
    const h = hooks(); expect(await drainQueue(cache, api, () => true, signal(), h)).toBe('saved');
    expect(visibleRecords(cache).map(r => r.content.name)).toEqual(['My tool', 'Changed (from this browser)']); expect(h.notice).toHaveBeenCalledOnce();
    enqueue(cache, 'tool', tool.id, tool); vi.mocked(api.put).mockRejectedValueOnce(new RecordsError(409, rec()));
    expect(await drainQueue(cache, api, () => true, signal(), h)).toBe('saved'); expect(cache.pending).toEqual([]);
  });
  it('retains newer edits during an in-flight acknowledgement', async () => {
    const cache = emptyCache(); enqueue(cache, 'tool', tool.id, tool); const api = client();
    vi.mocked(api.put).mockImplementationOnce(async () => { enqueue(cache, 'tool', tool.id, { ...tool, name: 'Newer' }); return rec(); });
    await drainQueue(cache, api, () => true, signal(), hooks());
    expect(vi.mocked(api.put).mock.calls[1]?.[2]).toBe(1); expect(cache.records[0]?.content).toMatchObject({ name: 'Newer' });
  });
  it.each([413, 500, 401, 503])('keeps pending data on %i', async status => {
    const cache = emptyCache(); enqueue(cache, 'tool', tool.id, tool); const api = client(); vi.mocked(api.put).mockRejectedValue(new RecordsError(status));
    const run = drainQueue(cache, api, () => true, signal(), hooks());
    if (status === 401 || status === 503) await expect(run).rejects.toMatchObject({ status });
    else expect(await run).toBe(status === 413 ? 'quota' : 'retry');
    expect(cache.pending).toHaveLength(1);
  });
  it('stops on quota, offline, aborted calls or cache failures; bounds backoff', async () => {
    const cache = emptyCache(); enqueue(cache, 'tool', tool.id, tool); const api = client();
    expect(await drainQueue(cache, api, () => true, signal(), { ...hooks(), persist: () => false })).toBe('retry'); expect(api.put).not.toHaveBeenCalled();
    vi.mocked(api.put).mockRejectedValue(Error('offline')); expect(await drainQueue(cache, api, () => true, signal(), hooks())).toBe('retry');
    const abort = new AbortController(); abort.abort(); expect(await drainQueue(cache, api, () => true, abort.signal, hooks())).toBe('saving');
    expect(retryDelay(0)).toBe(1000); expect(retryDelay(99)).toBe(60000);
  });
  it('resumes imports by id and hash, preserves clashes, and never uploads without queue execution', async () => {
    const cache = emptyCache(); cache.records = [rec()]; const local = [{ kind: 'tool' as const, id: tool.id, content: { ...tool, name: 'Local' } }];
    let saved = ''; const persist = () => { saved = JSON.stringify(cache); return true; };
    expect(await prepareImport(cache, local, persist)).toBe(true);
    const resumed = JSON.parse(saved) as typeof cache;
    await prepareImport(resumed, local, () => true); expect(resumed.pending).toHaveLength(1);
    expect(resumed.pending[0]?.content).toMatchObject({ name: 'Local (from this browser)' });
    await prepareImport(resumed, [{ kind: 'tool', id: tool.id, content: tool }], () => true); expect(resumed.pending).toHaveLength(1);
    expect(await prepareImport(emptyCache(), local, () => false)).toBe(false);
  });
});
describe('storage backend lifetime', () => {
  const stops: (() => void)[] = []; afterEach(() => { for (const stop of stops.splice(0)) stop(); });
  function setup(api = client(), storage = memory()) {
    const local = stored('tools.v2', [{ tool, number: 8, store: null }], (v): v is { tool: typeof tool; number: number; store: null }[] => Array.isArray(v), () => storage);
    loadStoredLibraries(); let allowed = true;
    const scheduled: (() => void)[] = [];
    const sync = startLibrarySync({ subject: 'alice', display: '@alice', storage, client: api, allowed: () => allowed, setTimeout: fn => { scheduled.push(fn); return 1; }, clearTimeout: () => {} });
    stops.push(sync.stop); return { local, sync, api, storage, scheduled, pause: () => { allowed = false; sync.wake(); }, resume: () => { allowed = true; sync.wake(); } };
  }
  it('asks before import, leaves browser copies unchanged, switches back on sign-out', async () => {
    const r = setup(); await settle(); expect(librarySyncView.value.ask).toBe(true); expect(r.api.put).not.toHaveBeenCalled();
    librarySyncActions.notNow(); expect(librarySyncView.value.ask).toBe(false);
    await librarySyncActions.copy(); await settle(); expect(r.api.put).toHaveBeenCalledOnce();
    expect(storedBinding('tools.v2')?.local()).toEqual([{ tool, number: 8, store: null }]);
    expect(librarySavedText(true)).toBe('Saved to your account'); r.sync.stop(); expect(r.local.value.value[0]?.tool.name).toBe('My tool');
    expect(librarySavedText(true)).toBe('Saved in this browser'); expect(librarySavedText(false)).toContain('blocks storage');
  });
  it.each([401, 503])('falls back to the browser on %i', async status => {
    const api = client(); vi.mocked(api.list).mockRejectedValue(new RecordsError(status)); const r = setup(api); await settle();
    expect(librarySyncView.value.mode).toBe('local'); expect(r.local.value.value[0]?.tool.id).toBe(tool.id);
  });
  it('reads the account cache first and pauses pending writes until resumed', async () => {
    const storage = memory(); const cache = emptyCache(); cache.records = [rec({ ...tool, name: 'Cached' })]; cache.consent = true; saveCache(storage, 'alice', cache);
    const api = client(); vi.mocked(api.list).mockImplementation(async kind => kind === 'tool' ? cache.records : []);
    const r = setup(api, storage); expect(r.local.value.value.some(e => e.tool.name === 'Cached')).toBe(true); await settle();
    r.pause(); r.local.set(r.local.value.value.map(e => e.tool.id === tool.id ? { ...e, tool: { ...e.tool, name: 'Offline edit' } } : e)); expect(api.put).not.toHaveBeenCalled(); expect(librarySavedText(true)).toBe('Saving…');
    r.resume(); await settle(); expect(api.put).toHaveBeenCalledOnce();
  });
  it('retains pending edits offline and retries; quota lists what stayed local', async () => {
    const api = client(); const r = setup(api); await settle(); vi.mocked(api.put).mockRejectedValueOnce(Error('offline'));
    r.local.set([...SEED_TOOLS.map(e => ({ ...e, store: null })), { tool, number: 8, store: null }]); await settle(); expect(librarySavedText(true)).toBe('Not saved yet: will retry'); expect(r.scheduled).toHaveLength(1);
    vi.mocked(api.put).mockRejectedValueOnce(new RecordsError(413)); r.scheduled[0]!(); await settle(); expect(librarySyncView.value.remaining).toEqual(['My tool']);
    librarySyncActions.dismiss(); expect(librarySyncView.value.notice).toBeNull(); librarySyncActions.retry(); await settle(); expect(librarySyncView.value.status).toBe('saved');
  });
});

describe('page-side safety gating and identity isolation', () => {
  it('uses the cloudSync matrix for every paused state and resumes on idle', async () => {
    const { accountIdentity } = await import('../src/live/account.ts');
    const { mountLibrarySync } = await import('../src/workspace/cloud/mount.ts');
    const { createWorkspaceModel, INITIAL_LIVE_VIEW } = await import('../src/workspace/model.ts');
    const model = createWorkspaceModel(); const fetch = vi.fn(async () => Response.json({ records: [] }));
    vi.stubGlobal('fetch', fetch); vi.stubGlobal('localStorage', memory());
    for (const base of ['PREAMBLE', 'RUNNING', 'HOLD_REQUESTED', 'HELD', 'BARRIER_DRAINING', 'END_HOLDBACK', 'STOPPING_JOB']) {
      accountIdentity.value = null;
      model.live.value = { ...INITIAL_LIVE_VIEW, message: { snapshot: { base, overlays: [] } } as never };
      const stop = mountLibrarySync(model, 'staging.run.synthetos.com');
      accountIdentity.value = { subject: 'usr_a', display: '@a' }; await settle(); expect(fetch).not.toHaveBeenCalled();
      model.live.value = INITIAL_LIVE_VIEW; await settle(); expect(fetch).toHaveBeenCalledTimes(2);
      accountIdentity.value = { subject: 'usr_b', display: '@b' }; await settle(); expect(fetch).toHaveBeenCalledTimes(4);
      accountIdentity.value = null; stop(); fetch.mockClear();
    }
    mountLibrarySync(model, 'run.synthetos.com')(); expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('renders import consent, conflict and quota notices', async () => {
    const { h } = await import('preact'); const { renderToString } = await import('preact-render-to-string');
    const { LibrarySyncNotice } = await import('../src/workspace/cloud/SyncNotice.ts');
    librarySyncView.value = { mode: 'account', display: '@alice', ask: true, status: 'saved', notice: null, remaining: [] };
    const html = renderToString(h(LibrarySyncNotice, null)); expect(html).toContain('Copy your library?'); expect(html).toContain('@alice'); expect(html).toContain('Not now');
    librarySyncView.value = { ...librarySyncView.value, ask: false, status: 'quota', notice: 'Full', remaining: ['Local tool'] };
    const quota = renderToString(h(LibrarySyncNotice, null)); expect(quota).toContain('Local tool'); expect(quota).toContain('Try again'); expect(quota).toContain('Dismiss');
    librarySyncView.value = { ...librarySyncView.value, status: 'saved', remaining: [] };
    expect(renderToString(h(LibrarySyncNotice, null))).not.toContain('Try again');
  });
});

describe('cache and queue failure boundaries', () => {
  it('validates every persisted pending field before trusting a cache', () => {
    const storage = memory(); const cache = emptyCache(); enqueue(cache, 'tool', tool.id, tool); cache.records = [rec()];
    saveCache(storage, 'a', cache); expect(readCache(storage, 'a').pending).toHaveLength(1);
    enqueue(cache, 'tool', tool.id, null); saveCache(storage, 'a', cache); expect(readCache(storage, 'a').pending[0]?.content).toBeNull();
    const badPending = [null, { ...cache.pending[0], token: 1 }, { ...cache.pending[0], kind: 'machine' }, { ...cache.pending[0], id: '/' }, { ...cache.pending[0], parent: 0 }, { ...cache.pending[0], content: {} }];
    for (const p of badPending) { storage.setItem(cacheKey('a'), JSON.stringify({ ...cache, pending: [p] })); expect(readCache(storage, 'a')).toEqual(emptyCache()); }
    for (const r of [null, { ...rec(), kind: 'machine' }, { ...rec(), archivedAt: 'bad' }, { ...rec(), rev: null }, { ...rec(), content: {} }]) { storage.setItem(cacheKey('a'), JSON.stringify({ ...cache, records: [r] })); expect(readCache(storage, 'a')).toEqual(emptyCache()); }
    storage.setItem(cacheKey('a'), JSON.stringify({ ...cache, imports: { key: '/' } })); expect(readCache(storage, 'a')).toEqual(emptyCache());
    const material = BUILTIN_MATERIALS[0]!; cache.records = [{ ...rec(), kind: 'material', id: material.id, content: material, archivedAt: 1 }]; cache.pending = [];
    saveCache(storage, 'a', cache); expect(readCache(storage, 'a').records).toHaveLength(1);
  });
  it('rejects absent revisions and invalid record metadata', async () => {
    for (const patch of [{ rev: undefined }, { rev: 0 }, { id: '/' }, { kind: 'material' }, { archivedAt: 'bad' }, { sha256: 1 }]) {
      await expect(recordsClient(async () => Response.json({ records: [{ ...rec(), ...patch }] })).list('tool', signal())).rejects.toMatchObject({ status: 502 });
    }
    const parent = BUILTIN_MATERIALS[0]!; const f = forkRecord('material', parent, 'mine.bad'); if (!f.ok) throw Error();
    expect(toRecords('materials.v2', [{ ...f.value, forkOf: { ...f.value.forkOf, version: 999 } }])).toEqual([]);
  });
  it('aborts outstanding writes without dropping them, including an abort with an error', async () => {
    for (const reject of [false, true]) {
      const cache = emptyCache(); enqueue(cache, 'tool', tool.id, tool); const control = new AbortController(); const api = client();
      vi.mocked(api.put).mockImplementationOnce(async () => { control.abort(); if (reject) throw Error('cancelled'); return rec(); });
      expect(await drainQueue(cache, api, () => true, control.signal, hooks())).toBe('saving'); expect(cache.pending).toHaveLength(1);
    }
  });
  it('preserves an import copy mapping and a newer local edit when the original CAS fails', async () => {
    const cache = emptyCache(); cache.records = [rec()]; cache.imports['tool:mine.one:hash'] = tool.id; cache.imports['other'] = 'unrelated';
    enqueue(cache, 'tool', tool.id, { ...tool, name: 'Old edit' }); const api = client();
    vi.mocked(api.put).mockImplementationOnce(async () => { enqueue(cache, 'tool', tool.id, { ...tool, name: 'Latest edit' }); throw new RecordsError(409, rec()); });
    await drainQueue(cache, api, () => true, signal(), hooks());
    expect(cache.imports['tool:mine.one:hash']).toMatch(/^copy-/); expect(cache.records.some(r => (r.content as typeof tool).name === 'Latest edit (from this browser)')).toBe(true);
    const absent = emptyCache(); enqueue(absent, 'tool', tool.id, tool); vi.mocked(api.put).mockRejectedValueOnce(new RecordsError(409));
    await drainQueue(absent, api, () => true, signal(), hooks()); expect(absent.pending).toEqual([]);
    enqueue(cache, 'tool', tool.id, null); vi.mocked(api.archive).mockRejectedValueOnce(new RecordsError(409, rec())); await drainQueue(cache, api, () => true, signal(), hooks()); expect(cache.pending).toEqual([]);
  });
  it('rejects malformed visible content and reports an acknowledgement cache-write failure', async () => {
    const cache = emptyCache(); cache.records = [{ ...rec(), content: {} }]; enqueue(cache, 'tool', tool.id, {}); expect(visibleRecords(cache)).toEqual([]);
    cache.pending = []; enqueue(cache, 'tool', tool.id, tool); const h = hooks(); h.persist.mockReturnValueOnce(true).mockReturnValue(false);
    expect(await drainQueue(cache, client(), () => true, signal(), h)).toBe('retry');
  });
});

describe('sync lifecycle interruptions', () => {
  const stops: (() => void)[] = [];
  afterEach(() => { stops.splice(0).forEach(stop => stop()); vi.unstubAllGlobals(); });
  function start(api = client(), cache = emptyCache(), storage: StorageLike | null = memory()) {
    const local = stored('tools.v2', [{ tool, number: 8, store: null }], (v): v is { tool: typeof tool; number: number; store: null }[] => Array.isArray(v), () => storage);
    loadStoredLibraries(); saveCache(storage, 'test', cache); let allowed = true; const scheduled: (() => void)[] = [];
    const sync = startLibrarySync({ subject: 'test', display: '@test', storage, client: api, allowed: () => allowed, setTimeout: fn => { scheduled.push(fn); return 1; }, clearTimeout: () => {} });
    stops.push(sync.stop);
    return { sync, local, api, storage, scheduled, pause: () => { allowed = false; sync.wake(); }, resume: () => { allowed = true; sync.wake(); } };
  }
  it.each(['first', 'second', 'error'] as const)('ignores a delayed %s refresh after stop', async phase => {
    let finish!: () => void; const wait = new Promise<void>(resolve => { finish = resolve; }); const api = client();
    vi.mocked(api.list).mockImplementation(async kind => { if (phase !== 'second' || kind === 'material') await wait; if (phase === 'error') throw Error(); return []; });
    const r = start(api); await settle(); r.sync.stop(); finish(); await settle();
    expect(librarySyncView.value.mode).toBe('local'); expect(r.local.value.value[0]?.tool.id).toBe(tool.id);
    librarySyncActions.notNow(); librarySyncActions.dismiss(); await librarySyncActions.copy();
  });
  it('reschedules a refresh interrupted by a rapid pause and resume', async () => {
    let finish!: () => void; const wait = new Promise<void>(resolve => { finish = resolve; }); const api = client();
    vi.mocked(api.list).mockImplementationOnce(async () => { await wait; return []; });
    const r = start(api); r.pause(); r.resume(); finish(); await settle();
    expect(r.scheduled).toHaveLength(1); r.scheduled[0]!(); await settle(); expect(api.list).toHaveBeenCalledTimes(3);
  });
  it.each([Error('offline'), new RecordsError(500)])('retries failed refreshes', async error => {
    const api = client(); vi.mocked(api.list).mockRejectedValueOnce(error); const r = start(api); await settle();
    expect(librarySyncView.value.status).toBe('retry'); expect(r.scheduled).toHaveLength(1); r.scheduled[0]!(); await settle(); expect(librarySyncView.value.status).toBe('saved');
  });
  it('keeps pending changes if the page stops during a save', async () => {
    const cache = emptyCache(); enqueue(cache, 'tool', tool.id, tool);
    let finish!: () => void; const wait = new Promise<void>(resolve => { finish = resolve; }); const api = client();
    vi.mocked(api.put).mockImplementation(async () => { await wait; return rec(); }); const r = start(api, cache); await settle(); r.sync.stop(); finish(); await settle();
    expect(readCache(r.storage, 'test').pending).toHaveLength(1); expect(librarySyncView.value.mode).toBe('local');
  });
  it('does not rewrite unchanged records; archives removals and shows quota record ids', async () => {
    const api = client(); vi.mocked(api.list).mockImplementation(async kind => kind === 'tool' ? [rec()] : []); const r = start(api); await settle();
    r.local.set(r.local.value.value); await settle(); expect(api.put).not.toHaveBeenCalled();
    vi.mocked(api.archive).mockRejectedValue(new RecordsError(413)); r.local.set(r.local.value.value.filter(e => e.tool.id !== tool.id)); await settle(); expect(librarySyncView.value.remaining).toEqual([tool.id]);
    const count = vi.mocked(api.archive).mock.calls.length; r.sync.wake(); await settle(); expect(api.archive).toHaveBeenCalledTimes(count);
    r.local.set([{ tool, number: 8, store: null }]); await settle(); expect(api.put).not.toHaveBeenCalled(); expect(librarySyncView.value.status).toBe('quota');
  });
  it('keeps cache-refused writes in memory and serializes repeated Copy clicks', async () => {
    const r = start(client(), emptyCache(), null); await settle(); r.local.set([{ tool, number: 8, store: null }]); await settle(); expect(librarySyncView.value.status).toBe('retry');
    const copy = librarySyncActions.copy(); await librarySyncActions.copy(); await copy; expect(librarySyncView.value.status).toBe('retry'); expect(r.api.put).not.toHaveBeenCalled();
    const second = librarySyncActions.copy(); r.sync.stop(); await second; expect(librarySyncView.value.mode).toBe('local');
  });
  it('renders and invokes every notice action without a machine RPC', async () => {
    const { h } = await import('preact'); const { root, all } = await import('./tree.ts'); const { LibrarySyncNotice } = await import('../src/workspace/cloud/SyncNotice.ts');
    const r = start(); await settle();
    for (const button of all(root(h(LibrarySyncNotice, null)), e => e.tag === 'button')) await (button.props['onClick'] as () => unknown)();
    await settle();
    librarySyncView.value = { ...librarySyncView.value, status: 'quota', notice: 'Full', remaining: ['x'] };
    for (const button of all(root(h(LibrarySyncNotice, null)), e => e.tag === 'button')) await (button.props['onClick'] as () => unknown)();
    r.sync.stop();
  });
});

it('archives a newly created tool removed while its PUT was in flight, without resurrecting it', async () => {
  const cache = emptyCache(); const api = client(); enqueue(cache, 'tool', tool.id, tool);
  vi.mocked(api.put).mockImplementationOnce(async () => {
    enqueue(cache, 'tool', tool.id, null);
    enqueue(cache, 'tool', 'mine.two', { ...tool, id: 'mine.two' });
    return rec();
  });
  await drainQueue(cache, api, () => true, signal(), hooks());
  expect(api.archive).toHaveBeenCalledWith('tool', tool.id, 1, expect.any(AbortSignal));
  expect(visibleRecords(cache).map(r => r.id)).toEqual(['mine.two']);
});
it('retains a CAS edit even if a concurrent queue update removed its token', async () => {
  const cache = emptyCache(); enqueue(cache, 'tool', tool.id, tool); const api = client();
  vi.mocked(api.put).mockImplementationOnce(async () => { cache.pending = []; throw new RecordsError(409, rec({ ...tool, name: 'Server' })); });
  await drainQueue(cache, api, () => true, signal(), hooks()); expect(visibleRecords(cache)).toHaveLength(2);
  enqueue(cache, 'tool', 'new', null); const h = hooks(); h.persist.mockReturnValueOnce(true).mockReturnValue(false);
  expect(await drainQueue(cache, api, () => true, signal(), h)).toBe('retry');
});
it('resumes the entire confirmed import plan after a reload during preparation', async () => {
  const cache = emptyCache(); const source = [{ kind: 'tool' as const, id: tool.id, content: tool }, { kind: 'tool' as const, id: 'mine.two', content: { ...tool, id: 'mine.two' } }];
  let snapshot = ''; let saves = 0;
  expect(await prepareImport(cache, source, () => { snapshot = JSON.stringify(cache); return ++saves < 2; })).toBe(false);
  const resumed = JSON.parse(snapshot) as typeof cache;
  expect(resumed.consent).toBe(true); expect(resumed.importSource).toHaveLength(2);
  await prepareImport(resumed, [], () => true); expect(resumed.pending).toHaveLength(2); expect(resumed.importSource).toBeUndefined();
  expect(await prepareImport({ ...emptyCache(), importSource: [{ kind: 'tool', id: tool.id, content: {} }] }, [], () => true)).toBe(false);
});
it('validates and automatically resumes a durable import plan on account activation', async () => {
  const storage = memory(); const cache = emptyCache(); cache.consent = true; cache.importSource = [{ kind: 'tool', id: tool.id, content: tool }];
  saveCache(storage, 'resume', cache); expect(readCache(storage, 'resume').importSource).toHaveLength(1);
  for (const source of [null, [null], [{ kind: 'machine', id: tool.id, content: tool }], [{ kind: 'tool', id: '/', content: tool }], [{ kind: 'tool', id: tool.id, content: {} }]]) {
    storage.setItem(cacheKey('bad'), JSON.stringify({ ...cache, importSource: source })); expect(readCache(storage, 'bad')).toEqual(emptyCache());
  }
  stored('tools.v2', [], (v): v is unknown[] => Array.isArray(v), () => storage); loadStoredLibraries();
  const api = client(); const sync = startLibrarySync({ subject: 'resume', display: '@resume', storage, client: api, allowed: () => true, setTimeout: () => 1, clearTimeout: () => {} });
  await vi.waitFor(() => expect(api.put).toHaveBeenCalledOnce()); expect(librarySyncView.value.ask).toBe(false); sync.stop();
});
it('round trips material forks without losing inherited fields and retains unavailable parent versions as full records', () => {
  const parent = BUILTIN_MATERIALS[0]!; const fork = forkRecord('material', parent, 'mine.fork'); if (!fork.ok) throw Error();
  const records = toRecords('materials.v2', [{ ...fork.value, edits: { name: 'My material' } }]);
  expect(fromRecords('materials.v2', records)).toEqual([{ ...fork.value, edits: { name: 'My material' } }]);
  expect(fromRecords('materials.own.v1', records)).toEqual([]);
  for (const content of [parent, { ...parent, forkOf: { id: 'missing', version: 1 } }, { ...parent, forkOf: { id: parent.id, version: 999 } }]) {
    const rs = [{ kind: 'material' as const, id: content.id, content }];
    expect(fromRecords('materials.v2', rs)).toEqual([]); expect(fromRecords('materials.own.v1', rs)).toEqual([content]);
  }
});
it('reports an import preparation failure without losing its source plan', async () => {
  const storage = memory(); stored('tools.v2', [{ tool, number: 8, store: null }], (v): v is unknown[] => Array.isArray(v), () => storage); loadStoredLibraries();
  const api = client(); const sync = startLibrarySync({ subject: 'hash-fail', display: '@a', storage, client: api, allowed: () => false, setTimeout: () => 1, clearTimeout: () => {} });
  const hash = vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(Error('hash failed'));
  await librarySyncActions.copy(); expect(librarySyncView.value.notice).toContain('could not finish'); expect(readCache(storage, 'hash-fail').importSource).toHaveLength(1); hash.mockRestore(); sync.stop();
});
it('retains queued account edits and explains a session-expiry fallback without replacing the browser library', async () => {
  const storage = memory(); const local = stored('tools.v2', [{ tool, number: 8, store: null }], (v): v is { tool: typeof tool; number: number; store: null }[] => Array.isArray(v), () => storage); loadStoredLibraries();
  const api = client(); const sync = startLibrarySync({ subject: 'expires', display: '@a', storage, client: api, allowed: () => true, setTimeout: () => 1, clearTimeout: () => {} }); await settle();
  vi.mocked(api.put).mockRejectedValueOnce(new RecordsError(401)); local.set([...SEED_TOOLS.map(e => ({ ...e, store: null })), { tool: { ...tool, name: 'Pending edit' }, number: 8, store: null }]); await settle();
  expect(librarySyncView.value.mode).toBe('local'); expect(librarySyncView.value.notice).toContain('Pending account edits'); expect(readCache(storage, 'expires').pending).toHaveLength(1); expect(local.value.value[0]?.tool.name).toBe('My tool'); sync.stop();
});

it.each([true, false])('tool and material fork survive upload/download with carried fields unchanged (existing slot: %s)', async existingSlot => {
  const originalTool = { ...tool, notes: 'Keep these notes', tags: ['roughing'], ...(existingSlot ? { firmwareSlot: { t: 8, lengthOffset: 12.75 } } : {}) };
  const entry = { tool: originalTool, number: 8, store: 'BROWSER-ONLY-SKU' };
  const parent = BUILTIN_MATERIALS[0]!;
  const fork = forkRecord('material', parent, 'mine.roundtrip');
  if (!fork.ok) throw Error('invalid fixture');
  const originalFork = { ...fork.value, edits: { name: 'My round-trip material', notes: 'Keep this material note' } };
  const wire = [...toRecords('tools.v2', [entry]), ...toRecords('materials.v2', [originalFork])];
  const uploaded = new Map<string, CloudRecord>();
  const api = recordsClient(async (url, init) => {
    const kind = new URL(url, 'https://run.example').pathname.split('/')[3] as 'tool' | 'material';
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body as string) as { parent_rev: number | null; content: { id: string } };
      expect(body.parent_rev).toBeNull();
      const record: CloudRecord = { kind, id: body.content.id, rev: 1, archivedAt: null, content: body.content, sha256: 'a'.repeat(64) };
      uploaded.set(kind, record); return Response.json({ ok: true, record });
    }
    return Response.json({ records: [uploaded.get(kind)] });
  });
  for (const record of wire) await api.put(record.kind, record.id, null, record.content, signal());
  const downloadedTools = await api.list('tool', signal());
  const tools = fromRecords('tools.v2', downloadedTools as ReturnType<typeof toRecords>) as typeof SEED_TOOLS;
  expect(tools.find(e => e.tool.id === originalTool.id)).toEqual({ number: 8, store: null, tool: { ...originalTool, firmwareSlot: { t: 8, lengthOffset: existingSlot ? 12.75 : 0 } } });
  const downloadedMaterials = await api.list('material', signal());
  const forks = fromRecords('materials.v2', downloadedMaterials as ReturnType<typeof toRecords>);
  expect(forks).toEqual([originalFork]);
  expect(toRecords('materials.v2', forks)).toEqual(wire.filter(record => record.kind === 'material'));
  expect(originalFork.forkOf).toEqual({ id: parent.id, version: parent.version });
  expect(entry.store).toBe('BROWSER-ONLY-SKU');
});

it('names unnamed browser tool copies from their size and type', () => {
  expect(browserCopy({ ...tool, name: '' }, 'copy.unnamed').name).toBe('3.175 mm end mill (from this browser)');
  expect(browserCopy(BUILTIN_MATERIALS[0]!, 'copy.material').name).toBe(`${BUILTIN_MATERIALS[0]!.name} (from this browser)`);
});
it('keeps a deleted seed hidden pending upload, after archive, and after a fresh account read', async () => {
  const seed = SEED_TOOLS[0]!.tool; const cache = emptyCache(); const api = client();
  vi.mocked(api.archive).mockImplementation(async (_kind, _id, parent) => ({ ...rec(seed, parent + 1), archivedAt: 123 }));
  enqueue(cache, 'tool', seed.id, null);
  const ids = () => (fromRecords('tools.v2', visibleRecords(cache)) as typeof SEED_TOOLS).map(e => e.tool.id);
  expect(ids()).not.toContain(seed.id);
  expect(await drainQueue(cache, api, () => true, signal(), hooks())).toBe('saved');
  expect(api.put).toHaveBeenCalledWith('tool', seed.id, null, seed, expect.any(AbortSignal));
  expect(api.archive).toHaveBeenCalledWith('tool', seed.id, 1, expect.any(AbortSignal));
  expect(ids()).not.toContain(seed.id);
  const fresh = { ...emptyCache(), records: cache.records };
  expect((fromRecords('tools.v2', visibleRecords(fresh)) as typeof SEED_TOOLS).some(e => e.tool.id === seed.id)).toBe(false);
  enqueue(cache, 'tool', seed.id, seed);
  expect(ids()).toContain(seed.id);
});
it.each([false, true])('resumes an initial seed tombstone after a lost create response (archived=%s)', async archived => {
  const seed = SEED_TOOLS[0]!.tool; const cache = emptyCache(); const api = client();
  enqueue(cache, 'tool', seed.id, null);
  vi.mocked(api.put).mockRejectedValueOnce(new RecordsError(409, { ...rec(seed), archivedAt: archived ? 1 : null }));
  vi.mocked(api.archive).mockImplementation(async () => ({ ...rec(seed, 2), archivedAt: 1 }));
  expect(await drainQueue(cache, api, () => true, signal(), hooks())).toBe('saved');
  expect(api.archive).toHaveBeenCalledTimes(archived ? 0 : 1);
  expect((fromRecords('tools.v2', visibleRecords(cache)) as typeof SEED_TOOLS).some(e => e.tool.id === seed.id)).toBe(false);
});
it('retains the seed deletion when persistence fails after creation', async () => {
  const cache = emptyCache(); const api = client(); const h = hooks();
  enqueue(cache, 'tool', SEED_TOOLS[0]!.tool.id, null);
  h.persist.mockReturnValueOnce(true).mockReturnValueOnce(false);
  expect(await drainQueue(cache, api, () => true, signal(), h)).toBe('retry');
  expect(cache.pending[0]).toMatchObject({ content: null, parent: 1 });
});
it('does not accept an initial seed creation after cancellation', async () => {
  const cache = emptyCache(); const api = client(); const abort = new AbortController();
  const seed = SEED_TOOLS[0]!.tool; enqueue(cache, 'tool', seed.id, null);
  vi.mocked(api.put).mockImplementation(async () => { abort.abort(); return rec(seed); });
  expect(await drainQueue(cache, api, () => true, abort.signal, hooks())).toBe('saving');
  expect(cache.pending[0]).toMatchObject({ content: null, parent: null });
});
it('drops unsent material deletions without treating them as seed tombstones', async () => {
  const cache = emptyCache(); const material = BUILTIN_MATERIALS[0]!;
  enqueue(cache, 'material', material.id, null);
  expect(visibleRecords(cache)).toEqual([]);
  expect(await drainQueue(cache, client(), () => true, signal(), hooks())).toBe('saved');
});
it('deleting an unchanged seed through the signed-in store stays deleted after a fresh session', async () => {
  const storage = memory(); const seed = SEED_TOOLS[0]!.tool;
  const local = stored('tools.v2', SEED_TOOLS, (v): v is typeof SEED_TOOLS => Array.isArray(v), () => storage);
  loadStoredLibraries(); const api = client(); let archived: CloudRecord | null = null;
  vi.mocked(api.list).mockImplementation(async kind => kind === 'tool' && archived !== null ? [archived] : []);
  vi.mocked(api.archive).mockImplementation(async () => { archived = { ...rec(seed), archivedAt: 1 }; return archived; });
  const options = { subject: 'seed-delete', display: '@a', storage, client: api, allowed: () => true, setTimeout: () => 1, clearTimeout: () => {} };
  const first = startLibrarySync(options); await settle();
  local.set(local.value.value.filter(e => e.tool.id !== seed.id)); await settle();
  expect(api.archive).toHaveBeenCalledWith('tool', seed.id, 1, expect.any(AbortSignal));
  expect(local.value.value.some(e => e.tool.id === seed.id)).toBe(false); first.stop();
  const fresh = startLibrarySync({ ...options, storage: memory() }); await settle();
  expect(local.value.value.some(e => e.tool.id === seed.id)).toBe(false); fresh.stop();
});

it('does not archive a concurrent account edit when creating a seed tombstone conflicts', async () => {
  const cache = emptyCache(); const seed = SEED_TOOLS[0]!.tool; const api = client(); const h = hooks();
  enqueue(cache, 'tool', seed.id, null);
  vi.mocked(api.put).mockRejectedValueOnce(new RecordsError(409, rec({ ...seed, name: 'Account edit' })));
  expect(await drainQueue(cache, api, () => true, signal(), h)).toBe('saved');
  expect(api.archive).not.toHaveBeenCalled();
  expect(visibleRecords(cache)[0]?.content.name).toBe('Account edit');
  expect(h.notice).toHaveBeenCalledOnce();
});
