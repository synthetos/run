import { describe, expect, it } from 'vitest';
import { BUILTIN_MATERIALS, EMPTY_SETUP_RECORD } from '@synthetos/library';
import { PROJECT_RECORD_MAX_BYTES } from '@synthetos/contracts';
import { RecordStore } from '../src/store.ts';
import { database, migrationSql, migrations } from './harness.ts';

const a = { userId: 'usr_alice', label: '@alice' }; const b = { userId: 'usr_bob', label: '@bob' };
const AT = '2026-11-15T12:00:00.000Z';
const machine = { id: 'shapeoko-1', name: 'Shapeoko', templateId: 'shapeoko', drive: 'belt', travel: { x: 300, y: 300, z: 80 }, spindle: 'Makita', createdAt: AT, revision: 1 };
const bed = { revision: 1, width: 300, depth: 300, thickness: 19, outline: null, holes: [], toMachine: { x: 0, y: 0, z: -80 }, source: { kind: 'placeholder', note: 'From travel' }, savedAt: AT };
const stock = { shape: 'block', width: 100, depth: 80, thickness: 12, materialRef: { id: 'builtin.al-6061', version: 1 }, position: { x: 10, y: 10 }, zero: { corner: 'front-left', height: 'top' } };
const job = { v: 1, id: 'job-1', projectId: 'plate', name: 'Plate', revision: 1, file: null, machine: null, setup: { bed, bedFrom: 'machine', stock, stockOutline: null, fixture: null, clamps: [], tools: [], references: [] }, placement: { wcs: 'G54', datum: { corner: 'front-left', height: 'top' }, plannedZero: null, frame: 'bed' }, createdAt: AT, updatedAt: AT };
const project = { v: 1, id: 'plate', name: 'Plate', description: '', cover: null, images: [], files: [{ id: 'f1', name: 'plate.nc', size: 10, hash: 'ab'.repeat(32), role: 'gcode', note: '', addedAt: AT }], links: [], setup: { machine: { id: 'shapeoko-1', name: 'Shapeoko' }, stock: null, material: null, tools: [] }, jobs: [job], tags: [], createdAt: AT, updatedAt: AT };

describe('machine and project records', () => {
  it('round-trip, stay per account and keep CAS', async () => {
    const { db, sql } = database(); const store = new RecordStore(db);
    expect(await store.put(a, 'machine', machine.id, null, machine)).toMatchObject({ ok: true, record: { kind: 'machine', rev: 1, content: { travel: { z: 80 } } } });
    expect(await store.put(a, 'project', project.id, null, project)).toMatchObject({ ok: true, record: { kind: 'project', rev: 1 } });
    expect(await store.list(b, 'machine')).toEqual([]);
    expect(await store.get(b, 'project', project.id)).toEqual({ ok: false, error: 'not_found' });
    expect(await store.put(a, 'machine', machine.id, null, machine)).toMatchObject({ ok: false, error: 'conflict', current: { rev: 1 } });
    expect(await store.put(a, 'machine', machine.id, 1, { ...machine, revision: 2 })).toMatchObject({ ok: true, record: { rev: 2 } });
    expect((await store.list(a, 'project')).map((r) => r.id)).toEqual([project.id]);
    expect(sql.prepare('SELECT COUNT(*) n FROM changes').get()).toMatchObject({ n: 3 });
    sql.close();
  });

  it('refuse content the strict readers do not accept, and a mismatched id', async () => {
    const { db, sql } = database(); const store = new RecordStore(db);
    expect(await store.put(a, 'machine', machine.id, null, { ...machine, homed: true })).toEqual({ ok: false, error: 'invalid' });
    expect(await store.put(a, 'machine', machine.id, null, { ...machine, travel: { x: 0, y: 1, z: 1 } })).toEqual({ ok: false, error: 'invalid' });
    expect(await store.put(a, 'machine', 'other', null, machine)).toEqual({ ok: false, error: 'invalid' });
    expect(await store.put(a, 'project', project.id, null, { ...project, jobs: [{ ...job, placement: null }] })).toEqual({ ok: false, error: 'invalid' });
    expect(await store.put(a, 'project', project.id, null, { ...project, files: [{ ...project.files[0], hash: 'short' }] })).toEqual({ ok: false, error: 'invalid' });
    expect(await store.put(a, 'bed' as never, 'x', null, bed)).toEqual({ ok: false, error: 'invalid' });
    expect(await store.list(a, 'machine', '', true)).toEqual([]);
    sql.close();
  });

  it('give projects a larger size limit than library records', async () => {
    const { db, sql } = database(); const store = new RecordStore(db);
    const big = { ...project, description: 'x'.repeat(20_000), jobs: Array.from({ length: 80 }, (_, i) => ({ ...job, id: `job-${i}` })) };
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeGreaterThan(64 * 1024);
    expect((await store.put(a, 'project', project.id, null, big)).ok).toBe(true);
    const over = { ...project, description: 'x'.repeat(20_000), jobs: Array.from({ length: Math.ceil(PROJECT_RECORD_MAX_BYTES / 600) }, (_, i) => ({ ...job, id: `job-${i}` })) };
    expect(await store.put(a, 'project', 'big', null, { ...over, id: 'big' })).toEqual({ ok: false, error: 'invalid' });
    sql.close();
  });
});

