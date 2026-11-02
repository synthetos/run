/**
 * ROADMAP P1-06: Pause, Escape, the machine Web Lock and cross-tab stop
 * requests (SAFETY §4.3, §4.4; T-S18, T-S29, T-S73 at unit level).
 *
 * A fake BroadcastChannel bus (delivery to every other channel of the same
 * name, asynchronously, as browsers do) and a fake LockManager stand in for
 * the browser; the worker side (`MachineStopService`) and the window side
 * (`TabStop`, `LockWatcher`, `StopControls`) are the shipped classes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import { signal } from '@preact/signals';
import type { SessionSnapshot } from '@synthetos/machine';
import type { Decision } from '@synthetos/safety';
import { STOP_TEXT, w10, w29, w2Label, w30 } from '@synthetos/safety';
import { machineLockName, parseStopAck, parseStopRequest, STOP_ACK_TIMEOUT_MS, type BroadcastChannelLike, type LockManagerLike } from '../src/machine-worker/stopChannel.ts';
import { MachineStopService, type StopSession } from '../src/machine-worker/stopService.ts';
import { forgetDeviceSafety, memoryDeviceSafety } from '../src/live/deviceSafety.ts';
import { ObserverPanel } from '../src/live/ObserverPanel.ts';
import { StopControls } from '../src/live/stopControls.ts';
import { installEscapeStop, LockWatcher, NO_ROLE, TabStop, type StopOutcome, type Timers } from '../src/live/tabStop.ts';
import { SafetyBar, type StopBarView } from '../src/shell/SafetyBar.ts';
import { all, one, root, text } from './tree.ts';

// ---------------------------------------------------------------- fakes

class Bus {
  readonly channels: FakeChannel[] = [];
  channel(): FakeChannel {
    const c = new FakeChannel(this);
    this.channels.push(c);
    return c;
  }
}

class FakeChannel implements BroadcastChannelLike {
  readonly posted: unknown[] = [];
  readonly #listeners: ((event: { data: unknown }) => void)[] = [];
  closed = false;
  readonly bus: Bus;
  constructor(bus: Bus) {
    this.bus = bus;
  }
  postMessage(message: unknown): void {
    this.posted.push(message);
    const data = structuredClone(message);
    for (const other of this.bus.channels) {
      if (other === this || other.closed) continue;
      queueMicrotask(() => other.deliver(data));
    }
  }
  addEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    this.#listeners.push(listener);
  }
  deliver(data: unknown): void {
    if (this.closed) return;
    for (const l of this.#listeners) l({ data });
  }
}

class FakeLocks implements LockManagerLike {
  readonly held = new Map<string, () => void>();
  failQuery = false;
  request(name: string, _options: { readonly ifAvailable: true }, callback: (lock: unknown) => Promise<void>): Promise<void> {
    if (this.held.has(name)) return callback(null);
    let done!: () => void;
    const p = new Promise<void>((resolve) => (done = resolve));
    this.held.set(name, done);
    void callback({ name }).then(() => {
      this.held.delete(name);
      done();
    });
    return p;
  }
  query(): Promise<{ held: { name: string }[] }> {
    if (this.failQuery) return Promise.reject(new Error('no'));
    return Promise.resolve({ held: [...this.held.keys()].map((name) => ({ name })) });
  }
  /** The tab holding `name` is gone (crash or close). */
  drop(name: string): void {
    this.held.delete(name);
  }
}

const allowed = { allowed: true } as unknown as Decision;

