import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkpoints } from '../../../workers/backup/src/files/checkpoint.ts';
import { loadState } from '../../../workers/backup/src/files/state.ts';
import { filesScheduled } from '../../../workers/backup/src/files/scheduled.ts';
import { FakeFiles, fileKey, virtualClock } from './files-fixture.mjs';
import { RateAwareFiles } from './rate-aware-files.mjs';
import { digestRuntime } from './digest-fixture.mjs';

const KEY = 'backup-state/run-files.json';
const state = () => ({ version: 1, copy: { count: 0, complete: false }, inventory: { count: 0, complete: false }, samples: [], restoreDue: false });
function fixture(maxMs = 10_000) {
  const clock = virtualClock(), backup = new RateAwareFiles(clock), source = new FakeFiles(), logs = [];
  const options = { now: clock.now, sleep: clock.sleep, maxMs };
  const job = { source, backup, environment: 'production', date: new Date('2026-12-02'), log: value => logs.push(value) };
  return { clock, backup, source, logs, options, job, run: () => filesScheduled(job, options) };
}
test('all scheduled cursor writes respect the per-key interval, including monthly samples', async () => {
  digestRuntime(); const f = fixture(30_000); f.source.pageSize = 1; f.backup.pageSize = 1;
  for (const text of ['one', 'two', 'three']) f.source.seed(fileKey(text), text);
  f.job.date = new Date('2026-12-01'); await f.run();
  const writes = f.backup.attempts.filter(p => p.key === KEY);
  assert.ok(writes.length > 5);
  assert.ok(writes.slice(1).every((write, i) => write.at - writes[i].at >= 1000));
  assert.equal(f.logs.at(-1).restore, 'passed');
  assert.equal((await loadState(f.backup, KEY)).restoreDue, false);
});
test('an unchanged checkpoint is skipped, even when no time remains', async () => {
  const f = fixture(), value = state(); f.backup.seed(KEY, JSON.stringify(value));
  const writer = checkpoints(f.backup, KEY, { ...f.options, deadline: 1000 }, value);
  f.clock.advance(1000);
  assert.equal(await writer.save(value), true);
  assert.equal(f.backup.attempts.length, 0);
});
test('a prior invocation write gets bounded backoff before retrying the first checkpoint', async () => {
  const f = fixture(), value = state(); f.backup.seed(KEY, JSON.stringify(value)); f.backup.lastWrites.set(KEY, 0);
  const writer = checkpoints(f.backup, KEY, { ...f.options, deadline: 5000 }, value);
  value.copy.count = 1;
  assert.equal(await writer.save(value), true);
  assert.deepEqual(f.backup.attempts.map(p => p.at), [0, 1000]);
  assert.equal((await loadState(f.backup, KEY)).copy.count, 1);
});
test('a deadline too close for the next paced write keeps the last durable checkpoint', async () => {
  const f = fixture(), value = state(), writer = checkpoints(f.backup, KEY, { ...f.options, deadline: 1000 }, value);
  value.copy.count = 1; assert.equal(await writer.save(value), true);
  value.copy.count = 2; assert.equal(await writer.save(value), false);
  assert.equal((await loadState(f.backup, KEY)).copy.count, 1);
  assert.equal(f.clock.now(), 0); // No wait when it would reach/exceed the deadline.
  assert.equal(writer.available(), false);
});
test('persistent 429 retries stop after three attempts without replacing durable state', async () => {
  const f = fixture(), value = state(); f.backup.seed(KEY, JSON.stringify(value)); const attempts = [];
  f.backup.put = async () => { attempts.push(f.clock.now()); throw new Error('R2 429'); };
  const writer = checkpoints(f.backup, KEY, { ...f.options, deadline: 100_000 }, value);
  value.copy.count = 2;
  assert.equal(await writer.save(value), false);
  assert.deepEqual(attempts, [0, 1000, 3000]);
  assert.equal((await loadState(f.backup, KEY)).copy.count, 0);
});
test('backoff does not retry past the invocation deadline', async () => {
  const f = fixture(), value = state(); f.backup.seed(KEY, JSON.stringify(value)); f.backup.lastWrites.set(KEY, 0);
  const writer = checkpoints(f.backup, KEY, { ...f.options, deadline: 500 }, value);
  value.copy.count = 1;
  assert.equal(await writer.save(value), false);
  assert.equal(f.backup.attempts.length, 1);
  assert.equal((await loadState(f.backup, KEY)).copy.count, 0);
});
test('an overslept pacing delay never starts a late write', async () => {
  const f = fixture(), value = state();
  const writer = checkpoints(f.backup, KEY, { now: f.clock.now, sleep: async () => f.clock.advance(5000), deadline: 3000 }, value);
  value.copy.count = 1; await writer.save(value); value.copy.count = 2;
  assert.equal(await writer.save(value), false);
  assert.equal(f.backup.attempts.length, 1);
});
test('non-throttling failures still fail visibly without replacing durable state', async () => {
  const f = fixture(), value = state(); f.backup.seed(KEY, JSON.stringify(value)); f.backup.failKey = KEY;
  const writer = checkpoints(f.backup, KEY, { ...f.options, deadline: 5000 }, value);
  value.copy.count = 1;
  await assert.rejects(writer.save(value), /private bucket error/);
  assert.equal((await loadState(f.backup, KEY)).copy.count, 0);
});
test('copy runs that always consume the deadline cannot starve paged inventory and restore', async () => {
  digestRuntime(); const f = fixture(10_000); f.backup.pageSize = 3; f.options.maxPages = 1;
  for (let i = 0; i < 20; i++) f.source.seed(String(i).padStart(3, '0'), 'bytes');
  for (const text of ['a', 'b', 'c', 'd', 'e']) f.backup.seed(`files/${fileKey(text)}`, text);
  const put = f.backup.put.bind(f.backup); let deadline;
  f.backup.put = async (key, ...args) => { const result = await put(key, ...args); if (key.startsWith('files/')) f.clock.advance(deadline - f.clock.now()); return result; };
  let inventoryAdvanced = false, restored = false;
  for (let day = 1; day <= 14; day++) {
    f.clock.advance(100_000); deadline = f.clock.now() + f.options.maxMs;
    f.job.date = new Date(`2026-12-${String(day).padStart(2, '0')}`); await f.run();
    inventoryAdvanced ||= (await loadState(f.backup, KEY)).inventory.count > 0;
    restored ||= f.logs.at(-1).restore === 'passed';
  }
  assert.equal(inventoryAdvanced, true);
  assert.equal(restored, true);
  assert.ok(f.logs.filter(log => log.copied > 0).length > 1);
  assert.ok(f.logs.every(log => log.sourceComplete === false));
});
test('old checkpoints without a phase retain their copy cursor and acquire fair scheduling', async () => {
  const f = fixture(), value = state(); value.copy = { count: 1, cursor: 'a', complete: false };
  f.backup.seed(KEY, JSON.stringify(value)); f.source.seed('a', 'a'); f.source.seed('b', 'b');
  await f.run();
  assert.equal(f.logs.at(-1).copied, 1);
  assert.equal((await loadState(f.backup, KEY)).nextPhase, 'maintenance');
});
