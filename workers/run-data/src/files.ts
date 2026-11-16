import { ACCOUNT_STORAGE_BYTES, FILE_MAX_BYTES, type FileBodyResult, type FileError, type FileResult, type RecordActor, type StoredFile } from '@synthetos/contracts';
import type { Bucket } from './bucket.ts';
import type { Database } from './database.ts';

const SHA256 = /^[0-9a-f]{64}$/;
const USER = /^usr_[A-Za-z0-9_-]{1,100}$/;
const actorOk = (actor: RecordActor): boolean => USER.test(actor.userId) && typeof actor.label === 'string' && actor.label.length <= 120;
const sizeOk = (size: number): boolean => Number.isSafeInteger(size) && size >= 0 && size <= FILE_MAX_BYTES;

/** An upload still `pending` after this long is abandoned work (a Worker that never came back); the next request may finish it. */
export const UPLOAD_LEASE_MS = 60 * 60 * 1000;

type State = 'pending' | 'ready' | 'deleting';
interface Row { sha256: string; bytes: number; created_at: number; state: State; token: string }
type Outcome = 'mismatch' | 'failed' | null;
const file = (r: Row): StoredFile => ({ sha256: r.sha256, size: r.bytes, createdAt: r.created_at });
const key = (actor: RecordActor, r: Pick<Row, 'sha256' | 'token'>): string => `u/${actor.userId}/${r.sha256}-${r.token}`;
const newToken = (): string => crypto.randomUUID().replaceAll('-', '');
const fail = (error: FileError): { readonly ok: false; readonly error: FileError } => ({ ok: false, error });
const COLUMNS = 'sha256,bytes,created_at,state,token';
const ROW = `SELECT ${COLUMNS} FROM files WHERE user_id=?1`;
/** True when the head revision of one of the account's live projects names the digest. */
const NAMED = 'EXISTS(SELECT 1 FROM records r JOIN record_revisions v ON v.user_id=r.user_id AND v.kind=r.kind AND v.id=r.id AND v.rev=r.head_rev WHERE r.user_id=?1 AND r.kind=\'project\' AND r.archived_at IS NULL AND instr(v.content_json,?2)>0)';
/** Claims a stored (or half-removed) file nobody names and hands back exactly the row claimed, token included. */
const CLAIM = `UPDATE files SET state='deleting' WHERE user_id=?1 AND sha256=?2 AND state IN ('ready','deleting') AND NOT ${NAMED} RETURNING ${COLUMNS}`;

/**
 * Files of one account, by content. The row in `files` is the authority and the bucket holds the bytes under a
 * key that includes the row's token. An upload reserves its bytes in the budget as a `pending` row, moves the
 * bytes (R2 refuses a digest that differs), then turns `ready`. A delete claims the row as `deleting` in the one
 * statement that checks no live project names it and returns the claimed token, removes that object, then the
 * row. A row is released only once its object is known to be gone: a cleanup the bucket refuses leaves the row
 * `deleting`, bytes still charged, for a later delete or upload to finish. A `pending` row older than the lease
 * is abandoned and the next upload or delete of that digest finishes it. Anything else in flight answers `busy`.
 * Every query binds the signed-in account first.
 */
