import { WorkerEntrypoint } from 'cloudflare:workers';
import type { RecordActor, RecordKind, RunDataBinding, RunFilesBinding } from '@synthetos/contracts';
import type { Bucket } from './bucket.ts';
import type { Database } from './database.ts';
import { FileStore } from './files.ts';
import { RecordStore } from './store.ts';
interface Env { readonly RUN_DATA_DB: Database; readonly RUN_FILES: Bucket }
/** Internal RPC only. Configuration and repository gates restrict callers to run. */
export class AppEntrypoint extends WorkerEntrypoint<Env> implements RunDataBinding, RunFilesBinding {
  #records(): RecordStore { return new RecordStore(this.env.RUN_DATA_DB); }
  #files(): FileStore { return new FileStore(this.env.RUN_DATA_DB, this.env.RUN_FILES); }
  list(actor: RecordActor, kind: RecordKind, after = '', includeArchived = false) { return this.#records().list(actor, kind, after, includeArchived); }
  get(actor: RecordActor, kind: RecordKind, id: string) { return this.#records().get(actor, kind, id); }
  put(actor: RecordActor, kind: RecordKind, id: string, parentRev: number | null, content: unknown) { return this.#records().put(actor, kind, id, parentRev, content); }
  archive(actor: RecordActor, kind: RecordKind, id: string, parentRev: number) { return this.#records().archive(actor, kind, id, parentRev); }
  putFile(actor: RecordActor, sha256: string, size: number, body: ReadableStream<Uint8Array>) { return this.#files().putFile(actor, sha256, size, body); }
  getFile(actor: RecordActor, sha256: string) { return this.#files().getFile(actor, sha256); }
  listFiles(actor: RecordActor) { return this.#files().listFiles(actor); }
  deleteFile(actor: RecordActor, sha256: string) { return this.#files().deleteFile(actor, sha256); }
}
export default { fetch(): Response { return new Response('Not found', { status: 404 }); } };
