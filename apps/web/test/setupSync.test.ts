import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_SETUP_RECORD, type SetupRecord } from '@synthetos/library';
import { RecordsError } from '../src/cloud/recordsClient.ts';
import { emptyCache } from '../src/workspace/cloud/cloudCache.ts';
import { connectSetup, defaultStock, saveSetup, setupView } from '../src/workspace/cloud/setupSync.ts';
import { drainQueue } from '../src/workspace/cloud/syncQueue.ts';
import { SEED_SETUP } from '../src/workspace/library.ts';
import { api, machine, record } from './syncFixtures.ts';

const NOW = () => new Date('2026-11-18T12:00:00.000Z');
const hooks = () => ({ persist: vi.fn(() => true), change: vi.fn() });
const setup = (patch: Partial<SetupRecord> = {}): SetupRecord => ({ ...EMPTY_SETUP_RECORD, ...patch });
let stop: (() => void) | null = null;
afterEach(() => { stop?.(); stop = null; });

describe('the account setup record on the page', () => {
  it('publishes no account before connect, the counts after show, and refreshed after the first read', () => {
    expect(setupView.value).toEqual({ record: null, machines: 0, refreshed: false, account: false });
    const cache = emptyCache(); cache.records = [record('machine', machine), record('setup', setup({ step: 3 }))];
    const link = connectSetup(cache, hooks()); stop = link.stop;
    expect(setupView.value).toMatchObject({ machines: 1, refreshed: false, account: true, record: { step: 3 } });
    link.refreshed();
    expect(setupView.value.refreshed).toBe(true);
  });

  it('saveSetup merges a patch onto the account record, queues one write on the record rev, and bumps updatedAt', () => {
    const cache = emptyCache(); cache.records = [record('setup', setup({ step: 2, done: [1] }), 3)];
    const h = hooks(); stop = connectSetup(cache, h).stop;
    expect(saveSetup({ step: 4, done: [1, 2, 3] }, NOW)).toBe(true);
    expect(cache.pending).toHaveLength(1);
    expect(cache.pending[0]).toMatchObject({ kind: 'setup', id: 'setup', parent: 3, content: { step: 4, done: [1, 2, 3], updatedAt: '2026-11-18T12:00:00.000Z' } });
    expect(setupView.value.record).toMatchObject({ step: 4, done: [1, 2, 3] });
    expect(h.persist).toHaveBeenCalledOnce();
    expect(h.change).toHaveBeenCalledOnce();
  });

  it('a second save before the first is sent replaces the pending write and keeps the same parent', () => {
    const cache = emptyCache(); cache.records = [record('setup', setup(), 3)];
    stop = connectSetup(cache, hooks()).stop;
    saveSetup({ step: 2 }, NOW); saveSetup({ homing: 'none' }, NOW);
    expect(cache.pending).toHaveLength(1);
    expect(cache.pending[0]).toMatchObject({ parent: 3, content: { step: 2, homing: 'none' } });
  });

  it('the first save of a new account creates the record with no parent', () => {
    const cache = emptyCache(); stop = connectSetup(cache, hooks()).stop;
    saveSetup({ dismissed: true }, NOW);
    expect(cache.pending[0]).toMatchObject({ parent: null, content: { ...EMPTY_SETUP_RECORD, dismissed: true, updatedAt: '2026-11-18T12:00:00.000Z' } });
  });

  it('a refresh that brings rev 4 makes the next save use parent 4', () => {
    const cache = emptyCache(); cache.records = [record('setup', setup(), 3)];
    const link = connectSetup(cache, hooks()); stop = link.stop;
    cache.records = [record('setup', setup({ step: 5 }), 4)]; link.refreshed();
    saveSetup({ step: 6 }, NOW);
    expect(cache.pending[0]).toMatchObject({ parent: 4, content: { step: 6 } });
  });

  it('a conflict on the setup record keeps the account version and makes no copy', async () => {
    const cache = emptyCache(); cache.records = [record('setup', setup(), 3)];
    stop = connectSetup(cache, hooks()).stop;
    saveSetup({ step: 2 }, NOW);
    const current = record('setup', setup({ step: 5 }), 4);
    const client = api(); client.put = vi.fn(async () => { throw new RecordsError(409, current); });
    const notice = vi.fn();
    expect(await drainQueue(cache, client, () => true, new AbortController().signal, { persist: () => true, change: () => undefined, notice })).toBe('saved');
    expect(cache.pending).toEqual([]);
    expect(cache.records).toEqual([current]);
    expect(notice).not.toHaveBeenCalled();
  });

  it('saveSetup is false and writes nothing without an account', () => {
    const cache = emptyCache();
    expect(saveSetup({ step: 2 }, NOW)).toBe(false);
    expect(cache.pending).toEqual([]);
  });

  it('defaultStock is the record stock until a project uses it', () => {
    const cache = emptyCache(); cache.records = [record('setup', setup({ stock: SEED_SETUP.stock }))];
    const link = connectSetup(cache, hooks()); stop = link.stop;
    expect(defaultStock.value).toEqual(SEED_SETUP.stock);
    saveSetup({ projectId: 'p-1' }, NOW);
    expect(defaultStock.value).toBeNull();
  });

  it('stop resets the view to no account', () => {
    const cache = emptyCache(); const link = connectSetup(cache, hooks());
    link.stop();
    expect(setupView.value).toEqual({ record: null, machines: 0, refreshed: false, account: false });
    expect(saveSetup({ step: 2 }, NOW)).toBe(false);
  });
});
