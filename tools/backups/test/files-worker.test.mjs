import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filesScheduled } from '../../../workers/backup/src/files-scheduled.ts';
import { FakeFiles, fileKey, virtualClock } from './files-fixture.mjs';
import { digestRuntime } from './digest-fixture.mjs';
function fixture() {
  const source = new FakeFiles(), backup = new FakeFiles(), logs = [];
  const job = { source, backup, environment: 'production', date: new Date('2026-11-02T07:50:00Z'), log: record => logs.push(record) };
  const clock = virtualClock();
  const run = options => filesScheduled(job, { now: clock.now, sleep: clock.sleep, ...options });
  return { source, backup, logs, job, run };
}
test('first run streams all objects, warm run skips unchanged files including empty files', async () => {
  const f = fixture();
  for (const text of ['one', 'two', '']) f.source.seed(fileKey(text), text);
  await f.run();
  assert.equal(f.logs.at(-1).copied, 3); assert.equal(f.logs.at(-1).sourceObjects, 3); assert.equal(f.logs.at(-1).backupObjects, 3);
  assert.ok(f.backup.puts.filter(p => p.key.startsWith('files/') && !p.key.includes(fileKey(''))).every(p => p.streamed));
  await f.run(); assert.equal(f.logs.at(-1).copied, 0); assert.equal(f.logs.at(-1).skipped, 3);
});
test('interruption mid-page replays only the uncheckpointed page and retains copied bytes', async () => {
  const f = fixture(); f.source.pageSize = 2;
  for (const key of ['a', 'b', 'c', 'd']) f.source.seed(key, key);
  f.backup.failKey = 'files/d';
  await assert.rejects(f.run(), /File backup failed/);
  assert.equal(JSON.parse(await (await f.backup.get('backup-state/run-files.json')).text()).copy.cursor, 'b');
  assert.ok(f.backup.values.has('files/c'));
  f.backup.failKey = undefined; await f.run();
  assert.equal(f.logs.at(-1).copied, 1); assert.equal(f.logs.at(-1).skipped, 1);
  assert.equal(f.logs.at(-1).sourceObjects, 4); assert.equal(f.logs.at(-1).backupObjects, 3); // Maintenance took its first turn before the last copy.
  await f.run(); assert.equal(f.logs.at(-1).backupObjects, 4);
  assert.ok(!JSON.stringify(f.logs).includes('private bucket error'));
});
test('object budget resumes across triggers rather than restarting the first page', async () => {
  const f = fixture(); for (const key of ['a', 'b', 'c']) f.source.seed(key, key);
  await f.run({ maxObjects: 2 }); assert.equal(f.logs.at(-1).status, 'partial');
  await f.run({ maxObjects: 2 }); assert.equal(f.logs.at(-1).copied, 1); assert.equal(f.logs.at(-1).sourceObjects, 3);
});
test('a changed etag is recopied even when the length is unchanged', async () => {
  const f = fixture(); f.source.seed('mutable', 'old'); await f.run(); f.source.seed('mutable', 'new'); await f.run();
  assert.equal(await (await f.backup.get('files/mutable')).text(), 'new'); assert.equal(f.logs.at(-1).copied, 1);
});
test('source deletion never deletes the backup', async () => {
  const f = fixture(); f.source.seed('keep', 'bytes'); await f.run(); f.source.values.delete('keep'); await f.run();
  assert.equal(await (await f.backup.get('files/keep')).text(), 'bytes');
  assert.equal(f.logs.at(-1).sourceObjects, 0); assert.equal(f.logs.at(-1).backupObjects, 1);
});
test('monthly sampled restore detects corrupt bytes even when metadata size and etag match', async () => {
  digestRuntime(); const f = fixture(), key = fileKey('good'); f.source.seed(key, 'good'); await f.run();
  f.backup.values.get(`files/${key}`).bytes = Buffer.from('evil'); f.job.date = new Date('2026-12-01');
  await assert.rejects(f.run(), /File backup failed/); assert.equal(f.logs.at(-1).failed, 1);
  f.job.date = new Date('2026-12-02');
  await assert.rejects(f.run(), /File backup failed/); // The due marker survives the failure on day one.
});
test('monthly sampled restore verifies digest and empty files successfully', async () => {
  digestRuntime(); const f = fixture(); for (const text of ['', 'good']) f.source.seed(fileKey(text), text);
  f.job.date = new Date('2026-12-01'); await f.run(); assert.equal(f.logs.at(-1).restore, 'passed');
});
test('staging objects and cursors never use production paths', async () => {
  const f = fixture(); f.job.environment = 'staging'; f.source.seed('key', 'bytes'); await f.run();
  assert.ok(f.backup.values.has('staging/files/key')); assert.ok(f.backup.values.has('staging/backup-state/run-files.json'));
  assert.ok([...f.backup.values.keys()].every(k => k.startsWith('staging/')));
});
test('an absent source is a logged skip without accessing the destination', async () => {
  const f = fixture(); f.job.source = undefined; f.job.backup = {}; await f.run();
  assert.deepEqual(f.logs, [{ component: 'files', status: 'skipped', reason: 'source-bucket-absent' }]);
});
test('source mutation between list and get is retried without committing mismatched bytes', async () => {
  const f = fixture(); f.source.seed('key', 'old'); const get = f.source.get.bind(f.source);
  f.source.get = async (...args) => { f.source.seed('key', 'new'); return get(...args); };
  await assert.rejects(f.run(), /File backup failed/); assert.ok(!f.backup.values.has('files/key'));
});
test('oversized objects fail visibly without consuming their body', async () => {
  const f = fixture(); f.source.list = async () => ({ objects: [{ key: 'large', size: 50 * 1024 * 1024 + 1, etag: 'x' }], truncated: false });
  f.source.get = () => { throw new Error('should not read'); };
  await assert.rejects(f.run(), /File backup failed/); assert.equal(f.logs.at(-1).failed, 1);
});

