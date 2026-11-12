import { ACCOUNT_STORAGE_BYTES, RECORD_MAX_BYTES, type CloudRecord, type RecordActor, type RecordKind, type RecordResult } from '@synthetos/contracts';
import { readMaterial, readTool } from '@synthetos/library';
import type { Database } from './database.ts';
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const kindOk = (kind: unknown): kind is RecordKind => kind === 'tool' || kind === 'material';
function valid(actor: RecordActor, kind: RecordKind, id = 'x'): boolean {
  return /^usr_[A-Za-z0-9_-]{1,100}$/.test(actor.userId) && typeof actor.label === 'string' && actor.label.length <= 120 && kindOk(kind) && ID.test(id);
}
interface Row { id: string; kind: RecordKind; head_rev: number; archived_at: number | null; content_json: string; content_sha256: string }
const record = (r: Row): CloudRecord => ({ id: r.id, kind: r.kind, rev: r.head_rev, archivedAt: r.archived_at, content: JSON.parse(r.content_json) as unknown, sha256: r.content_sha256 });
const SELECT = 'SELECT r.id,r.kind,r.head_rev,r.archived_at,v.content_json,v.content_sha256 FROM records r JOIN record_revisions v ON v.user_id=r.user_id AND v.kind=r.kind AND v.id=r.id AND v.rev=r.head_rev WHERE r.user_id=?1 AND r.kind=?2';
/** Every request query binds the authenticated account as ?1. Triggers enforce CAS even across concurrent isolates. */
export class RecordStore {
  readonly #db: Database;
  constructor(db: Database) { this.#db = db; }
  async list(actor: RecordActor, kind: RecordKind, after = '', includeArchived = false): Promise<readonly CloudRecord[]> {
    if (!valid(actor, kind) || (after !== '' && !ID.test(after))) return [];
    const rows = await this.#db.prepare(`${SELECT}${includeArchived ? '' : ' AND r.archived_at IS NULL'} AND r.id>?3 ORDER BY r.id LIMIT 100`).bind(actor.userId, kind, after).all<Row>();
    return rows.results.map(record);
  }
  async get(actor: RecordActor, kind: RecordKind, id: string): Promise<RecordResult> {
    if (!valid(actor, kind, id)) return { ok: false, error: 'invalid' };
    const row = await this.#db.prepare(`${SELECT} AND r.id=?3`).bind(actor.userId, kind, id).first<Row>();
    return row === null ? { ok: false, error: 'not_found' } : { ok: true, record: record(row) };
  }
  async put(actor: RecordActor, kind: RecordKind, id: string, parentRev: number | null, content: unknown): Promise<RecordResult> {
    if (!valid(actor, kind, id) || (parentRev !== null && (!Number.isSafeInteger(parentRev) || parentRev < 1))) return { ok: false, error: 'invalid' };
    const parsed = kind === 'tool' ? readTool(content) : readMaterial(content);
    if (!parsed.ok || parsed.value.id !== id) return { ok: false, error: 'invalid' };
    const json = JSON.stringify(parsed.value); const bytes = new TextEncoder().encode(json);
    if (bytes.length > RECORD_MAX_BYTES) return { ok: false, error: 'invalid' };
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2,'0')).join('');
    try {
      await this.#db.batch([
        this.#db.prepare('INSERT OR IGNORE INTO account_storage(user_id,limit_bytes) VALUES(?1,?2)').bind(actor.userId, ACCOUNT_STORAGE_BYTES),
        this.#db.prepare('INSERT INTO record_revisions(user_id,kind,id,rev,parent_rev,content_json,content_sha256,content_bytes,actor_kind,actor_label,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,\'app\',?9,?10)').bind(actor.userId, kind, id, (parentRev ?? 0)+1, parentRev, json, hash, bytes.length, actor.label, Date.now()),
      ]);
    } catch (e) {
      const message = String(e);
      if (message.includes('record_conflict') || message.includes('UNIQUE constraint')) return this.#conflict(actor, kind, id);
      if (message.includes('used_bytes <= limit_bytes')) return { ok: false, error: 'quota' };
      throw e;
    }
    return this.get(actor, kind, id);
  }
  async #conflict(actor: RecordActor, kind: RecordKind, id: string): Promise<RecordResult> {
    const current = await this.get(actor, kind, id);
    return { ok: false, error: 'conflict', current: current.ok ? current.record : null };
  }
  async archive(actor: RecordActor, kind: RecordKind, id: string, parentRev: number): Promise<RecordResult> {
    if (!valid(actor, kind, id) || !Number.isSafeInteger(parentRev) || parentRev < 1) return { ok: false, error: 'invalid' };
    const now = Date.now(); const changeId = crypto.randomUUID();
    const result = await this.#db.batch([
      this.#db.prepare('UPDATE records SET archived_at=?5 WHERE user_id=?1 AND kind=?2 AND id=?3 AND head_rev=?4 AND archived_at IS NULL').bind(actor.userId,kind,id,parentRev,now),
      // changes() refers to the immediately preceding UPDATE on this same transactional D1 batch connection.
      this.#db.prepare('INSERT INTO changes SELECT ?2,?1,?3,\'app\',NULL,?4,?5,?6,?7,?7,\'Archived record\',NULL WHERE changes()=1').bind(actor.userId,changeId,now,actor.label,kind,id,parentRev),
    ]);
    if (result[0]?.meta.changes !== 1) {
      const current = await this.get(actor,kind,id);
      return current.ok ? { ok: false, error: 'conflict', current: current.record } : current;
    }
    return this.get(actor,kind,id);
  }
}
