import { useState } from 'preact/hooks';
import { isActiveProjectStore, projectScope, projectStore } from './browserStore.ts';
import type { ProjectStore } from './store.ts';

/** Progress belongs to the store that started it; a late account callback cannot publish file names. */
export function useZipAction() {
  const scope = projectScope.value;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ scope, text: '', error: false });
  async function run(operation: (store: ProjectStore, progress: (text: string) => void) => Promise<string>): Promise<void> {
    if (busy) return;
    const store = await projectStore(); setBusy(true);
    const progress = (text: string) => { if (isActiveProjectStore(store)) setNotice({ scope: projectScope.peek(), text, error: false }); };
    try { progress(await operation(store, progress)); }
    catch (error) {
      if (isActiveProjectStore(store)) setNotice({ scope: projectScope.peek(), text: error instanceof Error ? error.message : 'The project zip could not be processed.', error: true });
    } finally { setBusy(false); }
  }
  return { busy, text: notice.scope === scope ? notice.text : '', error: notice.error, run };
}