export class FileStore {
  readonly #db: Database;
  readonly #bucket: Bucket;
  readonly #now: () => number;
  constructor(db: Database, bucket: Bucket, now: () => number = Date.now) { this.#db = db; this.#bucket = bucket; this.#now = now; }

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
    if (existing?.state === 'ready') { await body.cancel(); return { ok: true, file: file(existing), existed: true }; }
    if (existing !== null && !(await this.#reclaim(actor, existing))) { await body.cancel(); return fail('busy'); }
    const reserved = await this.#reserve(actor, sha256, size);
    if (!reserved.ok) { await body.cancel(); return reserved; }
    const outcome = await this.#store(actor, reserved.row, body);
    if (outcome !== null) return fail(outcome);
    const ready = await this.#db.prepare('UPDATE files SET state=\'ready\' WHERE user_id=?1 AND sha256=?2 AND token=?3 AND state=\'pending\'').bind(actor.userId, sha256, reserved.row.token).run();
    if (ready.meta.changes !== 1) { await this.#drop(actor, reserved.row); return fail('failed'); }
    return { ok: true, file: file(reserved.row), existed: false };
  }

  /** Takes the bytes from the budget as a pending row with its own token, before any byte moves. */
  async #reserve(actor: RecordActor, sha256: string, size: number): Promise<{ ok: true; row: Row } | { ok: false; error: FileError }> {
    const row: Row = { sha256, bytes: size, created_at: this.#now(), state: 'pending', token: newToken() };
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

  /**
   * Moves the bytes into the bucket under the row's key and settles the row when they do not belong there:
   * null on success, otherwise why nothing is kept. An empty file is put as zero bytes, not as a stream.
   */
  async #store(actor: RecordActor, row: Row, body: ReadableStream<Uint8Array>): Promise<Outcome> {
    let written: { readonly size: number } | null;
    try {
      if (row.bytes === 0) await body.cancel();
      written = await this.#bucket.put(key(actor, row), row.bytes === 0 ? new Uint8Array(0) : body, { sha256: row.sha256 });
    } catch (e) {
      // R2 stored nothing: the row goes straight back.
      await this.#release(actor, row, 'Refused file');
      return /checksum|digest|sha/i.test(String(e)) ? 'mismatch' : 'failed';
    }
    if (written === null) { await this.#release(actor, row, 'Refused file'); return 'failed'; }
    if (written.size === row.bytes) return null;
    await this.#retire(actor, row, 'Refused file');
    return 'mismatch';
  }

  /** Removes the object; true when the bucket confirms it is gone. */
  async #drop(actor: RecordActor, row: Row): Promise<boolean> {
    try { await this.#bucket.delete(key(actor, row)); return true; } catch { return false; }
  }

  /** Removes a row whose object is gone (the trigger returns its bytes to the budget) and records why, as one batch. */
  async #release(actor: RecordActor, row: Row, summary: string): Promise<void> {
    await this.#db.batch([
      this.#db.prepare('DELETE FROM files WHERE user_id=?1 AND sha256=?2 AND token=?3').bind(actor.userId, row.sha256, row.token),
      this.#db.prepare('INSERT INTO changes SELECT ?3,?1,?4,\'app\',NULL,?5,\'file\',?2,NULL,NULL,?6,NULL WHERE changes()=1').bind(actor.userId, row.sha256, crypto.randomUUID(), this.#now(), actor.label, summary),
    ]);
  }

  /**
   * Ends a row whose object may exist: the object goes first, then the row. A bucket that refuses the delete
   * leaves the row `deleting` with its bytes charged, so nothing is ever stored outside the budget. True when
   * the row is gone.
   */
  async #retire(actor: RecordActor, row: Row, summary: string): Promise<boolean> {
    if (await this.#drop(actor, row)) { await this.#release(actor, row, summary); return true; }
    await this.#db.prepare('UPDATE files SET state=\'deleting\' WHERE user_id=?1 AND sha256=?2 AND token=?3').bind(actor.userId, row.sha256, row.token).run();
    return false;
  }

  /** Finishes abandoned work on a digest: a half-removed file, or an upload past its lease. False while it is in use. */
  #reclaim(actor: RecordActor, row: Row): Promise<boolean> {
    if (row.state === 'pending' && this.#now() - row.created_at < UPLOAD_LEASE_MS) return Promise.resolve(false);
    return this.#retire(actor, row, row.state === 'pending' ? 'Abandoned upload' : 'Removed file');
  }

  async deleteFile(actor: RecordActor, sha256: string): Promise<FileResult> {
    if (!actorOk(actor) || !SHA256.test(sha256)) return fail('invalid');
    const claimed = await this.#db.prepare(CLAIM).bind(actor.userId, sha256).first<Row>();
    if (claimed === null) {
      const row = await this.#row(actor, sha256);
      if (row === null) return fail('not_found');
      if (row.state !== 'pending') return fail('in_use');
      return (await this.#reclaim(actor, row)) ? { ok: true, file: file(row), existed: true } : fail('busy');
    }
    if (!(await this.#drop(actor, claimed))) return fail('failed');
    await this.#release(actor, claimed, 'Removed file');
    return { ok: true, file: file(claimed), existed: true };
  }
}
