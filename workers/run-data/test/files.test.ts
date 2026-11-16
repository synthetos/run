import { describe, expect, it } from 'vitest';
import { FILE_MAX_BYTES } from '@synthetos/contracts';
import type { Database, Statement } from '../src/database.ts';
import { FileStore, UPLOAD_LEASE_MS } from '../src/files.ts';
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
    expect(await store.putFile(a, hash, -1, stream(bytes))).toEqual({ ok: false, error: 'invalid' });
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
    expect(await store.putFile(a, hash, 0, stream(bytes))).toEqual({ ok: false, error: 'mismatch' });
    bucket.failWith = new Error('connection reset');
    expect(await store.putFile(a, hash, bytes.byteLength, stream(bytes))).toEqual({ ok: false, error: 'failed' });
    bucket.failWith = null;
    expect(bucket.objects.size).toBe(0);
    expect(used(sql, a.userId)).toBe(0);
    expect(sql.prepare('SELECT COUNT(*) n FROM files').get()).toMatchObject({ n: 0 });
    expect(changes(sql)).toEqual(Array(4).fill(['Stored file', 'Refused file']).flat());
    sql.close();
  });

  it('store the empty file like any other: it has a digest, costs nothing and streams back empty', async () => {
    const { sql, bucket, store } = setup();
    const empty = new Uint8Array(0); const emptyHash = sha256(empty);
    expect(await store.putFile(a, emptyHash, 0, stream(empty))).toMatchObject({ ok: true, existed: false, file: { sha256: emptyHash, size: 0 } });
    expect(bucket.objects.size).toBe(1);
    expect(used(sql, a.userId)).toBe(0);
    const got = await store.getFile(a, emptyHash);
    expect(got.ok && (await collect(got.body)).byteLength).toBe(0);
    expect(await store.listFiles(a)).toMatchObject([{ sha256: emptyHash, size: 0 }]);
    expect(await store.deleteFile(a, emptyHash)).toMatchObject({ ok: true });
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
    bucket.deleteFailWith = new Error('down');
    expect(await store.deleteFile(a, hash)).toEqual({ ok: false, error: 'failed' });
    expect(states(sql)).toEqual([`${hash.slice(0, 6)}:deleting`]);
    expect(await store.getFile(a, hash)).toEqual({ ok: false, error: 'not_found' });
    expect(await store.putFile(a, hash, bytes.byteLength, stream(bytes))).toEqual({ ok: false, error: 'busy' });
    bucket.deleteFailWith = null;
    expect(await store.deleteFile(a, hash)).toMatchObject({ ok: true });
    expect(bucket.objects.size).toBe(0); expect(used(sql, a.userId)).toBe(0);
    // A delete paused at the bucket while a new upload of the same digest arrives: the upload finishes the removal
    // and stores under a new token; the paused delete then touches only its own, already gone, object.
    await store.putFile(a, hash, bytes.byteLength, stream(bytes));
    const held = gate(); bucket.hold = held.promise;
    const removal = store.deleteFile(a, hash);
    await new Promise((r) => setTimeout(r, 10));
    expect(await store.putFile(a, hash, bytes.byteLength, stream(bytes))).toMatchObject({ ok: true, existed: false });
    held.open();
    expect(await removal).toMatchObject({ ok: true });
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

/** The same database, with the statements starting with `prefix` altered by `wrap` (a pause or a failure at the D1 boundary). */
function withStatements(db: Database, prefix: string, wrap: (s: Statement) => Partial<Statement>): Database {
  return {
    ...db,
    prepare(query) {
      const s = db.prepare(query);
      if (!query.startsWith(prefix)) return s;
      const w: Statement = { bind(...v) { s.bind(...v); return w; }, first: <T>() => s.first<T>(), all: <T>() => s.all<T>(), run: () => s.run(), ...wrap(s) };
      return w;
    },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 10));

describe('account files: recovery', () => {
  it('a delete removes only the row it claimed: a replacement uploaded meanwhile is untouched', async () => {
    const { db, sql, bucket, store } = setup();
    await store.putFile(a, hash, bytes.byteLength, stream(bytes));
    const held = gate(); let paused = false;
    const slow = new FileStore(withStatements(db, "UPDATE files SET state='deleting'", (s) => ({ async first<T>() { const r = await s.first<T>(); if (!paused) { paused = true; await held.promise; } return r; } })), bucket);
    const first = slow.deleteFile(a, hash);
    await tick();
    expect(states(sql)).toEqual([`${hash.slice(0, 6)}:deleting`]);
    expect(await store.deleteFile(a, hash)).toMatchObject({ ok: true });
    expect(await store.putFile(a, hash, bytes.byteLength, stream(bytes))).toMatchObject({ ok: true, existed: false });
    held.open();
    expect(await first).toMatchObject({ ok: true });
    expect(bucket.objects.size).toBe(1);
    expect(await store.getFile(a, hash)).toMatchObject({ ok: true });
    expect(used(sql, a.userId)).toBe(bytes.byteLength);
    sql.close();
  });

  it('an upload the database lost track of is busy for its lease, then the next upload or delete finishes it', async () => {
    const { db, sql, bucket } = setup();
    let failures = 2; let now = 1_700_000_000_000;
    const flaky = withStatements(db, "UPDATE files SET state='ready'", (s) => ({ async run() { if (failures-- > 0) throw new Error('d1 hiccup'); return s.run(); } }));
    const store = new FileStore(flaky, bucket, () => now);
    await expect(store.putFile(a, hash, bytes.byteLength, stream(bytes))).rejects.toThrow('d1 hiccup');
    await expect(store.putFile(a, otherHash, other.byteLength, stream(other))).rejects.toThrow('d1 hiccup');
    expect(states(sql)).toEqual([`${hash.slice(0, 6)}:pending`, `${otherHash.slice(0, 6)}:pending`].sort());
    expect(used(sql, a.userId)).toBe(bytes.byteLength + other.byteLength);
    expect(await store.putFile(a, hash, bytes.byteLength, stream(bytes))).toEqual({ ok: false, error: 'busy' });
    expect(await store.deleteFile(a, hash)).toEqual({ ok: false, error: 'busy' });
    expect(await store.getFile(a, hash)).toEqual({ ok: false, error: 'not_found' });
    now += UPLOAD_LEASE_MS;
    expect(await store.putFile(a, hash, bytes.byteLength, stream(bytes))).toMatchObject({ ok: true, existed: false });
    expect(await store.getFile(a, hash)).toMatchObject({ ok: true });
    expect(await store.deleteFile(a, otherHash)).toMatchObject({ ok: true, file: { sha256: otherHash } });
    expect(bucket.objects.size).toBe(1);
    expect(used(sql, a.userId)).toBe(bytes.byteLength);
    expect(changes(sql).filter((c) => c !== 'Stored file')).toEqual(['Abandoned upload', 'Abandoned upload']);
    sql.close();
  });

  it('a mismatched upload whose cleanup the bucket refuses stays charged and retryable, never an orphan', async () => {
    const { sql, bucket, store } = setup();
    bucket.deleteFailWith = new Error('down');
    expect(await store.putFile(a, hash, bytes.byteLength + 1, stream(bytes))).toEqual({ ok: false, error: 'mismatch' });
    expect(states(sql)).toEqual([`${hash.slice(0, 6)}:deleting`]);
    expect(used(sql, a.userId)).toBe(bytes.byteLength + 1);
    expect(bucket.objects.size).toBe(1);
    expect(await store.putFile(a, hash, bytes.byteLength, stream(bytes))).toEqual({ ok: false, error: 'busy' });
    expect(await store.deleteFile(a, hash)).toEqual({ ok: false, error: 'failed' });
    bucket.deleteFailWith = null;
    expect(await store.putFile(a, hash, bytes.byteLength, stream(bytes))).toMatchObject({ ok: true, existed: false });
    expect(bucket.objects.size).toBe(1);
    expect(used(sql, a.userId)).toBe(bytes.byteLength);
    expect(changes(sql)).toEqual(['Stored file', 'Removed file', 'Stored file']);
    sql.close();
  });
});
