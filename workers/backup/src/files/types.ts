/** Read-only by code: the source capability deliberately exposes no mutation methods. */
export interface FileObject {
  key: string;
  size: number;
  etag: string;
  customMetadata?: Record<string, string>;
  body?: ReadableStream<Uint8Array>;
  text(): Promise<string>;
}
export interface FilePage { objects: FileObject[]; truncated: boolean; cursor?: string }
export interface FileSource {
  list(options: { prefix?: string; cursor?: string; limit: number }): Promise<FilePage>;
  head(key: string): Promise<FileObject | null>;
  get(key: string, options?: { onlyIf: { etagMatches: string } }): Promise<FileObject | null>;
}
export interface FileBackup extends FileSource {
  put(key: string, body: ReadableStream<Uint8Array> | Uint8Array | string, options?: {
    customMetadata?: Record<string, string>; sha256?: string; onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string };
  }): Promise<FileObject | null>;
}
export interface Sample { key: string; size: number }
export interface Scan { cursor?: string; count: number; complete: boolean }
export interface FileState {
  version: 1; copy: Scan; inventory: Scan; samples: Sample[]; restoreDue: boolean;
}
export interface FileStats { copied: number; skipped: number; failed: number; bytes: number; examined: number }
export interface FileOptions { now: () => number; random: () => number; maxObjects: number; maxPages: number; maxBytes: number; maxMs: number }
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const SAMPLE_SIZE = 5;
export const DEFAULT_OPTIONS: FileOptions = { now: Date.now, random: Math.random, maxObjects: 40, maxPages: 20, maxBytes: 200 * 1024 * 1024, maxMs: 120_000 };
export function filesPrefix(environment: string): string {
  if (environment !== 'production' && environment !== 'staging') throw new Error('Invalid files backup environment');
  return environment === 'staging' ? 'staging/files/' : 'files/';
}
export function keyDigest(key: string): string | undefined { return /(?:^|\/)([a-f0-9]{64})(?:-|$)/.exec(key)?.[1]; }
