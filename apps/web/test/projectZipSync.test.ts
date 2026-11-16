import { expect, it, vi } from 'vitest';
import { makeProjectStore } from '../src/projects/browserStore.ts';
import { emptyCache } from '../src/workspace/cloud/cloudCache.ts';
import { projectRecords } from '../src/workspace/cloud/projectRecords.ts';
import { startProjectSync } from '../src/workspace/cloud/projectSync.ts';
import { drainQueue, enqueue } from '../src/workspace/cloud/syncQueue.ts';
import { api, projectContext, record } from './syncFixtures.ts';
import { zipFixture } from './zipFixtures.ts';

it.each(['account', 'browser copy'])('uploads imported %s bytes before the record', async mode => {
  const { zip, p } = await zipFixture(); const context = projectContext(); const cache = emptyCache(); const order: string[] = [];
  const hooks = { persist: () => true, change: vi.fn(), notice: vi.fn() };
  const records = projectRecords({ subject: 'alice', records: context.records, cache, active: () => true, ...hooks });
  const store = mode === 'account' ? makeProjectStore(records) : context.local;
  await store.importZip(zip, { validateImage: async () => {} });
  if (mode === 'browser copy') enqueue(cache, 'project', p.id, p);
  expect(cache.pending).toHaveLength(1);
  if (mode === 'account') expect(await context.local.blob('f1')).toBeNull();
  vi.mocked(context.files.put).mockImplementation(async hash => { order.push(hash); });
  const client = api(); vi.mocked(client.put).mockImplementation(async () => { order.push('record'); return record('project', p); });
  const sync = startProjectSync({ subject: 'alice', context, cache, allowed: () => true, ...hooks });
  try {
    expect(await drainQueue(cache, client, () => true, new AbortController().signal, { ...hooks, prepare: sync.prepare })).toBe('saved');
    expect(order).toEqual([p.files[0]!.hash, p.images[0]!.hash, 'record']);
    const bob = makeProjectStore(projectRecords({ subject: 'bob', records: context.records, cache: emptyCache(), active: () => true, ...hooks }));
    if (mode === 'account') expect(await bob.blob('f1')).toBeNull();
    else expect(await (await bob.blob('f1'))!.text()).toBe('G0 X1\n');
  } finally { sync.stop(); }
});
