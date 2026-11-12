import { effect } from '@preact/signals';
import { allowed } from '@synthetos/safety';
import { accountIdentity } from '../../live/account.ts';
import { recordsClient } from '../../cloud/recordsClient.ts';
import type { WorkspaceModel } from '../model.ts';
import { startLibrarySync } from './librarySync.ts';
/** Page side only. The normative cloudSync matrix gates reads, writes, imports and retries alike. */
export function mountLibrarySync(model: WorkspaceModel, hostname = location.hostname): () => void {
  if (hostname !== 'staging.run.synthetos.com' && !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return () => {};
  let active: ReturnType<typeof startLibrarySync> | null = null; let subject: string | null = null;
  const canSync = () => {
    const snapshot = model.live.value.message?.snapshot;
    return allowed({ base: snapshot?.base ?? 'NOT_CONNECTED', overlays: snapshot?.overlays ?? [], classified: snapshot?.classification != null, enqCapable: false }, 'cloudSync').allowed;
  };
  const dispose = effect(() => {
    const identity = accountIdentity.value;
    canSync(); // Track machine transitions even before sign-in.
    if (subject !== (identity?.subject ?? null)) {
      active?.stop(); active = null; subject = identity?.subject ?? null;
      if (identity !== null) {
        let storage: Storage | null = null; try { storage = globalThis.localStorage; } catch { /* blocked storage */ }
        active = startLibrarySync({ subject: identity.subject, display: identity.display, storage, client: recordsClient(), allowed: canSync, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) });
      }
    }
    active?.wake();
  });
  return () => { dispose(); active?.stop(); };
}
