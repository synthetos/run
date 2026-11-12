/** Shared account storage budget, including retained record revisions and future file blobs. */
export const ACCOUNT_STORAGE_BYTES = 1_000_000_000;
export const RECORD_MAX_BYTES = 64 * 1024;
export type RecordKind = 'tool' | 'material';
export interface RecordActor { readonly userId: string; readonly label: string }
export interface CloudRecord { readonly id: string; readonly kind: RecordKind; readonly rev: number; readonly archivedAt: number | null; readonly content: unknown; readonly sha256: string }
export type RecordResult = { readonly ok: true; readonly record: CloudRecord } | { readonly ok: false; readonly error: 'invalid' | 'not_found' | 'conflict' | 'quota'; readonly current?: CloudRecord | null };
export interface RunDataBinding {
  list(actor: RecordActor, kind: RecordKind, after?: string): Promise<readonly CloudRecord[]>;
  get(actor: RecordActor, kind: RecordKind, id: string): Promise<RecordResult>;
  put(actor: RecordActor, kind: RecordKind, id: string, parentRev: number | null, content: unknown): Promise<RecordResult>;
  archive(actor: RecordActor, kind: RecordKind, id: string, parentRev: number): Promise<RecordResult>;
}
