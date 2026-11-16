import { describe, expect, it } from 'vitest';
import { FILE_MAX_BYTES } from '@synthetos/contracts';
import { FileStore } from '../src/files.ts';
import { RecordStore } from '../src/store.ts';
import { FakeBucket, collect, sha256, stream } from './fakeBucket.ts';
import { database } from './harness.ts';

const a = { userId: 'usr_alice', label: '@alice' }; const b = { userId: 'usr_bob', label: '@bob' };
const bytes = new TextEncoder().encode('G21\nG0 X0 Y0\n');
const hash = sha256(bytes);
const setup = () => { const { db, sql } = database(); const bucket = new FakeBucket(); return { db, sql, bucket, store: new FileStore(db, bucket) }; };
const used = (sql: ReturnType<typeof database>['sql'], user: string) => sql.prepare('SELECT used_bytes FROM account_storage WHERE user_id=?').get(user)?.['used_bytes'] ?? 0;
const changes = (sql: ReturnType<typeof database>['sql']) => sql.prepare('SELECT summary FROM changes ORDER BY rowid').all().map((r) => r['summary']);

describe('account files', () => {
  it('store once by digest, per account, under the account key, and count the bytes', async () => {
    const { sql, bucket, store } = setup();
    expect(await store.putFile(a, hash, bytes.byteLength, stream(bytes))).toMatchObject({ ok: true, existed: false, file: { sha256: hash, size: bytes.byteLength } });
    expect([...bucket.objects.keys()]).toEqual([`u/${a.userId}/${hash}`]);
    expect(used(sql, a.userId)).toBe(bytes.byteLength);
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

  it('keep nothing when the bytes do not match the digest or the size, and release the budget', async () => {
    const { sql, bucket, store } = setup();
    expect(await store.putFile(a, 'c'.repeat(64), bytes.byteLength, stream(bytes))).toEqual({ ok: false, error: 'mismatch' });
    expect(await store.putFile(a, hash, bytes.byteLength + 1, stream(bytes))).toEqual({ ok: false, error: 'mismatch' });
    expect(bucket.objects.size).toBe(0);
    expect(used(sql, a.userId)).toBe(0);
    expect(sql.prepare('SELECT COUNT(*) n FROM files').get()).toMatchObject({ n: 0 });
    expect(changes(sql)).toEqual(['Stored file', 'Refused file', 'Stored file', 'Refused file']);
    bucket.failWith = new Error('connection reset');
    expect(await store.putFile(a, hash, bytes.byteLength, stream(bytes))).toEqual({ ok: false, error: 'failed' });
    expect(used(sql, a.userId)).toBe(0);
    sql.close();
  });

});

describe('account files: budget, deletion and races', () => {
  it('refuse a file the budget cannot hold, atomically', async () => {
    const { sql, bucket, store } = setup();
    await store.putFile(a, hash, bytes.byteLength, stream(bytes));
    sql.prepare('UPDATE account_storage SET limit_bytes=used_bytes WHERE user_id=?').run(a.userId);
    const other = new TextEncoder().encode('M30\n');
    expect(await store.putFile(a, sha256(other), other.byteLength, stream(other))).toEqual({ ok: false, error: 'quota' });
    expect(bucket.objects.size).toBe(1);
    expect(sql.prepare('SELECT COUNT(*) n FROM files').get()).toMatchObject({ n: 1 });
    sql.close();
  });

  it('delete a file nobody names, never one a live project still names', async () => {
    const { db, sql, bucket, store } = setup();
    await store.putFile(a, hash, bytes.byteLength, stream(bytes));
    const AT = '2026-11-15T12:00:00.000Z';
    const project = { v: 1, id: 'plate', name: 'Plate', description: '', cover: null, images: [], files: [{ id: 'f1', name: 'plate.nc', size: bytes.byteLength, hash, role: 'gcode', note: '', addedAt: AT }], links: [], setup: { machine: null, stock: null, material: null, tools: [] }, jobs: [], tags: [], createdAt: AT, updatedAt: AT };
    const records = new RecordStore(db);
    expect((await records.put(a, 'project', project.id, null, project)).ok).toBe(true);
    expect(await store.deleteFile(a, hash)).toEqual({ ok: false, error: 'in_use' });
    expect(await store.deleteFile(b, hash)).toEqual({ ok: false, error: 'not_found' });
    expect((await records.archive(a, 'project', project.id, 1)).ok).toBe(true);
    expect(await store.deleteFile(a, hash)).toMatchObject({ ok: true, file: { sha256: hash } });
    expect(bucket.objects.size).toBe(0);
    expect(used(sql, a.userId)).toBe(new TextEncoder().encode(JSON.stringify(project)).length);
    expect(await store.deleteFile(a, hash)).toEqual({ ok: false, error: 'not_found' });
    expect(changes(sql).filter((s) => s !== 'Saved record' && s !== 'Archived record')).toEqual(['Stored file', 'Removed file']);
    await store.putFile(a, hash, bytes.byteLength, stream(bytes));
    expect(() => sql.exec("UPDATE files SET bytes=1")).toThrow('files_fixed');
    sql.close();
  });

  it('answer not found for a row whose object is gone, and existed for a racing second write', async () => {
    const { sql, bucket, store } = setup();
    await store.putFile(a, hash, bytes.byteLength, stream(bytes));
    bucket.objects.clear();
    expect(await store.getFile(a, hash)).toEqual({ ok: false, error: 'failed' });
    const other = new TextEncoder().encode('M30\n'); const otherHash = sha256(other);
    const results = await Promise.all([store.putFile(a, otherHash, other.byteLength, stream(other)), store.putFile(a, otherHash, other.byteLength, stream(other))]);
    expect(results.filter((r) => r.ok && !r.existed)).toHaveLength(1);
    expect(results.filter((r) => r.ok && r.existed)).toHaveLength(1);
    expect(used(sql, a.userId)).toBe(bytes.byteLength + other.byteLength);
    sql.close();
  });
});
