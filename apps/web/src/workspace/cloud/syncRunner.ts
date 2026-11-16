import { RecordsError, type RecordsClient } from '../../cloud/recordsClient.ts';
import type { CloudCache } from './cloudCache.ts';
import { RECORD_KINDS, refusal } from './recordReaders.ts';
import { queueSeedCleanup } from './seedCleanup.ts';
import { drainQueue, retryDelay, type QueueHooks, type SyncStatus } from './syncQueue.ts';

export interface RunnerOptions {
  cache: CloudCache; client: RecordsClient; allowed(): boolean; hooks: QueueHooks;
  status(status: SyncStatus): void; unavailable(): void; cleanup?(signal: AbortSignal): Promise<void>;
  setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void;
}
/** Serial network lifetime, shared by all four record kinds and project file operations. */
export function syncRunner(options: RunnerOptions) {
  let stopped = false; let busy = false; let paused = false; let refresh = true; let attempt = 0;
  let timer: unknown; let abort: AbortController | null = null;
  function schedule(): void {
    options.clearTimeout(timer);
    timer = options.setTimeout(() => { timer = undefined; void run(); }, retryDelay(attempt++));
  }
  async function read(signal: AbortSignal): Promise<void> {
    const records = [];
    for (const kind of RECORD_KINDS) {
      if (signal.aborted || !options.allowed()) return;
      const page = await options.client.list(kind, signal);
      if (stopped || signal.aborted) return;
      for (const record of page) {
        const issue = refusal(kind, record.content);
        if (issue === null) records.push(record); else options.hooks.notice(issue);
      }
    }
    if (signal.aborted || !options.allowed()) return;
    options.cache.records = records; queueSeedCleanup(options.cache); refresh = false;
    options.hooks.persist(); options.hooks.change();
  }
  const cancelled = () => stopped || abort?.signal.aborted === true;
  const idle = () => !stopped && !busy && !paused && options.allowed();
  function failed(error: unknown): void {
    if (cancelled()) return;
    if (error instanceof RecordsError && (error.status === 401 || error.status === 503)) {
      stopped = true; options.unavailable(); return;
    }
    if (error instanceof RecordsError && error.status === 413) options.status('quota');
    else { options.status('retry'); schedule(); }
  }
  function finished(): void {
    const interrupted = abort?.signal.aborted;
    busy = false; abort = null;
    if (interrupted && idle()) schedule();
  }
  async function flush(signal: AbortSignal): Promise<SyncStatus> {
    for (;;) {
      const status = await drainQueue(options.cache, options.client, options.allowed, signal, options.hooks);
      if (cancelled() || status !== 'saved') return status;
      await options.cleanup?.(signal);
      if (cancelled() || !options.allowed()) return 'saving';
      if (options.cache.pending.length === 0) return 'saved';
      // wake() can arrive while cleanup is awaiting DELETE. Drain that work before reporting saved.
    }
  }
  async function run(): Promise<void> {
    if (!idle()) return;
    busy = true; abort = new AbortController();
    try {
      if (refresh) await read(abort.signal);
      if (cancelled() || refresh) return;
      const status = await flush(abort.signal);
      if (cancelled()) return;
      options.status(status);
      if (status === 'retry') schedule(); else attempt = 0;
    } catch (error) { failed(error); }
    finally { finished(); }
  }
  return {
    wake() { if (!options.allowed()) abort?.abort(); else void run(); },
    pause(value: boolean) { paused = value; if (value) abort?.abort(); },
    stop() { stopped = true; abort?.abort(); options.clearTimeout(timer); },
  };
}
