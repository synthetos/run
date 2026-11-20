/**
 * Update to X on a connected board is the normal update (owner report 2026-11-20): a failed-update view left in the
 * snapshot from the bootloader probe must not route it to recovery ("Disconnect before recovery.") or skip the
 * settings backup. Recovery is only for a board that is not connected and was found in its bootloader.
 */
import { expect, it } from 'vitest';
import type { FlashCommand, SnapshotMessage } from '../src/machine-worker/rpc.ts';
import { memoryRepository } from '../src/firmware/store.ts';
import { FirmwareUpdater } from '../src/firmware/updater.ts';
import { simHex, simImage } from '@synthetos/testkit';

const BOARD = { id: '3Y2462-WWR', hv: 8, fb: 449.01, fv: 0.97 };
const STALE = { phase: 'failed', bootloader: { startAllowed: false }, board: BOARD, recoveryOffered: true, marked: true };

function updater(message: SnapshotMessage) {
  const sent: FlashCommand[] = [];
  let backups = 0;
  const m = new Map<string, unknown>();
  const u = new FirmwareUpdater({
    flash: (c) => { sent.push(c); return Promise.resolve(null); },
    settingsBackup: () => { backups++; return Promise.resolve(null); },
    repo: memoryRepository(),
    store: { get: (k: string) => Promise.resolve(m.get(k)), set: (k: string, v: unknown) => Promise.resolve(void m.set(k, v)), delete: (k: string) => Promise.resolve(void m.delete(k)), keys: () => Promise.resolve([]) } as never,
    now: () => new Date('2026-11-20T10:00:00Z'),
    onChange: () => undefined,
    reread: () => undefined,
    boardSettings: () => ({}),
    stageRestore: () => undefined,
    readInputs: () => Promise.resolve(null),
    setInterval: () => null,
    clearInterval: () => undefined,
  });
  u.onSnapshot(message, false, '');
  return { u, sent, backups: () => backups };
}

const request = { source: { kind: 'release' as const, hv: 8, fb: 450.06, file: 'tinyg-450.06.hex' }, hex: simHex(simImage('update')), name: 'tinyg-450.06.hex' };

it('connected, with a stale bootloader view: the normal update, with the settings backup', async () => {
  const r = updater({ snapshot: { base: 'CONNECTED_UNKNOWN', epoch: 1, identity: { id: BOARD.id, hv: 8, fb: 449.01 } }, flash: STALE } as unknown as SnapshotMessage);
  expect(await r.u.start(request)).toBeNull();
  expect(r.backups()).toBe(1);
  expect(r.sent).toEqual([expect.objectContaining({ op: 'begin', recovery: false })]);
});

it('not connected, a board found in its bootloader with its hardware confirmed: recovery', async () => {
  const r = updater({ snapshot: { base: 'NOT_CONNECTED', epoch: 1, identity: null }, flash: STALE } as unknown as SnapshotMessage);
  expect(await r.u.start(request)).toBeNull();
  expect(r.backups()).toBe(0);
  expect(r.sent).toEqual([expect.objectContaining({ op: 'begin', recovery: true })]);
});
