import { queueSeedCleanup } from './seedCleanup.ts';
import { signal } from '@preact/signals';
import { type RecordsClient } from '../../cloud/recordsClient.ts';
import { storedBinding, type StorageLike } from '../storage.ts';
import { readCache, saveCache } from './cloudCache.ts';
import { LIBRARY_NAMES, toRecords } from './libraryRecords.ts';
import { prepareImport } from './importFlow.ts';
import { type SyncStatus } from './syncQueue.ts';
export interface SyncView { mode: 'local' | 'account'; status: SyncStatus; display: string; ask: boolean; notice: string | null; remaining: string[]; browserOnly?: boolean; counts?: Partial<Record<RecordKind, number>> }
export const librarySyncView = signal<SyncView>({ mode: 'local', status: 'saved', display: '', ask: false, notice: null, remaining: [] });
export const librarySyncActions = { copy: () => Promise.resolve(), notNow: () => {}, dismiss: () => {}, retry: () => {} };
export function librarySavedText(saved: boolean): string {
  const v = librarySyncView.value;
  if (v.mode === 'local') return saved ? 'Saved in this browser' : 'Not saved: this browser blocks storage';
  if (v.status === 'refused') return 'Not saved to your account: review the notice';
  if (v.browserOnly && v.status === 'saved') return 'Saved in this browser';
  return v.status === 'saved' ? 'Saved to your account' : v.status === 'saving' ? 'Saving…' : 'Not saved yet: will retry';
}
export interface SyncOptions {
  subject: string; display: string; storage: StorageLike | null; client: RecordsClient; allowed(): boolean;
  projects?: ProjectContext;
  setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void;
}
import type { RecordKind } from '@synthetos/contracts';
import { startProjectSync, type ProjectContext } from './projectSync.ts';
import { connectBindings, showBindings } from './syncBindings.ts';
import { syncRunner } from './syncRunner.ts';
import { refusal } from './recordReaders.ts';

/** Owns one account lifetime; stopping restores the browser-only stores. */
export function startLibrarySync(options: SyncOptions): { stop(): void; wake(): void } {
  const cache = readCache(options.storage, options.subject);
  const bindings = LIBRARY_NAMES.map(name => storedBinding(name)).filter(b => b !== undefined);
  let stopped = false; let importing = false;
  const update = (patch: Partial<SyncView>) => { if (!stopped) librarySyncView.value = { ...librarySyncView.peek(), ...patch }; };
  const persist = () => !stopped && saveCache(options.storage, options.subject, cache);
  const notice = (message: string) => update({ notice: message });
  const pendingNames = () => cache.pending.map(p => (p.content as { name?: string } | null)?.name ?? p.id);
  const status = (value: SyncStatus) => {
    update({ status: value, browserOnly: !cache.consent && local().length > 0, remaining: value === 'quota' ? pendingNames() : [] });
    if (value === 'quota') notice('Your account storage is full. These records stayed local.');
  };
  const show = () => { if (stopped) return; if (queueSeedCleanup(cache)) persist(); showBindings(bindings, cache); projects?.show(); };
  const change = () => { if (stopped) return; status(librarySyncView.peek().status === 'quota' ? 'quota' : 'saving'); show(); wake(); };
  const projects = options.projects === undefined ? undefined : startProjectSync({ subject: options.subject, context: options.projects, cache, allowed: options.allowed, persist, change, notice });
  const detach = () => { for (const b of bindings) b.disconnect(); projects?.stop(); };
  const runner = syncRunner({ ...options, cache, hooks: { persist, change: show, notice, ...(projects ? { prepare: projects.prepare } : {}) }, status,
    ...(projects ? { cleanup: projects.cleanup } : {}), unavailable() {
      stopped = true; detach(); librarySyncView.value = { mode: 'local', status: 'saved', display: '', ask: false, notice: cache.pending.length ? 'Account sync is unavailable. Pending account edits remain in this browser.' : null, remaining: [] };
    },
  });
  function wake(): void { if (stopped) return; projects?.wake(); if (!['quota', 'refused'].includes(librarySyncView.peek().status)) runner.wake(); }
  const local = () => [...bindings.flatMap(b => toRecords(b.name, b.local())), ...(projects?.local() ?? [])];
  const counts = Object.fromEntries(['tool', 'material', 'machine', 'project'].map(kind => [kind, local().filter(r => r.kind === kind).length]));
  librarySyncView.value = { mode: 'account', status: cache.pending.length ? 'saving' : 'saved', display: options.display, ask: !cache.consent && local().length > 0, notice: null, remaining: [], browserOnly: !cache.consent && local().length > 0, counts };
  const machines = bindings.find(b => b.name === 'machines')?.local();
  if (Array.isArray(machines)) for (const machine of machines) { const issue = refusal('machine', machine); if (issue !== null) notice(issue); }
  connectBindings(bindings, cache, { persist, change, notice });
  if (queueSeedCleanup(cache)) persist();
  show();
  librarySyncActions.copy = async () => {
    if (stopped || importing) return;
    importing = true; runner.pause(true); update({ ask: false, status: 'saving' });
    try {
      await projects?.refreshLocal();
      if (stopped) return;
      const ok = await prepareImport(cache, local(), persist);
      if (!stopped) { show(); update({ status: ok ? 'saving' : 'retry' }); }
    } catch { update({ status: 'retry', notice: 'The import could not finish. Your browser copies are still here.' }); }
    finally { importing = false; runner.pause(false); wake(); }
  };
  librarySyncActions.notNow = () => update({ ask: false });
  librarySyncActions.dismiss = () => update({ notice: null, remaining: [] });
  librarySyncActions.retry = () => { update({ status: 'saving' }); wake(); };
  if (cache.importSource !== undefined) void librarySyncActions.copy(); else wake();
  return { wake, stop() { if (stopped) return; stopped = true; runner.stop(); detach(); librarySyncView.value = { mode: 'local', status: 'saved', display: '', ask: false, notice: null, remaining: [] }; } };
}