test('soft deadline mid-page replays the page without losing its uncopied tail', async () => {
  const f = fixture(); for (const key of ['a', 'b', 'c']) f.source.seed(key, key);
  let time = 0; const put = f.backup.put.bind(f.backup);
  f.backup.put = async (...args) => { const value = await put(...args); if (args[0] === 'files/a') time = 5000; return value; };
  const options = { now: () => time, sleep: async ms => { time += ms; }, maxMs: 5000 };
  await f.run(options);
  assert.equal(f.logs.at(-1).sourceComplete, false); assert.equal(f.logs.at(-1).copied, 1);
  time = 0; await f.run(options);
  assert.equal(f.logs.at(-1).copied, 2); assert.equal(f.logs.at(-1).sourceObjects, 3);
});
test('inventory counts and pending monthly verification resume across pages', async () => {
  digestRuntime(); const f = fixture(); f.backup.pageSize = 2; f.job.date = new Date('2026-12-01');
  for (const text of ['a', 'b', 'c']) f.backup.seed(`files/${fileKey(text)}`, text);
  await f.run({ maxPages: 1, random: () => 0 });
  assert.equal(f.logs.at(-1).backupObjects, 2); assert.equal(f.logs.at(-1).backupComplete, false); assert.equal(f.logs.at(-1).restore, 'pending');
  f.job.date = new Date('2026-12-02'); await f.run({ maxPages: 1 });
  assert.equal(f.logs.at(-1).backupObjects, 3); assert.equal(f.logs.at(-1).restore, 'passed');
});
test('a failed checkpoint safely replays already copied objects on the next trigger', async () => {
  const f = fixture(); f.source.seed('key', 'bytes'); const put = f.backup.put.bind(f.backup);
  f.backup.put = async (...args) => { const result = await put(...args); if (args[0] === 'files/key') f.backup.failKey = 'backup-state/run-files.json'; return result; };
  await assert.rejects(f.run(), /File backup failed/);
  f.backup.failKey = undefined; await f.run();
  assert.equal(f.logs.at(-1).copied, 0); assert.equal(f.logs.at(-1).skipped, 1); assert.equal(f.logs.at(-1).sourceComplete, true);
});
test('a content-address mismatch refuses the upload instead of retaining bad bytes', async () => {
  const f = fixture(), key = fileKey('good'); f.source.seed(key, 'evil');
  await assert.rejects(f.run(), /File backup failed/); assert.ok(!f.backup.values.has(`files/${key}`));
});
