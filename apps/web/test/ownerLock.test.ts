/**
 * The tab's own machine lock is never "another tab" (owner report
 * 2026-11-19; SAFETY §4.3 "Web Lock", H55: the tab whose worker holds the
 * lock is the controlling tab).
 *
 * The worker holds an owner lock named after its tab's token for as long as
 * it holds a machine lock: taken before it, let go after it. One lock query
 * then shows, without a race, which machine locks are this tab's own.
 */
import { describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '@synthetos/machine';
import type { Decision } from '@synthetos/safety';
import type { LockManagerLike } from '../src/machine-worker/stopChannel.ts';
import { MachineStopService, type StopSession } from '../src/machine-worker/stopService.ts';
import { othersOnly, ownerLockName, workerOwner } from '../src/machine-worker/ownerLock.ts';
import { MACHINE_WORKER_NAME, machineWorkerName } from '../src/machine-worker/client.ts';
import { LockWatcher, NO_ROLE, type Timers } from '../src/live/tabStop.ts';
import { startStopPaths } from '../src/live/stopBoot.ts';

class FakeLocks implements LockManagerLike {
  readonly held = new Map<string, () => void>();
  readonly released: string[] = [];
  request(name: string, _options: { readonly ifAvailable: true }, callback: (lock: unknown) => Promise<void>): Promise<void> {
    if (this.held.has(name)) return callback(null);
    let done!: () => void;
    const p = new Promise<void>((resolve) => (done = resolve));
    this.held.set(name, done);
    void callback({ name }).then(() => {
      this.held.delete(name);
      this.released.push(name);
      done();
    });
    return p;
  }
  query(): Promise<{ held: { name: string }[] }> {
    return Promise.resolve({ held: [...this.held.keys()].map((name) => ({ name })) });
  }
}

const allowed = { allowed: true } as unknown as Decision;

function session(id: string): StopSession & { open(): void; close(): void } {
  const listeners: (() => void)[] = [];
  let snapshot = { port: null, identity: null } as unknown as SessionSnapshot;
  const set = (patch: Record<string, unknown>): void => {
    snapshot = { ...snapshot, ...patch } as SessionSnapshot;
    for (const l of listeners) l();
  };
  return {
    get snapshot() {
      return snapshot;
    },
    subscribe: (l: () => void) => listeners.push(l),
    feedhold: () => allowed,
    stopJob: () => allowed,
    spindleOffNow: () => allowed,
    open: () => set({ port: { kind: 'sim', usbVendorId: 1, usbProductId: 2 }, identity: { id } }),
    close: () => set({ port: null, identity: null }),
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const timers: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
const MACHINE = 'synthetos-machine:3Y2462-WWR';

function worker(locks: FakeLocks, owner: string | null): ReturnType<typeof session> {
  const s = session('3Y2462-WWR');
  new MachineStopService({ session: s, channel: null, locks, instance: 'w1', owner });
  return s;
}

describe('owner lock (machine.worker)', () => {
  it('is held from before the machine lock is taken until after it is let go', async () => {
    const locks = new FakeLocks();
    const s = worker(locks, 'tab-1');
    s.open();
    await flush();
    expect([...locks.held.keys()]).toEqual([ownerLockName('tab-1', MACHINE), MACHINE]);
    s.close();
    await flush();
    expect(locks.released).toEqual([MACHINE, ownerLockName('tab-1', MACHINE)]);
  });

  it('is let go when another tab already holds the machine lock', async () => {
    const locks = new FakeLocks();
    locks.held.set(MACHINE, () => undefined);
    const s = worker(locks, 'tab-1');
    s.open();
    await flush();
    expect([...locks.held.keys()]).toEqual([MACHINE]);
  });

  it('is not taken by a worker without a tab token', async () => {
    const locks = new FakeLocks();
    worker(locks, null).open();
    await flush();
    expect([...locks.held.keys()]).toEqual([MACHINE]);
  });
});

describe('LockWatcher with the own lock left out', () => {
  it("the tab's own worker lock is not observed and its release is not W29, even when the tab is not LIVE", async () => {
    const locks = new FakeLocks();
    const s = worker(locks, 'tab-1');
    const watcher = new LockWatcher(othersOnly(locks, 'tab-1'), () => false, timers, () => undefined);
    s.open();
    await flush();
    await watcher.poll();
    expect(watcher.role).toEqual(NO_ROLE);
    s.close();
    await flush();
    await watcher.poll();
    expect(watcher.role).toEqual(NO_ROLE);
  });

  it("another tab's worker lock still makes this tab an observer, and its release is still W29", async () => {
    const locks = new FakeLocks();
    const other = worker(locks, 'tab-2');
    const watcher = new LockWatcher(othersOnly(locks, 'tab-1'), () => false, timers, () => undefined);
    other.open();
    await flush();
    await watcher.poll();
    expect(watcher.role).toEqual({ held: [MACHINE], released: [], observing: true });
    other.close();
    await flush();
    await watcher.poll();
    expect(watcher.role).toEqual({ held: [], released: [MACHINE], observing: false });
  });

  it('startStopPaths leaves out the locks of its own tab token', async () => {
    const locks = new FakeLocks();
    const s = worker(locks, 'tab-1');
    const paths = startStopPaths({ target: { addEventListener: () => undefined }, channel: null, locks, owner: 'tab-1', timers, newId: () => 'id', pauseOwnWorker: () => undefined });
    paths.watcher.stop();
    s.open();
    await flush();
    await paths.watcher.poll();
    expect(paths.watcher.role.observing).toBe(false);
  });
});

describe('tab token', () => {
  it('travels in the worker name and is read back inside the worker', () => {
    expect(machineWorkerName('tab-1')).toBe(`${MACHINE_WORKER_NAME}:tab-1`);
    expect(workerOwner(machineWorkerName('tab-1'))).toBe('tab-1');
    expect(workerOwner(MACHINE_WORKER_NAME)).toBeNull();
    expect(workerOwner('machine:')).toBeNull();
    expect(workerOwner(undefined)).toBeNull();
  });
});
