import { ACCOUNT_STORAGE_BYTES, FILE_MAX_BYTES, type FileBodyResult, type FileError, type FileResult, type RecordActor, type StoredFile } from '@synthetos/contracts';
import type { Bucket } from './bucket.ts';
import type { Database } from './database.ts';

const SHA256 = /^[0-9a-f]{64}$/;
const USER = /^usr_[A-Za-z0-9_-]{1,100}$/;
const actorOk = (actor: RecordActor): boolean => USER.test(actor.userId) && typeof actor.label === 'string' && actor.label.length <= 120;
const sizeOk = (size: number): boolean => Number.isSafeInteger(size) && size > 0 && size <= FILE_MAX_BYTES;

type State = 'pending' | 'ready' | 'deleting';
interface Row { sha256: string; bytes: number; created_at: number; state: State; token: string }
const file = (r: Row): StoredFile => ({ sha256: r.sha256, size: r.bytes, createdAt: r.created_at });
const key = (actor: RecordActor, r: Pick<Row, 'sha256' | 'token'>): string => `u/${actor.userId}/${r.sha256}-${r.token}`;
const newToken = (): string => crypto.randomUUID().replaceAll('-', '');
const fail = (error: FileError): { readonly ok: false; readonly error: FileError } => ({ ok: false, error });
const ROW = 'SELECT sha256,bytes,created_at,state,token FROM files WHERE user_id=?1';
/** True when the head revision of one of the account's live projects names the digest. */
const NAMED = 'EXISTS(SELECT 1 FROM records r JOIN record_revisions v ON v.user_id=r.user_id AND v.kind=r.kind AND v.id=r.id AND v.rev=r.head_rev WHERE r.user_id=?1 AND r.kind=\'project\' AND r.archived_at IS NULL AND instr(v.content_json,?2)>0)';

/**
 * Files of one account, by content. The row in `files` is the authority and the bucket holds the bytes under a
 * key that includes the row's token. An upload reserves its bytes in the budget as a `pending` row, moves the
 * bytes (R2 refuses a digest that differs), then turns `ready`; anything that fails releases the row. A delete
 * marks the row `deleting` in the same statement that checks no live project names the file, removes the
 * object, then the row, so a failed bucket call leaves a retryable row rather than an orphan. A second
 * operation on a file in flight is answered `busy`. Every query binds the signed-in account first.
 */
export class FileStore {
  readonly #db: Database;
  readonly #bucket: Bucket;
  constructor(db: Database, bucket: Bucket) { this.#db = db; this.#bucket = bucket; }

  async listFiles(actor: RecordActor): Promise<readonly StoredFile[]> {
    if (!actorOk(actor)) return [];
    const rows = await this.#db.prepare(`${ROW} AND state='ready' ORDER BY created_at,sha256 LIMIT 1000`).bind(actor.userId).all<Row>();
    return rows.results.map(file);
  }

  #row(actor: RecordActor, sha256: string): Promise<Row | null> {
    return this.#db.prepare(`${ROW} AND sha256=?2`).bind(actor.userId, sha256).first<Row>();
  }

  async getFile(actor: RecordActor, sha256: string): Promise<FileBodyResult> {
    if (!actorOk(actor) || !SHA256.test(sha256)) return fail('invalid');
    const row = await this.#row(actor, sha256);
    if (row === null || row.state !== 'ready') return fail('not_found');
    const object = await this.#bucket.get(key(actor, row));
    return object === null ? fail('failed') : { ok: true, file: file(row), body: object.body };
  }