describe('migration 0002', () => {
  it('rebuilds the record tables without losing rows, revisions, counts or the triggers', async () => {
    const material = { ...BUILTIN_MATERIALS[0]!, id: 'mine.material' };
    const { db, sql } = database('0001_records.sql'); const store = new RecordStore(db);
    await store.put(a, 'material', material.id, null, material);
    await store.put(a, 'material', material.id, 1, { ...material, name: 'second' });
    expect(() => sql.exec("INSERT INTO records VALUES('usr_x','machine','m',1,NULL)")).toThrow('CHECK');
    const used = sql.prepare('SELECT used_bytes FROM account_storage WHERE user_id=?').get(a.userId)!['used_bytes'];
    sql.exec(migrationSql(migrations().find((m) => m.startsWith('0002'))!));
    expect(await store.get(a, 'material', material.id)).toMatchObject({ ok: true, record: { rev: 2, content: { name: 'second' } } });
    expect(sql.prepare('SELECT COUNT(*) n FROM record_revisions').get()).toMatchObject({ n: 2 });
    expect(sql.prepare('SELECT used_bytes FROM account_storage WHERE user_id=?').get(a.userId)!['used_bytes']).toBe(used);
    expect(await store.put(a, 'material', material.id, 1, { ...material, name: 'stale' })).toMatchObject({ ok: false, error: 'conflict' });
    expect(() => sql.exec("UPDATE record_revisions SET actor_label='x'")).toThrow('append_only');
    expect(() => sql.exec("DELETE FROM record_revisions")).toThrow('append_only');
    expect((await store.put(a, 'machine', machine.id, null, machine)).ok).toBe(true);
    expect(sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND tbl_name='record_revisions'").get()).toMatchObject({ n: 4 });
    sql.close();
  });
});

describe('setup records and migration 0004', () => {
  it('store one setup document per account, and refuse a bad one or a mismatched id', async () => {
    const { db, sql } = database(); const store = new RecordStore(db);
    expect(await store.put(a, 'setup', 'setup', null, EMPTY_SETUP_RECORD)).toMatchObject({ ok: true, record: { kind: 'setup', rev: 1, content: { step: 1 } } });
    expect(await store.put(a, 'setup', 'setup', 1, { ...EMPTY_SETUP_RECORD, step: 3, done: [1, 2] })).toMatchObject({ ok: true, record: { rev: 2 } });
    expect(await store.put(a, 'setup', 'setup', 2, { ...EMPTY_SETUP_RECORD, step: 9 })).toEqual({ ok: false, error: 'invalid' });
    expect(await store.put(a, 'setup', 'other', null, EMPTY_SETUP_RECORD)).toEqual({ ok: false, error: 'invalid' });
    expect(await store.list(b, 'setup')).toEqual([]);
    expect((await store.list(a, 'setup')).map((r) => r.id)).toEqual(['setup']);
    sql.close();
  });

  it('0004 widens the kind check and keeps rows, counts and the triggers', async () => {
    const { db, sql } = database('0003_files.sql'); const store = new RecordStore(db);
    await store.put(a, 'machine', machine.id, null, machine);
    expect(() => sql.exec("INSERT INTO records VALUES('usr_x','setup','setup',1,NULL)")).toThrow('CHECK');
    const used = sql.prepare('SELECT used_bytes FROM account_storage WHERE user_id=?').get(a.userId)!['used_bytes'];
    sql.exec(migrationSql(migrations().find((m) => m.startsWith('0004'))!));
    expect(await store.get(a, 'machine', machine.id)).toMatchObject({ ok: true, record: { rev: 1 } });
    expect(sql.prepare('SELECT used_bytes FROM account_storage WHERE user_id=?').get(a.userId)!['used_bytes']).toBe(used);
    expect(await store.put(a, 'setup', 'setup', null, EMPTY_SETUP_RECORD)).toMatchObject({ ok: true, record: { rev: 1 } });
    expect(await store.put(a, 'machine', machine.id, null, machine)).toMatchObject({ ok: false, error: 'conflict' });
    expect(() => sql.exec("DELETE FROM record_revisions")).toThrow('append_only');
    expect(sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND tbl_name='record_revisions'").get()).toMatchObject({ n: 4 });
    sql.close();
  });
});
