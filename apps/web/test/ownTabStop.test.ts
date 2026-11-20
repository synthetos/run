/**
 * The tab whose own worker holds a machine lock controls that machine, LIVE or not (SAFETY §4.3 "Web Lock",
 * H55). Its Pause and Stop job stay available and act on its own worker, as in a LIVE tab (DECISIONS D1, SAFETY
 * §4.4: stop is never gated by LIVE entry). The firmware path connects without LIVE entry (Reconnect, Start
 * firmware, the post-flash connect), so this state is real.
 *
 * A machine lock counts as this tab's own only when this tab's owner lock is held by the same holder: while
 * this worker's request for a lock another tab holds is refused, the other tab's lock stays "another tab".
 */
import { describe, expect, it, vi } from 'vitest';
import type { SessionSnapshot } from '@synthetos/machine';
import type { Decision } from '@synthetos/safety';
import type { LockManagerLike } from '../src/machine-worker/stopChannel.ts';
import { MachineStopService } from '../src/machine-worker/stopService.ts';
import { ownerLockName, splitMachineLocks } from '../src/machine-worker/ownerLock.ts';
import { LockWatcher, type Timers } from '../src/live/tabStop.ts';
import { StopControls } from '../src/live/stopControls.ts';
import { startStopPaths } from '../src/live/stopBoot.ts';

const timers: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
const M = 'synthetos-machine:3Y2462-WWR';

function locksHeld(held: { name: string; clientId?: string }[]): LockManagerLike {
  return { request: () => Promise.resolve(), query: () => Promise.resolve({ held }) };
}

/**
 * Web Locks across contexts: each client (worker or page) gets its own view, and the query reports each holder's
 * `clientId` as a browser does. With `holdRefusals`, a refused request waits for `answerRefusals`, so a poll can run
 * while a refusal is still on its way.
 */
class ClientLocks {
  readonly #held = new Map<string, string>();
  readonly #waiting: (() => void)[] = [];
  holdRefusals = false;
  get refusals(): number {
    return this.#waiting.length;
  }
  answerRefusals(): void {
    for (const answer of this.#waiting.splice(0)) answer();
  }
  client(clientId: string): LockManagerLike {
    return {
      request: (name, _options, callback) => {
        if (this.#held.has(name)) {
          if (!this.holdRefusals) return callback(null);
          return new Promise<void>((resolve) => this.#waiting.push(() => void callback(null).then(resolve)));
        }
        this.#held.set(name, clientId);
        return callback({ name }).finally(() => this.#held.delete(name));
      },
      query: () => Promise.resolve({ held: [...this.#held].map(([name, holder]) => ({ name, clientId: holder })) }),
    };
  }
}

function worker(locks: LockManagerLike, owner: string): { open(): void } {
  const listeners: (() => void)[] = [];
  let snapshot = { port: null, identity: null } as unknown as SessionSnapshot;
  const allowed = { allowed: true } as unknown as Decision;
  const session = {
    get snapshot() {
      return snapshot;
    },
    subscribe: (l: () => void) => listeners.push(l),
    feedhold: () => allowed,
    stopJob: () => allowed,
    spindleOffNow: () => allowed,
  };
  new MachineStopService({ session, channel: null, locks, instance: 'w1', owner });
  return {
    open: () => {
      snapshot = { port: { kind: 'sim', usbVendorId: 1, usbProductId: 2 }, identity: { id: M.slice('synthetos-machine:'.length) } } as unknown as SessionSnapshot;
      for (const l of listeners) l();
    },
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function controls() {
  const sent: string[] = [];
  const own = vi.fn();
  const stopOwn = vi.fn();
  const c = new StopControls({ broadcast: (action) => (sent.push(action), new Promise(() => undefined)), pauseOwnWorker: own, stopJobOwnWorker: stopOwn, timers });
  return { c, sent, own, stopOwn };
}

describe('StopControls in the own-lock, not-LIVE state', () => {
  it('Pause and Stop job are available while this tab owns a machine lock, LIVE or not', () => {
    const { c } = controls();
    expect(c.view.value.available).toBe(false);
    c.setRole({ held: [], own: [M], released: [], observing: false });
    expect(c.view.value.available).toBe(true);
    c.setRole({ held: [], own: [], released: [], observing: false });
    expect(c.view.value.available).toBe(false);
  });

  it('Pause and Stop job go to this tab own worker as local controls, and to every worker', () => {
    const { c, sent, own, stopOwn } = controls();
    c.setRole({ held: [], own: [M], released: [], observing: false });
    c.pause();
    c.stopJob();
    expect(own).toHaveBeenCalledTimes(1);
    expect(stopOwn).toHaveBeenCalledTimes(1);
    expect(sent).toEqual(['pause', 'stopJob']);
  });
});

describe('own machine locks', () => {
  it('a machine lock and this tab owner lock held by the same holder are own', async () => {
    const locks = locksHeld([{ name: M, clientId: 'w1' }, { name: ownerLockName('tab-1', M), clientId: 'w1' }]);
    expect(await splitMachineLocks(locks, 'tab-1')).toEqual({ others: [], own: [M] });
  });

  it("another tab's machine lock stays another tab's while this worker briefly holds its owner lock (refused request)", async () => {
    const locks = locksHeld([{ name: M, clientId: 'tab-2-worker' }, { name: ownerLockName('tab-1', M), clientId: 'w1' }]);
    expect(await splitMachineLocks(locks, 'tab-1')).toEqual({ others: [M], own: [] });
  });

  it("no W29 flicker: while this tab's worker is refused a lock another tab holds, this tab still observes it", async () => {
    const locks = new ClientLocks();
    const a = worker(locks.client('worker-a'), 'tab-a');
    const b = worker(locks.client('worker-b'), 'tab-b');
    const paths = startStopPaths({ target: { addEventListener: () => undefined }, channel: null, locks: locks.client('page-b'), owner: 'tab-b', timers, newId: () => 'id', pauseOwnWorker: () => undefined });
    paths.watcher.stop();
    a.open();
    await flush();
    await paths.watcher.poll();
    expect(paths.watcher.role.observing).toBe(true);
    locks.holdRefusals = true;
    b.open();
    await flush();
    expect(locks.refusals).toBe(1); // Tab B's worker holds its owner lock and waits for the answer for M.
    await paths.watcher.poll();
    expect(paths.watcher.role.observing).toBe(true);
    expect(paths.watcher.role.released).toEqual([]);
    locks.answerRefusals();
    await flush();
    await paths.watcher.poll();
    expect(paths.watcher.role.observing).toBe(true);
    expect(paths.watcher.role.released).toEqual([]);
  });

  it('the watcher reports own locks and does not observe them; no owner token: everything is another tab', async () => {
    const locks = locksHeld([{ name: M, clientId: 'w1' }, { name: ownerLockName('tab-1', M), clientId: 'w1' }]);
    const mine = new LockWatcher({ locks, owner: 'tab-1', isLive: () => false, timers, onChange: () => undefined });
    await mine.poll();
    expect(mine.role).toEqual({ held: [], own: [M], released: [], observing: false });
    const blind = new LockWatcher({ locks, owner: null, isLive: () => false, timers, onChange: () => undefined });
    await blind.poll();
    expect(blind.role).toEqual({ held: [M], own: [], released: [], observing: true });
  });
});
