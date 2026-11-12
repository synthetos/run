import { WorkerEntrypoint } from 'cloudflare:workers';
import type { RecordActor, RecordKind, RunDataBinding } from '@synthetos/contracts';
import type { Database } from './database.ts';
import { RecordStore } from './store.ts';
interface Env { readonly RUN_DATA_DB: Database; readonly RUN_FILES: unknown }
/** Internal RPC only. Configuration and repository gates restrict callers to run. */
export class AppEntrypoint extends WorkerEntrypoint<Env> implements RunDataBinding {
  list(actor: RecordActor, kind: RecordKind, after = '') { return new RecordStore(this.env.RUN_DATA_DB).list(actor, kind, after); }
  get(actor: RecordActor, kind: RecordKind, id: string) { return new RecordStore(this.env.RUN_DATA_DB).get(actor, kind, id); }
  put(actor: RecordActor, kind: RecordKind, id: string, parentRev: number | null, content: unknown) { return new RecordStore(this.env.RUN_DATA_DB).put(actor, kind, id, parentRev, content); }
  archive(actor: RecordActor, kind: RecordKind, id: string, parentRev: number) { return new RecordStore(this.env.RUN_DATA_DB).archive(actor, kind, id, parentRev); }
}
export default { fetch(): Response { return new Response('Not found', { status: 404 }); } };