function fakeSession(id: string | undefined): StopSession & { calls: string[]; open(): void; close(): void; setId(id: string): void } {
  const listeners: (() => void)[] = [];
  let snapshot = { port: null, identity: null, live: { pos: {}, mpo: {} } } as unknown as SessionSnapshot;
  const set = (patch: Partial<Record<string, unknown>>): void => {
    snapshot = { ...snapshot, ...patch } as SessionSnapshot;
    for (const l of listeners) l();
  };
  const calls: string[] = [];
  return {
    calls,
    get snapshot() {
      return snapshot;
    },
    subscribe: (l: () => void) => listeners.push(l),
    feedhold: () => (calls.push('feedhold'), allowed),
    stopJob: () => (calls.push('stopJob'), allowed),
    spindleOffNow: () => (calls.push('spindleOffNow'), allowed),
    open: () => set({ port: { kind: 'sim', usbVendorId: 1, usbProductId: 2 }, identity: id === undefined ? null : { id } }),
    close: () => set({ port: null, identity: null }),
    setId: (next: string) => set({ identity: { id: next } }),
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const realTimers: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

let ids = 0;
const newId = (): string => `req-${++ids}`;

// ---------------------------------------------------------------- protocol

describe('stop channel protocol', () => {
  it('accepts exactly a stop-class request and nothing else', () => {
    expect(parseStopRequest({ v: 1, kind: 'stop-request', id: 'a', action: 'pause' })).toEqual({ v: 1, kind: 'stop-request', id: 'a', action: 'pause' });
    for (const bad of [
      { v: 1, kind: 'stop-request', id: 'a', action: 'start' },
      { v: 1, kind: 'stop-request', id: 'a', action: 'gcode', line: 'G0 X10' },
      { v: 1, kind: 'stop-request', id: 'a', action: 'pause', extra: 1 },
      { v: 2, kind: 'stop-request', id: 'a', action: 'pause' },
      { v: 1, kind: 'open', id: 'a', action: 'pause' },
      { v: 1, kind: 'stop-request', id: '', action: 'pause' },
      { v: 1, kind: 'stop-request', id: 'x'.repeat(65), action: 'pause' },
      { v: 3, kind: 'intent', intent: 'feedhold' },
      'pause',
      ['pause'],
      null,
    ]) {
      expect(parseStopRequest(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(parseStopAck({ v: 1, kind: 'stop-ack', id: 'a', machine: 'synthetos-machine:X', accepted: true })).not.toBeNull();
    expect(parseStopAck({ v: 1, kind: 'stop-ack', id: 'a', machine: 'other:X', accepted: true })).toBeNull();
  });

  it('names the lock by the board id, reduced to safe characters, or per worker when there is none', () => {
    expect(machineLockName('SIM-EN-0001', 'w1')).toBe('synthetos-machine:SIM-EN-0001');
    expect(machineLockName('<b>x y</b>', 'w1')).toBe('synthetos-machine:bxyb');
    expect(machineLockName(undefined, 'abc')).toBe('synthetos-machine:unidentified-abc');
    expect(machineLockName('‮', 'abc')).toBe('synthetos-machine:unidentified-abc');
  });
});

// ---------------------------------------------------------------- worker

describe('MachineStopService (machine.worker)', () => {
  function setup(id: string | null = 'SIM-EN-0001', locks = new FakeLocks(), bus = new Bus()) {
    const session = fakeSession(id ?? undefined);
    const channel = bus.channel();
    const service = new MachineStopService({ session, channel, locks, instance: 'w1' });
    return { session, channel, service, locks, bus };
  }

  it('holds synthetos-machine:<board id> while a port is open and releases it on close', async () => {
    const { session, locks, service } = setup(null);
    expect(service.lock).toEqual({ kind: 'none' });
    session.open();
    await flush();
    expect([...locks.held.keys()]).toEqual(['synthetos-machine:unidentified-w1']);
    session.setId('SIM-EN-0001');
    await flush();
    expect([...locks.held.keys()]).toEqual(['synthetos-machine:SIM-EN-0001']);
    expect(service.lock).toEqual({ kind: 'held', name: 'synthetos-machine:SIM-EN-0001' });
    session.close();
    await flush();
    expect([...locks.held.keys()]).toEqual([]);
  });

  it('does not take a lock another tab holds for the same board (contended) and still answers stops', async () => {
    const locks = new FakeLocks();
    locks.held.set('synthetos-machine:SIM-EN-0001', () => undefined);
    const { session, service, bus, channel } = setup('SIM-EN-0001', locks);
    session.open();
    await flush();
    expect(service.lock).toEqual({ kind: 'contended', name: 'synthetos-machine:SIM-EN-0001' });
    const tab = bus.channel();
    tab.postMessage({ v: 1, kind: 'stop-request', id: 'r', action: 'pause' });
    await flush();
    expect(session.calls).toEqual(['feedhold']);
    expect(channel.posted).toHaveLength(1);
  });

  it('acts on each stop-class request and acknowledges it at once (T-S29: no window thread involved)', async () => {
    const { session, channel, bus } = setup();
    session.open();
    await flush();
    const tab = bus.channel();
    tab.postMessage({ v: 1, kind: 'stop-request', id: 'r1', action: 'pause' });
    tab.postMessage({ v: 1, kind: 'stop-request', id: 'r2', action: 'stopJob' });
    tab.postMessage({ v: 1, kind: 'stop-request', id: 'r3', action: 'spindleOff' });
    await flush();
    expect(session.calls).toEqual(['feedhold', 'stopJob', 'spindleOffNow']);
    expect(channel.posted).toEqual(
      ['r1', 'r2', 'r3'].map((id) => ({ v: 1, kind: 'stop-ack', id, machine: 'synthetos-machine:SIM-EN-0001', accepted: true })),
    );
  });

  it('ignores every non-stop message on the channel: no session call, no answer (T-S73)', async () => {
    const { session, channel, bus } = setup();
    session.open();
    await flush();
    const tab = bus.channel();
    for (const m of [{ v: 3, kind: 'open', port: {} }, { v: 1, kind: 'stop-request', id: 'x', action: 'resume' }, { v: 3, kind: 'read', tokens: ['md'] }, 'reset', { kind: 'stop-ack' }]) tab.postMessage(m);
    await flush();
    expect(session.calls).toEqual([]);
    expect(channel.posted).toEqual([]);
  });

  it('answers nothing without an open port: it has no machine', async () => {
    const { session, channel, bus } = setup();
    bus.channel().postMessage({ v: 1, kind: 'stop-request', id: 'r', action: 'pause' });
    await flush();
    expect(session.calls).toEqual([]);
    expect(channel.posted).toEqual([]);
  });
});

// ---------------------------------------------------------------- window

describe('TabStop (requesting tab)', () => {
  it('posts the request synchronously, before anything is awaited (T-S19)', () => {
    const bus = new Bus();
    const channel = bus.channel();
    const stop = new TabStop({ channel, locks: new FakeLocks(), timers: realTimers, newId });
    void stop.request('pause');
    expect(channel.posted).toHaveLength(1);
    expect(channel.posted[0]).toMatchObject({ v: 1, kind: 'stop-request', action: 'pause' });
  });

  it('with two machines LIVE a stop reaches both, and the result lists each machine (T-S73)', async () => {
    const bus = new Bus();
    const locks = new FakeLocks();
    const a = fakeSession('BOARD-A');
    const b = fakeSession('BOARD-B');
    new MachineStopService({ session: a, channel: bus.channel(), locks, instance: 'a' });
    new MachineStopService({ session: b, channel: bus.channel(), locks, instance: 'b' });
    a.open();
    b.open();
    await flush();
    const stop = new TabStop({ channel: bus.channel(), locks, timers: realTimers, newId });
    const result = stop.request('pause');
    await vi.advanceTimersByTimeAsync(STOP_ACK_TIMEOUT_MS);
    expect(a.calls).toEqual(['feedhold']);
    expect(b.calls).toEqual(['feedhold']);
    expect(await result).toEqual({
      kind: 'delivered',
      action: 'pause',
      machines: [
        { machine: 'synthetos-machine:BOARD-A', delivered: true, accepted: true },
        { machine: 'synthetos-machine:BOARD-B', delivered: true, accepted: true },
      ],
    });
  });

  it('a held lock whose worker does not answer within 250 ms is STOP NOT DELIVERED (T-S73, HIL-1.11)', async () => {
    const bus = new Bus();
    const locks = new FakeLocks();
    const a = fakeSession('BOARD-A');
    const blocked = bus.channel();
    new MachineStopService({ session: a, channel: blocked, locks, instance: 'a' });
    a.open();
    await flush();
    blocked.closed = true; // The worker is blocked: nothing reaches it.
    const stop = new TabStop({ channel: bus.channel(), locks, timers: realTimers, newId });
    const result = stop.request('stopJob');
    await vi.advanceTimersByTimeAsync(STOP_ACK_TIMEOUT_MS - 1);
    let settled = false;
    void result.then(() => (settled = true));
    await flush();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ kind: 'not-delivered', action: 'stopJob', machines: [{ machine: 'synthetos-machine:BOARD-A', delivered: false, accepted: false }] });
  });

  it('no lock held and no answer: nothing to stop; unreadable locks and no answer: not delivered', async () => {
    const bus = new Bus();
    const locks = new FakeLocks();
    const stop = new TabStop({ channel: bus.channel(), locks, timers: realTimers, newId });
    const none = stop.request('pause');
    await vi.advanceTimersByTimeAsync(STOP_ACK_TIMEOUT_MS);
    expect((await none).kind).toBe('no-machine');
    locks.failQuery = true;
    const unknown = stop.request('pause');
    await vi.advanceTimersByTimeAsync(STOP_ACK_TIMEOUT_MS);
    expect((await unknown).kind).toBe('not-delivered');
    const noChannel = new TabStop({ channel: null, locks: new FakeLocks(), timers: realTimers, newId }).request('pause');
    await vi.advanceTimersByTimeAsync(STOP_ACK_TIMEOUT_MS);
    expect((await noChannel).kind).toBe('no-machine');
  });
});

describe('LockWatcher (observer tab)', () => {
  it('another tab holding a machine lock makes this tab an observer; its release is W29 until dismissed', async () => {
    const locks = new FakeLocks();
    let live = false;
    const roles: unknown[] = [];
    const watcher = new LockWatcher(locks, () => live, realTimers, (r) => roles.push(r));
    await watcher.poll();
    expect(watcher.role).toEqual(NO_ROLE);
    locks.held.set('synthetos-machine:BOARD-A', () => undefined);
    await watcher.poll();
    expect(watcher.role).toEqual({ held: ['synthetos-machine:BOARD-A'], released: [], observing: true });
    locks.drop('synthetos-machine:BOARD-A');
    await watcher.poll();
    expect(watcher.role).toEqual({ held: [], released: ['synthetos-machine:BOARD-A'], observing: false });
    await watcher.poll();
    expect(watcher.role.released).toEqual(['synthetos-machine:BOARD-A']);
    watcher.dismissReleased();
    expect(watcher.role).toEqual(NO_ROLE);
    // A LIVE tab observes nothing, even with its own worker's lock held.
    live = true;
    locks.held.set('synthetos-machine:MINE', () => undefined);
    await watcher.poll();
    expect(watcher.role.observing).toBe(false);
    expect(roles.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps what it shows when the locks cannot be read', async () => {
    const locks = new FakeLocks();
    locks.held.set('synthetos-machine:BOARD-A', () => undefined);
    const watcher = new LockWatcher(locks, () => false, realTimers, () => undefined);
    await watcher.poll();
    locks.failQuery = true;
    locks.drop('synthetos-machine:BOARD-A');
    await watcher.poll();
    expect(watcher.role.observing).toBe(true);
  });

  it('polls every 250 ms once started', async () => {
    const locks = new FakeLocks();
    const watcher = new LockWatcher(locks, () => false, realTimers, () => undefined);
    watcher.start();
    await vi.advanceTimersByTimeAsync(1);
    locks.held.set('synthetos-machine:X', () => undefined);
    await vi.advanceTimersByTimeAsync(260);
    expect(watcher.role.observing).toBe(true);
    watcher.stop();
  });
});

describe('Escape (T-S18)', () => {
  it('is listened for in the capture phase; Escape pauses, Space and other keys never do', () => {
    let listener: ((e: KeyboardEvent) => void) | null = null;
    let options: unknown = null;
    const onPause = vi.fn();
    installEscapeStop(
      {
        addEventListener: (_t, l, o) => {
          listener = l;
          options = o;
        },
      },
      onPause,
    );
    expect(options).toEqual({ capture: true });
    const fire = (key: string): void => (listener as unknown as (e: { key: string }) => void)({ key });
    fire(' ');
    fire('Spacebar');
    fire('Enter');
    fire('p');
    expect(onPause).not.toHaveBeenCalled();
    fire('Escape');
    expect(onPause).toHaveBeenCalledTimes(1);
  });
});

describe('StopControls', () => {
  function controls() {
    const sent: string[] = [];
    const own = vi.fn();
    let resolve!: (o: StopOutcome) => void;
    const c = new StopControls({
      broadcast: (action) => {
        sent.push(action);
        return new Promise((r) => (resolve = r));
      },
      pauseOwnWorker: own,
      timers: realTimers,
    });
    return { c, sent, own, settle: (o: StopOutcome) => resolve(o) };
  }

  it('Pause in a LIVE tab goes to its own worker and to every worker, synchronously; PAUSE REQUESTED until a hold is reported, then W30', () => {
    const { c, sent, own } = controls();
    c.setLive(true);
    c.pause();
    expect(own).toHaveBeenCalledTimes(1);
    expect(sent).toEqual(['pause']);
    expect(c.view.value.band).toBe('pause-requested');
    c.setSnapshot({ live: { machineClass: 'held', pos: {}, mpo: {} } } as unknown as SessionSnapshot);
    expect(c.view.value.band).toBe('held');
    c.setLive(false);
    expect(c.view.value).toEqual({ available: false, band: null, outcome: null });
  });

  it('Pause in a tab that is not LIVE still broadcasts (never gated) but sends no own intent', () => {
    const { c, sent, own } = controls();
    c.pause();
    expect(own).not.toHaveBeenCalled();
    expect(sent).toEqual(['pause']);
  });

  it('shows STOP NOT DELIVERED until the next request, and a delivery for a few seconds', async () => {
    const { c, settle } = controls();
    c.request('stopJob');
    settle({ kind: 'not-delivered', action: 'stopJob', machines: [{ machine: 'synthetos-machine:A', delivered: false, accepted: false }] });
    await flush();
    expect(c.view.value.outcome?.kind).toBe('not-delivered');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(c.view.value.outcome?.kind).toBe('not-delivered');
    c.request('pause');
    settle({ kind: 'delivered', action: 'pause', machines: [{ machine: 'synthetos-machine:A', delivered: true, accepted: true }] });
    await flush();
    expect(c.view.value.outcome?.kind).toBe('delivered');
    await vi.advanceTimersByTimeAsync(5000);
    expect(c.view.value.outcome).toBeNull();
  });

  it('enables the stop button for an observer and after a release (W29)', () => {
    const { c } = controls();
    expect(c.view.value.available).toBe(false);
    c.setRole({ held: ['synthetos-machine:A'], released: [], observing: true });
    expect(c.view.value.available).toBe(true);
    c.setRole({ held: [], released: ['synthetos-machine:A'], observing: false });
    expect(c.view.value.available).toBe(true);
  });
});

// ---------------------------------------------------------------- rendering

describe('safety bar and observer panel', () => {
  const build = { version: '1.2.3', sha: '0123456789abcdef0123456789abcdef01234567' };
  const bar = (view: StopBarView, onPause = (): void => undefined) => root(h(SafetyBar, { build, variant: 'workspace', stop: signal(view), onPause }));

  it('a hold shows W30 with W10, never "STOPPED"', () => {
    const el = bar({ available: true, band: 'held', outcome: null });
    const band = one(el, (e) => e.props['data-state'] === 'held');
    expect(band.props['data-safety']).toBe('W30');
    expect(text(band)).toContain(w30());
    expect(text(band)).toContain(w10());
    expect(text(el)).not.toMatch(/STOPPED/);
    expect(text(bar({ available: true, band: 'pause-requested', outcome: null }))).toContain(STOP_TEXT.pauseRequested);
  });

  it('the W2 button is enabled and acts while available; disabled otherwise', () => {
    const onPause = vi.fn();
    const enabled = one(bar({ available: true, band: null, outcome: null }, onPause), (e) => e.tag === 'button' && e.props['class'] === 'stop-button');
    expect(enabled.props['disabled']).toBeUndefined();
    expect(text(enabled)).toContain(w2Label());
    (enabled.props['onClick'] as () => void)();
    expect(onPause).toHaveBeenCalledTimes(1);
    const disabled = one(bar({ available: false, band: null, outcome: null }), (e) => e.tag === 'button' && e.props['class'] === 'stop-button');
    expect(disabled.props['disabled']).toBe(true);
  });

  it('an unacknowledged request shows STOP NOT DELIVERED with the machine', () => {
    const el = bar({ available: true, band: null, outcome: { kind: 'not-delivered', machines: [{ machine: 'synthetos-machine:BOARD-A', delivered: false }] } });
    const line = one(el, (e) => e.props['data-stop-outcome'] === 'not-delivered');
    expect(line.props['role']).toBe('alert');
    expect(text(line)).toBe(`${STOP_TEXT.notDelivered} (BOARD-A)`);
  });

  it('the observer panel offers the two requests, and W29 replaces them when the lock is released', () => {
    const props = { live: false, onPauseRequest: vi.fn(), onStopJobRequest: vi.fn(), onDismiss: vi.fn() };
    const observing = root(h('div', null, h(ObserverPanel, { ...props, role: { held: ['synthetos-machine:A'], released: [], observing: true } })));
    expect(text(observing)).toContain(STOP_TEXT.controlledElsewhere);
    const buttons = all(observing, (e) => e.tag === 'button').map((b) => b.props['data-action']);
    expect(buttons).toEqual(['pause-request', 'stop-job-request']);
    const released = root(h('div', null, h(ObserverPanel, { ...props, role: { held: [], released: ['synthetos-machine:A'], observing: false } })));
    expect(text(one(released, (e) => e.props['data-safety'] === 'W29'))).toContain(w29().slice(w29().indexOf(' — ') + 3));
    expect(all(released, (e) => e.props['data-action'] === 'pause-request')).toEqual([]);
    expect(all(root(h('div', null, h(ObserverPanel, { ...props, live: true, role: { held: ['synthetos-machine:A'], released: [], observing: true } }))), (e) => e.tag === 'button')).toEqual([]);
  });
});

// ---------------------------------------------------------------- storage

describe('destructive device-safety operations (SAFETY §4.1, T-S73)', () => {
  it('are refused while any machine lock is held, or when the locks cannot be read', async () => {
    const store = memoryDeviceSafety({ 'machine:A:c1': 1, 'machine:A:x': 2, 'advisory': 3 });
    const locks = new FakeLocks();
    locks.held.set('synthetos-machine:OTHER', () => undefined);
    expect(await forgetDeviceSafety(store, locks, 'machine:A:')).toEqual({ ok: false, reason: 'machine-locked' });
    expect(store.data.size).toBe(3);
    locks.failQuery = true;
    expect(await forgetDeviceSafety(store, locks, 'machine:A:')).toEqual({ ok: false, reason: 'locks-unknown' });
    expect(await forgetDeviceSafety(store, null, 'machine:A:')).toEqual({ ok: false, reason: 'locks-unknown' });
    locks.failQuery = false;
    locks.drop('synthetos-machine:OTHER');
    expect(await forgetDeviceSafety(store, locks, 'machine:A:')).toEqual({ ok: true, removed: 2 });
    expect([...store.data.keys()]).toEqual(['advisory']);
    await expect(forgetDeviceSafety(store, locks, '')).rejects.toThrow(/prefix/);
  });
});
