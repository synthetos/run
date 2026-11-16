import { describe, expect, it } from 'vitest';
import { FILE_MAX_BYTES } from '@synthetos/contracts';
import { FileStore } from '../src/files.ts';
import { RecordStore } from '../src/store.ts';
import { FakeBucket, collect, gate, sha256, stream } from './fakeBucket.ts';
import { database } from './harness.ts';

const a = { userId: 'usr_alice', label: '@alice' }; const b = { userId: 'usr_bob', label: '@bob' };
const bytes = new TextEncoder().encode('G21\nG0 X0 Y0\n');
const hash = sha256(bytes);
const other = new TextEncoder().encode('M30\n'); const otherHash = sha256(other);
const setup = () => { const { db, sql } = database(); const bucket = new FakeBucket(); return { db, sql, bucket, store: new FileStore(db, bucket) }; };
type Sql = ReturnType<typeof database>['sql'];
const used = (sql: Sql, user: string) => sql.prepare('SELECT used_bytes FROM account_storage WHERE user_id=?').get(user)?.['used_bytes'] ?? 0;
const changes = (sql: Sql) => sql.prepare('SELECT summary FROM changes ORDER BY rowid').all().map((r) => r['summary']);
const states = (sql: Sql) => sql.prepare('SELECT sha256,state FROM files ORDER BY sha256').all().map((r) => `${String(r['sha256']).slice(0, 6)}:${r['state']}`);
const AT = '2026-11-15T12:00:00.000Z';
const projectNaming = (fileHash: string) => ({ v: 1, id: 'plate', name: 'Plate', description: '', cover: null, images: [], files: [{ id: 'f1', name: 'plate.nc', size: bytes.byteLength, hash: fileHash, role: 'gcode', note: '', addedAt: AT }], links: [], setup: { machine: null, stock: null, material: null, tools: [] }, jobs: [], tags: [], createdAt: AT, updatedAt: AT });

