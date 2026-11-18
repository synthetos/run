/**
 * The account's setup record on the page (first-run design §6.1): what the setup wizard reads to decide whether to
 * open and where to resume, and the one way it writes. The record rides the library sync's cache and queue like
 * every other account record; nothing here touches browser storage of its own. `setupView` is the page's view of
 * it, `saveSetup` the write: both are inert until `connectSetup` has run for a signed-in account.
 */
import { computed, signal } from '@preact/signals';
import { EMPTY_SETUP_RECORD, SETUP_RECORD_ID, type SetupRecord, type Stock } from '@synthetos/library';
import type { CloudCache } from './cloudCache.ts';
import { enqueue, visibleRecords } from './syncQueue.ts';

export interface SetupView {
  readonly record: SetupRecord | null;
  /** Machine records the account holds (pending writes included). */
  readonly machines: number;
  /** The account's records have been read at least once this session. */
  readonly refreshed: boolean;
  /** A signed-in account's sync is active. */
  readonly account: boolean;
}

const NO_ACCOUNT: SetupView = Object.freeze({ record: null, machines: 0, refreshed: false, account: false });
export const setupView = signal<SetupView>(NO_ACCOUNT);

/** The stock chosen in setup, offered to new jobs until a project uses it (R12). */
export const defaultStock = computed<Stock | null>(() => {
  const record = setupView.value.record;
  return record !== null && record.projectId === null ? record.stock : null;
});

export type SetupPatch = Partial<Omit<SetupRecord, 'v' | 'id' | 'updatedAt'>>;
type Writer = (patch: SetupPatch, now: () => Date) => boolean;
let writer: Writer | null = null;

export interface SetupHooks { persist(): boolean; change(): void }

/** Binds the view and the writer to one account's cache; `show` after every cache change, `refreshed` after the first read. */
export function connectSetup(cache: CloudCache, hooks: SetupHooks): { show(): void; refreshed(): void; stop(): void } {
  let refreshed = false;
  const show = (): void => {
    const visible = visibleRecords(cache);
    const record = (visible.find((r) => r.kind === 'setup')?.content as SetupRecord | undefined) ?? null;
    setupView.value = { record, machines: visible.filter((r) => r.kind === 'machine').length, refreshed, account: true };
  };
  writer = (patch, now) => {
    const current = setupView.peek().record ?? EMPTY_SETUP_RECORD;
    enqueue(cache, 'setup', SETUP_RECORD_ID, { ...current, ...patch, updatedAt: now().toISOString() });
    show();
    hooks.persist();
    hooks.change();
    return true;
  };
  show();
  return {
    show,
    refreshed() { refreshed = true; show(); },
    stop() { writer = null; setupView.value = NO_ACCOUNT; },
  };
}

/** Merges `patch` onto the account's setup record and queues the write. False when no account sync is active. */
export function saveSetup(patch: SetupPatch, now: () => Date = () => new Date()): boolean {
  return writer === null ? false : writer(patch, now);
}
