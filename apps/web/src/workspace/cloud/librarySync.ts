import { signal } from '@preact/signals';
import { RecordsError, type RecordsClient } from '../../cloud/recordsClient.ts';
import { storedBinding, type StorageLike } from '../storage.ts';
import { readCache, saveCache, canonical } from './cloudCache.ts';
import { LIBRARY_NAMES, toRecords, fromRecords } from './libraryRecords.ts';
import { prepareImport } from './importFlow.ts';
import { drainQueue, enqueue, retryDelay, visibleRecords, type SyncStatus } from './syncQueue.ts';
export interface SyncView { mode: 'local' | 'account'; status: SyncStatus; display: string; ask: boolean; notice: string | null; remaining: string[] }
export const librarySyncView = signal<SyncView>({ mode: 'local', status: 'saved', display: '', ask: false, notice: null, remaining: [] });
export const librarySyncActions = { copy: () => Promise.resolve(), notNow: () => {}, dismiss: () => {}, retry: () => {} };
export function librarySavedText(saved: boolean): string {
  const v = librarySyncView.value;
  if (v.mode === 'local') return saved ? 'Saved in this browser' : 'Not saved: this browser blocks storage';
  return v.status === 'saved' ? 'Saved to your account' : v.status === 'saving' ? 'Saving…' : 'Not saved yet: will retry';
}
export interface SyncOptions {
  subject: string; display: string; storage: StorageLike | null; client: RecordsClient; allowed(): boolean;
  setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void;
}
/** Owns one account lifetime. Stopping invalidates callbacks before switching the visible stores back to local. */
export function startLibrarySync(options: SyncOptions): { stop(): void; wake(): void } {
  const cache = readCache(options.storage, options.subject);
  const bindings = LIBRARY_NAMES.map(name => storedBinding(name)).filter(b => b !== undefined);
  let stopped = false; let busy = false; let refresh = true; let importing = false; let attempt = 0; let timer: unknown; let abort: AbortController | null = null;
  const pendingNames = () => cache.pending.map(p => (p.content as { name?: string } | null)?.name ?? p.id);
  const local = () => bindings.flatMap(b => toRecords(b.name, b.local()));
  const update = (patch: Partial<SyncView>) => { if (!stopped) librarySyncView.value = { ...librarySyncView.peek(), ...patch }; };
  const persist = () => !stopped && saveCache(options.storage, options.subject, cache);
  const show = () => { for (const b of bindings) b.show(fromRecords(b.name, visibleRecords(cache))); };
  const detach = () => { for (const b of bindings) b.disconnect(); };
  function schedule(): void {
    options.clearTimeout(timer);
    timer = options.setTimeout(() => { timer = undefined; void run(); }, retryDelay(attempt++));
  }
  async function run(): Promise<void> {
    if (stopped || busy || importing || !options.allowed()) return;
    busy = true; abort = new AbortController();
    try {
      if (refresh) {
        const tools = await options.client.list('tool', abort.signal);
        if (stopped || abort.signal.aborted || !options.allowed()) return;
        const materials = await options.client.list('material', abort.signal);
        if (stopped || abort.signal.aborted) return;
        cache.records = [...tools, ...materials]; refresh = false; persist(); show();
      }
      const status = await drainQueue(cache, options.client, options.allowed, abort.signal, { persist, change: show, notice: message => update({ notice: message }) });
      if (stopped || abort.signal.aborted) return;
      update({ status, remaining: status === 'quota' ? pendingNames() : [] });
      if (status === 'quota') update({ notice: 'Your account storage is full. These records stayed local.' });
      if (status === 'retry') schedule(); else attempt = 0;
    } catch (error) {
      if (stopped || abort.signal.aborted) return;
      if (error instanceof RecordsError && (error.status === 401 || error.status === 503)) { stopped = true; detach(); librarySyncView.value = { mode: 'local', status: 'saved', display: '', ask: false, notice: cache.pending.length ? 'Account sync is unavailable. Pending account edits remain in this browser.' : null, remaining: [] }; }
      else { update({ status: 'retry' }); schedule(); }
    } finally { const interrupted = abort.signal.aborted; busy = false; abort = null; if (interrupted && !stopped && options.allowed()) schedule(); }
  }
  function wake(): void {
    if (!options.allowed()) { abort?.abort(); return; }
    if (librarySyncView.peek().status !== 'quota') void run();
  }
  for (const binding of bindings) binding.connect((next, previous) => {
    const before = toRecords(binding.name, previous, true); const after = toRecords(binding.name, next, true);
    for (const record of after) if (!before.some(old => old.id === record.id && canonical(old.content) === canonical(record.content))) enqueue(cache, record.kind, record.id, record.content);
    for (const record of before) if (!after.some(r => r.id === record.id)) enqueue(cache, record.kind, record.id, null);
    const saved = persist();
    const quota = librarySyncView.peek().status === 'quota';
    update({ status: quota ? 'quota' : saved ? 'saving' : 'retry', ...(quota ? { remaining: pendingNames() } : {}) });
    show(); wake(); return saved;
  });
  librarySyncView.value = { mode: 'account', status: cache.pending.length ? 'saving' : 'saved', display: options.display, ask: !cache.consent && local().length > 0, notice: null, remaining: [] };
  show();
  librarySyncActions.copy = async () => {
    if (stopped || importing) return;
    importing = true; abort?.abort(); update({ ask: false, status: 'saving' });
    try {
      // A queue already in flight can finish, but import work itself cannot start network requests.
      const ok = await prepareImport(cache, local(), persist);
      if (!stopped) { show(); update({ status: ok ? 'saving' : 'retry' }); }
    } catch { update({ status: 'retry', notice: 'The import could not finish. Your browser copies are still here.' }); }
    finally { importing = false; wake(); }
  };
  librarySyncActions.notNow = () => { update({ ask: false }); };
  librarySyncActions.dismiss = () => update({ notice: null, remaining: [] });
  librarySyncActions.retry = () => { update({ status: 'saving' }); wake(); };
  if (cache.importSource !== undefined) void librarySyncActions.copy(); else wake();
  return {
    wake,
    stop() { stopped = true; abort?.abort(); options.clearTimeout(timer); detach(); librarySyncView.value = { mode: 'local', status: 'saved', display: '', ask: false, notice: null, remaining: [] }; },
  };
}