describe('account files: storing', () => {
  it('store once by digest, per account, under a token key, and count the bytes from the reservation on', async () => {
    const { sql, bucket, store } = setup();
    expect(await store.putFile(a, hash, bytes.byteLength, stream(bytes))).toMatchObject({ ok: true, existed: false, file: { sha256: hash, size: bytes.byteLength } });
    const keys = [...bucket.objects.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(new RegExp(`^u/${a.userId}/${hash}-[0-9a-f]{32}$`));
    expect(used(sql, a.userId)).toBe(bytes.byteLength);
    expect(states(sql)).toEqual([`${hash.slice(0, 6)}:ready`]);
    expect(await store.putFile(a, hash, bytes.byteLength, stream(bytes))).toMatchObject({ ok: true, existed: true });
    expect(used(sql, a.userId)).toBe(bytes.byteLength);
    expect(await store.listFiles(a)).toMatchObject([{ sha256: hash }]);
    expect(await store.listFiles(b)).toEqual([]);
    expect(await store.getFile(b, hash)).toEqual({ ok: false, error: 'not_found' });
    const got = await store.getFile(a, hash);
    expect(got.ok && new TextDecoder().decode(await collect(got.body))).toBe('G21\nG0 X0 Y0\n');
    expect(changes(sql)).toEqual(['Stored file']);
    sql.close();
  });

  it('refuse bad names, sizes and actors before touching anything', async () => {
    const { sql, bucket, store } = setup();
    expect(await store.putFile(a, 'abc', 3, stream(bytes))).toEqual({ ok: false, error: 'invalid' });
    expect(await store.putFile(a, hash, 0, stream(bytes))).toEqual({ ok: false, error: 'invalid' });
    expect(await store.putFile(a, hash, FILE_MAX_BYTES + 1, stream(bytes))).toEqual({ ok: false, error: 'invalid' });
    expect(await store.putFile({ userId: 'alice', label: '' }, hash, 3, stream(bytes))).toEqual({ ok: false, error: 'invalid' });
    expect(await store.getFile(a, 'abc')).toEqual({ ok: false, error: 'invalid' });
    expect(await store.deleteFile(a, 'abc')).toEqual({ ok: false, error: 'invalid' });
    expect(await store.listFiles({ userId: 'x', label: 'x' })).toEqual([]);
    expect(bucket.objects.size).toBe(0);
    expect(sql.prepare('SELECT COUNT(*) n FROM files').get()).toMatchObject({ n: 0 });
    sql.close();
  });

  it('keep nothing when the bytes do not match the digest or the size, or the bucket is down, and release the budget', async () => {
    const { sql, bucket, store } = setup();
    expect(await store.putFile(a, 'c'.repeat(64), bytes.byteLength, stream(bytes))).toEqual({ ok: false, error: 'mismatch' });
    expect(await store.putFile(a, hash, bytes.byteLength + 1, stream(bytes))).toEqual({ ok: false, error: 'mismatch' });
    bucket.failWith = new Error('connection reset');
    expect(await store.putFile(a, hash, bytes.byteLength, stream(bytes))).toEqual({ ok: false, error: 'failed' });
    bucket.failWith = null;
    expect(bucket.objects.size).toBe(0);
    expect(used(sql, a.userId)).toBe(0);
    expect(sql.prepare('SELECT COUNT(*) n FROM files').get()).toMatchObject({ n: 0 });
    expect(changes(sql)).toEqual(['Stored file', 'Refused file', 'Stored file', 'Refused file', 'Stored file', 'Refused file']);
    // A size mismatch whose cleanup delete also fails still releases the row: the stale size never sticks.
    bucket.failWith = new Error('down'); bucket.failDeletes = true;
    const accepted = new FakeBucket(); const store2 = new FileStore(setup().db, accepted);
    void store2;
    expect(await store.putFile(a, hash, bytes.byteLength, stream(bytes))).toEqual({ ok: false, error: 'failed' });
    expect(used(sql, a.userId)).toBe(0);
    sql.close();
  });

  it('refuse a file the budget cannot hold, atomically', async () => {
    const { sql, bucket, store } = setup();
    await store.putFile(a, hash, bytes.byteLength, stream(bytes));
    sql.prepare('UPDATE account_storage SET limit_bytes=used_bytes WHERE user_id=?').run(a.userId);
    expect(await store.putFile(a, otherHash, other.byteLength, stream(other))).toEqual({ ok: false, error: 'quota' });
    expect(bucket.objects.size).toBe(1);
    expect(sql.prepare('SELECT COUNT(*) n FROM files').get()).toMatchObject({ n: 1 });
    sql.close();
  });
});

describe('account files: in flight, deleting and racing', () => {
  it('answer busy, not success, while the same file is still uploading; the first upload decides', async () => {
    const { sql, bucket, store } = setup();
    const held = gate(); bucket.hold = held.promise;
    const first = store.putFile(a, hash, bytes.byteLength, stream(bytes));
    await new Promise((r) => setTimeout(r, 10));
    expect(states(sql)).toEqual([`${hash.slice(0, 6)}:pending`]);
    expect(await store.putFile(a, hash, bytes.byteLength, stream(bytes))).toEqual({ ok: false, error: 'busy' });
    expect(await store.getFile(a, hash)).toEqual({ ok: false, error: 'not_found' });
    expect(await store.listFiles(a)).toEqual([]);
    expect(await store.deleteFile(a, hash)).toEqual({ ok: false, error: 'busy' });
    held.open();
    expect(await first).toMatchObject({ ok: true, existed: false });
    expect(await store.getFile(a, hash)).toMatchObject({ ok: true });
    sql.close();
  });

  it('two simultaneous first uploads: one stores, the other is busy, the budget counts the file once', async () => {
    const { sql, store } = setup();
    const results = await Promise.all([store.putFile(a, otherHash, other.byteLength, stream(other)), store.putFile(a, otherHash, other.byteLength, stream(other))]);
    expect(results.filter((r) => r.ok && !r.existed)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === 'busy')).toHaveLength(1);
    expect(used(sql, a.userId)).toBe(other.byteLength);
    sql.close();
  });

  it('delete a file nobody names, never one a live project names, in one atomic step', async () => {
    const { db, sql, bucket, store } = setup();
    await store.putFile(a, hash, bytes.byteLength, stream(bytes));
    const records = new RecordStore(db);
    expect((await records.put(a, 'project', 'plate', null, projectNaming(hash))).ok).toBe(true);
    expect(await store.deleteFile(a, hash)).toEqual({ ok: false, error: 'in_use' });
    expect(states(sql)).toEqual([`${hash.slice(0, 6)}:ready`]);
    expect(await store.deleteFile(b, hash)).toEqual({ ok: false, error: 'not_found' });
    expect((await records.archive(a, 'project', 'plate', 1)).ok).toBe(true);
    expect(await store.deleteFile(a, hash)).toMatchObject({ ok: true, file: { sha256: hash } });
    expect(bucket.objects.size).toBe(0);
    expect(used(sql, a.userId)).toBe(new TextEncoder().encode(JSON.stringify(projectNaming(hash))).length);
    expect(await store.deleteFile(a, hash)).toEqual({ ok: false, error: 'not_found' });
    expect(changes(sql).filter((s) => s !== 'Saved record' && s !== 'Archived record')).toEqual(['Stored file', 'Removed file']);
    await store.putFile(a, hash, bytes.byteLength, stream(bytes));
    expect(() => sql.exec("UPDATE files SET bytes=1")).toThrow('files_fixed');
    sql.close();
  });

  it('a delete the bucket refuses stays retryable, and never removes a newer upload of the same digest', async () => {
    const { sql, bucket, store } = setup();
    await store.putFile(a, hash, bytes.byteLength, stream(bytes));
    bucket.failWith = new Error('down'); bucket.failDeletes = true;
    expect(await store.deleteFile(a, hash)).toEqual({ ok: false, error: 'failed' });
    expect(states(sql)).toEqual([`${hash.slice(0, 6)}:deleting`]);
    expect(await store.getFile(a, hash)).toEqual({ ok: false, error: 'not_found' });
    expect(await store.putFile(a, hash, bytes.byteLength, stream(bytes))).toEqual({ ok: false, error: 'busy' });
    bucket.failWith = null; bucket.failDeletes = false;
    expect(await store.deleteFile(a, hash)).toMatchObject({ ok: true });
    expect(bucket.objects.size).toBe(0); expect(used(sql, a.userId)).toBe(0);
    // A delete paused at the bucket while a new upload of the same digest completes removes only its own object.
    await store.putFile(a, hash, bytes.byteLength, stream(bytes));
    const held = gate(); bucket.hold = held.promise;
    const removal = store.deleteFile(a, hash);
    await new Promise((r) => setTimeout(r, 10));
    expect(await store.putFile(a, hash, bytes.byteLength, stream(bytes))).toEqual({ ok: false, error: 'busy' });
    held.open();
    expect(await removal).toMatchObject({ ok: true });
    expect(await store.putFile(a, hash, bytes.byteLength, stream(bytes))).toMatchObject({ ok: true, existed: false });
    expect(bucket.objects.size).toBe(1);
    expect(await store.getFile(a, hash)).toMatchObject({ ok: true });
    sql.close();
  });

  it('answer failed for a ready row whose object is gone', async () => {
    const { sql, bucket, store } = setup();
    await store.putFile(a, hash, bytes.byteLength, stream(bytes));
    bucket.objects.clear();
    expect(await store.getFile(a, hash)).toEqual({ ok: false, error: 'failed' });
    sql.close();
  });
});
