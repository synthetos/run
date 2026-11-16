import { ACCOUNT_STORAGE_BYTES, FILE_MAX_BYTES, type FileBodyResult, type FileResult, type RecordActor, type StoredFile } from '@synthetos/contracts';
import type { Bucket } from './bucket.ts';
import type { Database } from './database.ts';

const SHA256 = /^[0-9a-f]{64}$/;
const USER = /^usr_[A-Za-z0-9_-]{1,100}$/;
const actorOk = (actor: RecordActor): boolean => USER.test(actor.userId) && typeof actor.label === 'string' && actor.label.length <= 120;
const sizeOk = (size: number): boolean => Number.isSafeInteger(size) && size > 0 && size <= FILE_MAX_BYTES;
const key = (actor: RecordActor, sha256: string): string => `u/${actor.userId}/${sha256}`;

interface Row { sha256: string; bytes: number; created_at: number }
const file = (r: Row): StoredFile => ({ sha256: r.sha256, size: r.bytes, createdAt: r.created_at });

/**
 * Files of one account, by content: the row in `files` is the authority, the bucket holds the bytes under
 * `u/<userId>/<sha256>`. Every query binds the signed-in account first. The budget is reserved in the
 * database before the bytes move, and released when the bucket refuses them.
 */
export class FileStore {
  readonly #db: Database;
  readonly #bucket: Bucket;
  constructor(db: Database, bucket: Bucket) { this.#db = db; this.#bucket = bucket; }

  async listFiles(actor: RecordActor): Promise<readonly StoredFile[]> {
    if (!actorOk(actor)) return [];
    const rows = await this.#db.prepare('SELECT sha256,bytes,created_at FROM files WHERE user_id=?1 ORDER BY created_at,sha256 LIMIT 1000').bind(actor.userId).all<Row>();
    return rows.results.map(file);
  }

  async #row(actor: RecordActor, sha256: string): Promise<StoredFile | null> {
    const row = await this.#db.prepare('SELECT sha256,bytes,created_at FROM files WHERE user_id=?1 AND sha256=?2').bind(actor.userId, sha256).first<Row>();
    return row === null ? null : file(row);
  }

  async getFile(actor: RecordActor, sha256: string): Promise<FileBodyResult> {
    if (!actorOk(actor) || !SHA256.test(sha256)) return { ok: false, error: 'invalid' };
    const stored = await this.#row(actor, sha256);
    if (stored === null) return { ok: false, error: 'not_found' };
    const object = await this.#bucket.get(key(actor, sha256));
    return object === null ? { ok: false, error: 'failed' } : { ok: true, file: stored, body: object.body };
  }

  async putFile(actor: RecordActor, sha256: string, size: number, body: ReadableStream<Uint8Array>): Promise<FileResult> {
    if (!actorOk(actor) || !SHA256.test(sha256) || !sizeOk(size)) { await body.cancel(); return { ok: false, error: 'invalid' }; }
    const existing = await this.#row(actor, sha256);
    if (existing !== null) { await body.cancel(); return { ok: true, file: existing, existed: true }; }
    const reserved = await this.#reserve(actor, sha256, size);
    // A refused budget, or a second write of the same file that lost the race: nothing more to move.
    if (!reserved.ok || reserved.existed) { await body.cancel(); return reserved; }
    const outcome = await this.#store(actor, sha256, size, body);
    if (outcome !== null) { await this.#release(actor, sha256, 'Refused file'); return { ok: false, error: outcome }; }
    return { ok: true, file: reserved.file, existed: false };
  }

  /** Takes the bytes from the budget and writes the row and its audit entry, before any byte moves. */
  async #reserve(actor: RecordActor, sha256: string, size: number): Promise<FileResult> {
    const now = Date.now();
    try {
      await this.#db.batch([
        this.#db.prepare('INSERT OR IGNORE INTO account_storage(user_id,limit_bytes) VALUES(?1,?2)').bind(actor.userId, ACCOUNT_STORAGE_BYTES),
        this.#db.prepare('INSERT INTO files(user_id,sha256,bytes,created_at,actor_label) VALUES(?1,?2,?3,?4,?5)').bind(actor.userId, sha256, size, now, actor.label),
        this.#db.prepare('INSERT INTO changes VALUES(?3,?1,?4,\'app\',NULL,?5,\'file\',?2,NULL,NULL,\'Stored file\',NULL)').bind(actor.userId, sha256, crypto.randomUUID(), now, actor.label),
      ]);
    } catch (e) {
      const message = String(e);
      if (message.includes('used_bytes <= limit_bytes')) return { ok: false, error: 'quota' };
      if (message.includes('UNIQUE constraint')) { const raced = await this.#row(actor, sha256); return raced === null ? { ok: false, error: 'failed' } : { ok: true, file: raced, existed: true }; }
      throw e;
    }
    return { ok: true, file: { sha256, size, createdAt: now }, existed: false };
  }

  /** Moves the bytes into the bucket; null on success, otherwise why nothing was kept. */
  async #store(actor: RecordActor, sha256: string, size: number, body: ReadableStream<Uint8Array>): Promise<'mismatch' | 'failed' | null> {
    let written: { readonly size: number } | null;
    try { written = await this.#bucket.put(key(actor, sha256), body, { sha256 }); } catch (e) { return /checksum|digest|sha/i.test(String(e)) ? 'mismatch' : 'failed'; }
    if (written === null) return 'failed';
    if (written.size === size) return null;
    await this.#bucket.delete(key(actor, sha256));
    return 'mismatch';
  }

  async #release(actor: RecordActor, sha256: string, summary: string): Promise<void> {
    await this.#db.batch([
      this.#db.prepare('DELETE FROM files WHERE user_id=?1 AND sha256=?2').bind(actor.userId, sha256),
      this.#db.prepare('INSERT INTO changes SELECT ?3,?1,?4,\'app\',NULL,?5,\'file\',?2,NULL,NULL,?6,NULL WHERE changes()=1').bind(actor.userId, sha256, crypto.randomUUID(), Date.now(), actor.label, summary),
    ]);
  }

  async deleteFile(actor: RecordActor, sha256: string): Promise<FileResult> {
    if (!actorOk(actor) || !SHA256.test(sha256)) return { ok: false, error: 'invalid' };
    const stored = await this.#row(actor, sha256);
    if (stored === null) return { ok: false, error: 'not_found' };
    if (await this.#named(actor, sha256)) return { ok: false, error: 'in_use' };
    await this.#release(actor, sha256, 'Removed file');
    await this.#bucket.delete(key(actor, sha256));
    return { ok: true, file: stored, existed: true };
  }

  /** True when the head revision of one of the account's live projects names this digest. */
  async #named(actor: RecordActor, sha256: string): Promise<boolean> {
    const row = await this.#db.prepare('SELECT 1 AS hit FROM records r JOIN record_revisions v ON v.user_id=r.user_id AND v.kind=r.kind AND v.id=r.id AND v.rev=r.head_rev WHERE r.user_id=?1 AND r.kind=\'project\' AND r.archived_at IS NULL AND instr(v.content_json,?2)>0 LIMIT 1').bind(actor.userId, sha256).first<{ hit: number }>();
    return row !== null;
  }
}
