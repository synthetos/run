/**
 * Account files (end-to-end design §3): project files and images stored by
 * content, once per account, in the files bucket under `u/<userId>/<sha256>`.
 * A project record names a file by its SHA-256; the bytes live here. Files
 * count against the same storage budget as records (ACCOUNT_STORAGE_BYTES).
 */
import type { RecordActor } from './records.ts';

/** The largest single file an account stores: the G-code limit (projects/limits.ts). */
export const FILE_MAX_BYTES = 50 * 1024 * 1024;

export interface StoredFile {
  /** Lower-case hex SHA-256 of the bytes: the file's name in the account. */
  readonly sha256: string;
  readonly size: number;
  readonly createdAt: number;
}

export type FileError =
  /** The digest, size or actor did not pass the shape checks. */
  | 'invalid'
  | 'not_found'
  /** The account's storage budget would be exceeded. */
  | 'quota'
  /** The bytes did not match the declared digest or size; nothing was kept. */
  | 'mismatch'
  /** A project record still names this file. */
  | 'in_use'
  /** The bucket did not answer; nothing was kept. */
  | 'failed';

/** A stream of bytes between the Workers (the runtime's own stream; it crosses the RPC boundary as is). */
export type ByteStream = ReadableStream<Uint8Array>;

export type FileResult = { readonly ok: true; readonly file: StoredFile; readonly existed: boolean } | { readonly ok: false; readonly error: FileError };
export type FileBodyResult = { readonly ok: true; readonly file: StoredFile; readonly body: ByteStream } | { readonly ok: false; readonly error: FileError };

export interface RunFilesBinding {
  /** Stores `body` as `sha256` for the account; the bucket itself refuses bytes whose digest differs. Idempotent. */
  putFile(actor: RecordActor, sha256: string, size: number, body: ByteStream): Promise<FileResult>;
  getFile(actor: RecordActor, sha256: string): Promise<FileBodyResult>;
  listFiles(actor: RecordActor): Promise<readonly StoredFile[]>;
  /** Removes a file no project of the account names any more and releases its bytes. */
  deleteFile(actor: RecordActor, sha256: string): Promise<FileResult>;
}
