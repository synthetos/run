/**
 * The post-update restore refuses a backup that was not read in millimetres (review finding 2), the same rule as
 * restoring a stored backup (firmwareHub restoreRefusal): lengths read under G20 are inches, writes are millimetres
 * only (SAFETY §4.6 step 5, H60).
 */
import { describe, expect, it } from 'vitest';
import type { PlannedChange } from '@synthetos/schema';
import type { SnapshotMessage } from '../src/machine-worker/rpc.ts';
import { memoryRepository, pendingKey, type PendingRestore } from '../src/firmware/store.ts';
import { FirmwareUpdater } from '../src/firmware/updater.ts';

const BOARD = 'SIM-EN-0001';
const MILLIMETRES = 'This backup was not read in millimetres, so its lengths cannot be restored safely.';

function memoryStore(): { get(k: string): Promise<unknown>; set(k: string, v: unknown): Promise<void>; delete(k: string): Promise<void>; keys(p: string): Promise<string[]> } {
  const m = new Map<string, unknown>();
  return {
    get: (k) => Promise.resolve(m.get(k)),
    set: (k, v) => Promise.resolve(void m.set(k, v)),
    delete: (k) => Promise.resolve(void m.delete(k)),
    keys: (p) => Promise.resolve([...m.keys()].filter((k) => k.startsWith(p))),
  };
}

const MESSAGE = {
  snapshot: { epoch: 1, identity: { id: BOARD }, classification: { dialectId: 'tinyg-en', mode: 'full' } },
  postFlash: { boardId: BOARD, phase: 'restoreRequired', differences: [{ key: 'xvm', backup: 630 }] },
} as unknown as SnapshotMessage;

async function restoreWith(pending: PendingRestore): Promise<{ readonly refused: string | null; readonly staged: readonly PlannedChange[][] }> {
  const store = memoryStore();
  await store.set(pendingKey(BOARD), pending);
  const staged: PlannedChange[][] = [];
  const u = new FirmwareUpdater({
    flash: () => Promise.resolve(null),
    settingsBackup: () => Promise.resolve(null),
    repo: memoryRepository(),
    store: store as never,
    now: () => new Date('2026-11-19T10:00:00Z'),
    onChange: () => undefined,
    reread: () => undefined,
    boardSettings: () => ({ xvm: 16000 }),
    stageRestore: (c) => void staged.push([...c]),
    readInputs: () => Promise.resolve(null),
    setInterval: () => null,
    clearInterval: () => undefined,
  });
  u.onSnapshot(MESSAGE, false, '');
  return { refused: await u.restore(), staged };
}

const PENDING = { boardId: BOARD, baseline: { xvm: 630 }, backupId: 'b1', at: '2026-11-19T09:00:00Z' };

describe('the post-update restore checks the backup\'s units', () => {
  it('a backup read in inches is refused and nothing is staged', async () => {
    const r = await restoreWith({ ...PENDING, unit: 0 });
    expect(r.refused).toBe(MILLIMETRES);
    expect(r.staged).toEqual([]);
  });

  it('a backup whose units were not recorded is refused', async () => {
    const r = await restoreWith(PENDING);
    expect(r.refused).toBe(MILLIMETRES);
    expect(r.staged).toEqual([]);
  });

  it('a backup read in millimetres is staged', async () => {
    const r = await restoreWith({ ...PENDING, baseline: { xvm: 12000 }, unit: 1 });
    expect(r.refused).toBeNull();
    expect(r.staged[0]?.map((c) => c.key)).toEqual(['xvm']);
  });
});