  async putFile(actor: RecordActor, sha256: string, size: number, body: ReadableStream<Uint8Array>): Promise<FileResult> {
    if (!actorOk(actor) || !SHA256.test(sha256) || !sizeOk(size)) { await body.cancel(); return fail('invalid'); }
    const existing = await this.#row(actor, sha256);
    if (existing !== null) { await body.cancel(); return existing.state === 'ready' ? { ok: true, file: file(existing), existed: true } : fail('busy'); }
    const reserved = await this.#reserve(actor, sha256, size);
    if (!reserved.ok) { await body.cancel(); return reserved; }
    const outcome = await this.#store(actor, reserved.row, body);
    if (outcome !== null) { await this.#release(actor, reserved.row, 'Refused file'); return fail(outcome); }
    const ready = await this.#db.prepare('UPDATE files SET state=\'ready\' WHERE user_id=?1 AND sha256=?2 AND token=?3 AND state=\'pending\'').bind(actor.userId, sha256, reserved.row.token).run();
    if (ready.meta.changes !== 1) { await this.#drop(actor, reserved.row); return fail('failed'); }
    return { ok: true, file: file(reserved.row), existed: false };
  }

  /** Takes the bytes from the budget as a pending row with its own token, before any byte moves. */
  async #reserve(actor: RecordActor, sha256: string, size: number): Promise<{ ok: true; row: Row } | { ok: false; error: FileError }> {
    const row: Row = { sha256, bytes: size, created_at: Date.now(), state: 'pending', token: newToken() };
    try {
      await this.#db.batch([
        this.#db.prepare('INSERT OR IGNORE INTO account_storage(user_id,limit_bytes) VALUES(?1,?2)').bind(actor.userId, ACCOUNT_STORAGE_BYTES),
        this.#db.prepare('INSERT INTO files(user_id,sha256,bytes,state,token,created_at,actor_label) VALUES(?1,?2,?3,\'pending\',?4,?5,?6)').bind(actor.userId, sha256, size, row.token, row.created_at, actor.label),
        this.#db.prepare('INSERT INTO changes VALUES(?3,?1,?4,\'app\',NULL,?5,\'file\',?2,NULL,NULL,\'Stored file\',NULL)').bind(actor.userId, sha256, crypto.randomUUID(), row.created_at, actor.label),
      ]);
    } catch (e) {
      const message = String(e);
      if (message.includes('used_bytes <= limit_bytes')) return { ok: false, error: 'quota' };
      if (message.includes('UNIQUE constraint')) return { ok: false, error: 'busy' };
      throw e;
    }
    return { ok: true, row };
  }

  /** Moves the bytes into the bucket under the row's key; null on success, otherwise why nothing was kept. */
  async #store(actor: RecordActor, row: Row, body: ReadableStream<Uint8Array>): Promise<'mismatch' | 'failed' | null> {
    let written: { readonly size: number } | null;
    try { written = await this.#bucket.put(key(actor, row), body, { sha256: row.sha256 }); } catch (e) { return /checksum|digest|sha/i.test(String(e)) ? 'mismatch' : 'failed'; }
    if (written === null) return 'failed';
    if (written.size === row.bytes) return null;
    await this.#drop(actor, row);
    return 'mismatch';
  }

  /** Removes the object; a bucket that does not answer is not an error here (the token keeps the object harmless). */
  async #drop(actor: RecordActor, row: Row): Promise<void> {
    try { await this.#bucket.delete(key(actor, row)); } catch { /* an unreachable object under a retired token costs nothing and is never served */ }
  }

  /** Removes the row (the trigger returns its bytes to the budget) and records why, as one batch. */
  async #release(actor: RecordActor, row: Row, summary: string): Promise<void> {
    await this.#db.batch([
      this.#db.prepare('DELETE FROM files WHERE user_id=?1 AND sha256=?2 AND token=?3').bind(actor.userId, row.sha256, row.token),
      this.#db.prepare('INSERT INTO changes SELECT ?3,?1,?4,\'app\',NULL,?5,\'file\',?2,NULL,NULL,?6,NULL WHERE changes()=1').bind(actor.userId, row.sha256, crypto.randomUUID(), Date.now(), actor.label, summary),
    ]);
  }

  async deleteFile(actor: RecordActor, sha256: string): Promise<FileResult> {
    if (!actorOk(actor) || !SHA256.test(sha256)) return fail('invalid');
    // One statement decides: the file is stored (or a retried delete) and no live project names it.
    const marked = await this.#db.prepare(`UPDATE files SET state='deleting' WHERE user_id=?1 AND sha256=?2 AND state IN ('ready','deleting') AND NOT ${NAMED}`).bind(actor.userId, sha256).run();
    const row = await this.#row(actor, sha256);
    if (row === null) return fail('not_found');
    if (marked.meta.changes !== 1) return fail(row.state === 'pending' ? 'busy' : 'in_use');
    try { await this.#bucket.delete(key(actor, row)); } catch { return fail('failed'); }
    await this.#release(actor, row, 'Removed file');
    return { ok: true, file: file(row), existed: true };
  }
}
