/**
 * The firmware update in the machine worker, against the test kit's flashable
 * board (SAFETY §4.8 as amended 2026-11-03; T-S123, T-S125, T-S126):
 * - a full update with a new EEPROM layout: backups posted and confirmed
 *   before the first write, the reconnect on the same port, the version check;
 * - the post-flash lock: the compare, the required restore (only the backup's
 *   values for the keys that differ), the switch check that unlocks only after
 *   each configured input was read open and closed;
 * - the old-firmware gate; a second flash, Connect and Disconnect refused
 *   while one runs; recovery after an interrupted flash;
 * - trusted custom builds: per board and per image, and read-only without.
 */
import { describe, expect, it } from 'vitest';
import type { PortSelector, Transport, TransportInfo, TransportOpenOptions, TransportSource } from '@synthetos/machine';
import { sha256Hex } from '@synthetos/flasher';
import { settingsReadGroups } from '@synthetos/schema';
import type { FirmwareReleases } from '@synthetos/protocol';
import { FlashableBoard, SIM_IMAGES, SimEndpoint, VirtualClock, simHex, simImage, type SimImageName } from '@synthetos/testkit';
import { MachineWorkerHost } from '../src/machine-worker/host.ts';
import { releaseFor } from '../src/machine-worker/motionFlag.ts';
import { extraApprovals, parseTrustedBuild } from '../src/machine-worker/approval.ts';
import type { FlashBackupsPost, MachineReply, SnapshotMessage } from '../src/machine-worker/rpc.ts';

const PORT: PortSelector = Object.freeze({ usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 });
const ORIGIN = 'http://localhost:4173';

class SimTransport implements Transport {
  readonly #endpoint: SimEndpoint;
  #open = false;
  #closed = false;
  #synced = false;
  #queue: Uint8Array[] = [];
  #wake: (() => void) | undefined;
  #error: Error | undefined;
  constructor(endpoint: SimEndpoint) {
    this.#endpoint = endpoint;
    endpoint.onHostData((c) => {
      if (!this.#open || this.#closed) return;
      // Test rig: a port opened while the board was half-way through a heartbeat line would hand the session the
      // line's tail, which it rightly treats as damaged (ORPHANED_MOTION). Start at a line boundary instead.
      let chunk = c;
      if (!this.#synced) {
        const lf = c.indexOf(0x0a);
        if (lf < 0) return;
        this.#synced = true;
        chunk = c.subarray(lf + 1);
        if (chunk.length === 0) return;
      }
      this.#queue.push(chunk.slice());
      this.#wake?.();
    });
    endpoint.onDisconnect(() => {
      this.#error = new Error('NetworkError: the device has been lost');
      this.#wake?.();
    });
  }
  info(): TransportInfo {
    return { kind: 'sim', usbVendorId: 0x0403, usbProductId: 0x6015 };
  }
  async open(options: TransportOpenOptions): Promise<void> {
    if (!this.#endpoint.connected) throw new Error('NetworkError: no device');
    this.#endpoint.setHostBaud(options.baudRate);
    this.#open = true;
  }
  async writeLine(line: Uint8Array): Promise<void> {
    if (!this.#endpoint.connected) throw new Error('NetworkError');
    // From the first write on, everything received is an answer to this link.
    this.#synced = true;
    this.#endpoint.hostWrite(line);
  }
  get readable(): AsyncIterable<Uint8Array> {
    const next = async (): Promise<IteratorResult<Uint8Array>> => {
      for (;;) {
        const c = this.#queue.shift();
        if (c !== undefined) return { done: false, value: c };
        if (this.#error !== undefined) throw this.#error;
        if (this.#closed) return { done: true, value: undefined };
        await new Promise<void>((r) => (this.#wake = r));
        this.#wake = undefined;
      }
    };
    return { [Symbol.asyncIterator]: () => ({ next }) };
  }
  async close(): Promise<void> {
    this.#closed = true;
    this.#wake?.();
  }
  onDisconnect(cb: () => void): void {
    this.#endpoint.onDisconnect(() => cb());
  }
}

async function sim(name: SimImageName) {
  const s = SIM_IMAGES[name];
  const hex = simHex(simImage(name));
  return { hex, sha256: await sha256Hex(hex), size: new TextEncoder().encode(hex).length, file: s.file, fb: s.build.fb };
}

async function releaseList(minimumFb: number): Promise<FirmwareReleases> {
  const rel = async (name: SimImageName, recommended: boolean) => {
    const x = await sim(name);
    return { hv: 99, fb: x.fb, fv: 0.97, dialect: 'tinyg-en' as const, part: 'x192a3' as const, file: x.file, sha256: x.sha256, size: x.size, date: '2026-11-03', changelog: 'test', recommended, simulatorOnly: true, repo: null, tag: null };
  };
  return { env: 'staging', issuedMs: 0, expiresMs: Number.MAX_SAFE_INTEGER, boards: [{ hv: 99, minimumFb, releases: [await rel('newLayout', true), await rel('update', false), await rel('current', false)] }] };
}

function rig(options: { readonly minimumFb?: number; readonly board?: ConstructorParameters<typeof FlashableBoard>[0] } = {}) {
  const clock = new VirtualClock();
  const board = new FlashableBoard({ model: { bootMs: 50, eepromWriteMs: 0 }, linkBaud: 2_000_000, eeprom: { __layout: 10002, st: 1, zsn: 1 }, ...options.board });
  const endpoint = new SimEndpoint({ clock, device: board, link: { baudRate: 2_000_000, latencyMs: 0.2, coalesceMs: 2 } });
  const source: TransportSource = { kind: 'fake', request: async (p) => (p.grantIndex === 0 && endpoint.connected ? new SimTransport(endpoint) : null) };
  const host = new MachineWorkerHost(source, clock, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130' }, {
    file: null,
    origin: ORIGIN,
    verify: async () => ({ approved: { environment: 'staging', builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 't' }] }, channels: [] }),
    releases: () => releaseList(options.minimumFb ?? 450.01),
  }, releaseFor(ORIGIN));
  const posted: (SnapshotMessage | FlashBackupsPost)[] = [];
  void host.handle({ v: 3, kind: 'subscribe' }, { postMessage: (m) => posted.push(m) });
  /** Drives virtual time (and real tasks, for WebCrypto) until `done()` or the limit. */
  const until = async (done: () => boolean, maxMs = 600_000): Promise<boolean> => {
    const end = clock.now() + maxMs;
    for (let i = 0; i < 400_000; i++) {
      for (let k = 0; k < 30; k++) await Promise.resolve();
      if (done()) return true;
      if (i % 50 === 0) await new Promise((r) => setImmediate(r));
      if (done()) return true;
      const next = clock.nextAt();
      if (next === undefined || next > end) {
        // Nothing on the virtual clock: real work may still be pending (WebCrypto). Give it real time.
        for (let k = 0; k < 200 && !done() && (clock.nextAt() === undefined || (clock.nextAt() as number) > end); k++) await new Promise((r) => setTimeout(r, 1));
        if (done()) return true;
        const again = clock.nextAt();
        if (again === undefined || again > end) {
          if (next !== undefined && next > end) clock.advanceTo(end);
          return false;
        }
        continue;
      }
      clock.advanceTo(next);
    }
    return done();
  };
  const call = async (request: unknown): Promise<MachineReply> => {
    let reply: MachineReply | undefined;
    void host.handle(request).then((r) => (reply = r));
    await until(() => reply !== undefined);
    return reply as MachineReply;
  };
  const backupsPost = (): FlashBackupsPost | undefined => posted.filter((m): m is FlashBackupsPost => m.kind === 'flashBackups').at(-1);
  const readAll = async (): Promise<void> => {
    const tokens = settingsReadGroups('tinyg-en').map((g) => g.token);
    for (let i = 0; i < tokens.length; i += 30) await call({ v: 3, kind: 'read', tokens: tokens.slice(i, i + 30) });
    await until(() => tokens.every((t) => host.session.snapshot.values[t] !== undefined) && host.session.state.queue.length === 0 && host.session.state.writing === null, 60_000);
  };
  const connect = async (trusted?: unknown[]): Promise<void> => {
    expect(await call({ v: 3, kind: 'open', port: PORT, boardId: null, previousSessionEnded: false, ...(trusted === undefined ? {} : { trusted }) })).toMatchObject({ ok: true });
    await until(() => host.session.snapshot.classification !== null && host.session.snapshot.base !== 'READING' && host.session.snapshot.base !== 'IDENTIFYING', 30_000);
    await until(() => false, 3000);
  };
  return { clock, board, endpoint, host, posted, until, call, backupsPost, readAll, connect };
}

type Rig = ReturnType<typeof rig>;

async function flash(r: Rig, name: SimImageName, baseline: Record<string, number> | null, kind: 'release' | 'custom' = 'release'): Promise<void> {
  const x = await sim(name);
  const source = kind === 'release' ? { kind: 'release', hv: 99, fb: x.fb, file: x.file } : { kind: 'custom', name: x.file, confirmed: true };
  const begin = await r.call({ v: 3, kind: 'flash', command: { op: 'begin', source, hex: x.hex, sha256: x.sha256, settingsBackup: baseline === null ? 'unreadable' : 'saved', baseline, recovery: false } });
  expect(begin).toMatchObject({ ok: true });
  expect(await r.until(() => r.backupsPost() !== undefined)).toBe(true);
  const b = r.backupsPost() as FlashBackupsPost;
  // Nothing was written before the page stored the backups.
  expect(r.board.xboot.pageWrites).toEqual([]);
  expect(b.backups.eeprom.length).toBe(0x800);
  expect(b.backups.hex.startsWith(':')).toBe(true);
  expect(await r.call({ v: 3, kind: 'flash', command: { op: 'backupsSaved', sha256: b.backups.sha256 } })).toMatchObject({ ok: true });
  expect(await r.until(() => r.host.flash.view?.phase === 'done' || r.host.flash.view?.phase === 'failed')).toBe(true);
}

describe('the firmware update in the worker', () => {
  it('updates across an EEPROM layout change, then locks jobs, jog and writes until the restore and the switch check', async () => {
    const r = rig();
    await r.connect();
    expect(r.host.session.snapshot.identity?.fb).toBe(450.01);
    await r.readAll();
    // A second flash while one runs is refused; so are Connect and Disconnect.
    await flash(r, 'newLayout', { st: 1, zsn: 1 });
    const view = r.host.flash.view;
    expect(view).toMatchObject({ phase: 'done', wrote: true, versionCheck: { expected: 451, reported: 451, ok: true } });
    expect(r.board.xboot.eraseCount).toBe(0);
    expect(r.board.build?.fb).toBe(451);
    expect(r.host.session.snapshot.identity?.fb).toBe(451);
    expect(r.host.flash.postFlash).toMatchObject({ phase: 'awaitingRead', boardId: 'SIM-EN-0001' });
    // Locked: a jog and a settings write the restore does not need are refused by the worker.
    expect(await r.call({ v: 3, kind: 'motion', command: { op: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 600 } })).toMatchObject({ ok: false, code: 'denied' });
    await r.readAll();
    expect(await r.call({ v: 3, kind: 'flash', command: { op: 'compare' } })).toMatchObject({ ok: true });
    const post = r.host.flash.postFlash;
    expect(post?.phase).toBe('restoreRequired');
    expect(post?.differences.map((d) => d.key).sort()).toEqual(['st', 'zsn']);
    expect(post?.switchesChanged).toBe(true);
    expect(await r.call({ v: 3, kind: 'settingWrite', key: 'xvm', value: 1234 })).toMatchObject({ ok: false, code: 'denied' });
    expect(await r.call({ v: 3, kind: 'settingWrite', key: 'st', value: 0 })).toMatchObject({ ok: false, code: 'denied' });
    // The restore: only the backup's values.
    // The board reset: the position is untrusted (UNKNOWN) until the user confirms the machine; that moves nothing.
    expect(await r.call({ v: 3, kind: 'motion', command: { op: 'positionVerify' } })).toMatchObject({ ok: true });
    for (const [key, value] of [['st', 1], ['zsn', 1]] as const) {
      const w = await r.call({ v: 3, kind: 'settingWrite', key, value });
      expect(w, key).toMatchObject({ ok: true });
      await r.until(() => r.host.session.snapshot.settingWrite?.phase === 'done', 30_000);
      expect(r.host.session.snapshot.settingWrite?.outcome, key).toBe('verified');
    }
    await r.readAll();
    await r.call({ v: 3, kind: 'flash', command: { op: 'compare' } });
    expect(r.host.flash.postFlash?.phase).toBe('switchCheck');
    expect(r.host.flash.postFlash?.inputs.map((i) => i.input)).toEqual([5]);
    expect(await r.call({ v: 3, kind: 'motion', command: { op: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 600 } })).toMatchObject({ ok: false, message: 'Check your limit switches. The update changed the switch settings.' });
    expect(await r.call({ v: 3, kind: 'flash', command: { op: 'switchCheckDone' } })).toMatchObject({ ok: false });
    // The user presses and releases Z min: the worker's own reads see it closed and open.
    r.board.setInput(5, true);
    await r.call({ v: 3, kind: 'read', tokens: ['in'] });
    await r.until(() => false, 300);
    r.board.setInput(5, false);
    await r.call({ v: 3, kind: 'read', tokens: ['in'] });
    await r.until(() => false, 300);
    expect(r.host.flash.postFlash?.inputs[0]).toMatchObject({ seenOpen: true, seenClosed: true });
    expect(await r.call({ v: 3, kind: 'flash', command: { op: 'switchCheckDone' } })).toMatchObject({ ok: true });
    expect(r.host.flash.postFlash?.phase).toBe('clear');
    expect(r.host.flash.lockReason('motion')).toBeNull();
    const snap = r.posted.filter((m): m is SnapshotMessage => m.kind === 'snapshot').at(-1);
    expect(snap?.flasher).toBe(true);
    expect(snap?.simulated).toBe(true);
  }, 120_000);

  it('refuses a second flash, Connect and Disconnect while one runs; cancel before writing leaves the board untouched', async () => {
    const r = rig();
    await r.connect();
    const x = await sim('update');
    const begin = { v: 3, kind: 'flash', command: { op: 'begin', source: { kind: 'release', hv: 99, fb: x.fb, file: x.file }, hex: x.hex, sha256: x.sha256, settingsBackup: 'saved', baseline: { st: 1 }, recovery: false } };
    expect(await r.call(begin)).toMatchObject({ ok: true });
    expect(await r.call(begin)).toMatchObject({ ok: false, message: 'A firmware update is already running.' });
    expect(await r.call({ v: 3, kind: 'close' })).toMatchObject({ ok: false });
    expect(await r.call({ v: 3, kind: 'open', port: PORT, boardId: null, previousSessionEnded: false })).toMatchObject({ ok: false });
    await r.until(() => r.backupsPost() !== undefined);
    expect(await r.call({ v: 3, kind: 'flash', command: { op: 'backupsSaved', sha256: 'f'.repeat(64) } })).toMatchObject({ ok: false });
    await r.until(() => r.host.flash.view?.phase === 'failed');
    expect(r.host.flash.view).toMatchObject({ phase: 'failed', wrote: false });
    expect(r.board.xboot.pageWrites).toEqual([]);
    await r.until(() => false, 1000);
    expect(r.board.state).toBe('app');
    expect(r.board.build?.fb).toBe(450.01);
  }, 60_000);

  it('refuses a release for other hardware, a hash that differs, and a firmware backup of another board', async () => {
    const r = rig();
    await r.connect();
    const x = await sim('update');
    const begin = (source: unknown, sha256 = x.sha256) => r.call({ v: 3, kind: 'flash', command: { op: 'begin', source, hex: x.hex, sha256, settingsBackup: 'saved', baseline: null, recovery: false } });
    expect(await begin({ kind: 'release', hv: 8, fb: x.fb, file: x.file })).toMatchObject({ ok: false });
    expect(await begin({ kind: 'release', hv: 99, fb: x.fb, file: x.file }, 'a'.repeat(64))).toMatchObject({ ok: false });
    expect(await begin({ kind: 'backup', boardId: 'ANOTHER', fb: 450.01 })).toMatchObject({ ok: false, message: expect.stringContaining('another board') });
    expect(await begin({ kind: 'custom', name: 'x.hex', confirmed: false })).toMatchObject({ ok: false });
    expect(r.board.state).toBe('app');
  }, 60_000);

  it('the old-firmware gate: below the minimum, identified and readable, but jog, jobs and settings writes are refused', async () => {
    const r = rig({ minimumFb: 450.02 });
    await r.connect();
    const snap = r.posted.filter((m): m is SnapshotMessage => m.kind === 'snapshot').at(-1);
    expect(snap?.oldFirmware).toEqual({ fb: 450.01, minimumFb: 450.02 });
    expect(await r.call({ v: 3, kind: 'motion', command: { op: 'jog', axes: { x: 1 }, distanceMm: 1, feed: 600 } })).toMatchObject({ ok: false, message: expect.stringContaining('older than the minimum') });
    expect(await r.call({ v: 3, kind: 'settingWrite', key: 'xvm', value: 1000 })).toMatchObject({ ok: false });
    expect(await r.call({ v: 3, kind: 'job', command: { op: 'load', name: 'a.nc', text: 'G0 X1\n', c22: false } })).toMatchObject({ ok: false });
    expect(await r.call({ v: 3, kind: 'read', tokens: ['xvm'] })).toMatchObject({ ok: true });
    await r.readAll();
    // An update clears it.
    await flash(r, 'update', { st: 1 });
    expect(r.host.session.snapshot.identity?.fb).toBe(450.02);
    const after = r.posted.filter((m): m is SnapshotMessage => m.kind === 'snapshot').at(-1);
    expect(after?.oldFirmware).toBeNull();
  }, 120_000);

  it('recovery: USB pulled mid-flash leaves no application; replugged in the countdown, the same image is flashed', async () => {
    const r = rig();
    await r.connect();
    const x = await sim('update');
    await r.call({ v: 3, kind: 'flash', command: { op: 'begin', source: { kind: 'release', hv: 99, fb: x.fb, file: x.file }, hex: x.hex, sha256: x.sha256, settingsBackup: 'saved', baseline: { st: 1 }, recovery: false } });
    await r.until(() => r.backupsPost() !== undefined);
    await r.call({ v: 3, kind: 'flash', command: { op: 'backupsSaved', sha256: (r.backupsPost() as FlashBackupsPost).backups.sha256 } });
    await r.until(() => r.board.xboot.pageWrites.length >= 20);
    r.endpoint.disconnect('USB pulled');
    await r.until(() => r.host.flash.view?.phase === 'failed');
    expect(r.host.flash.view).toMatchObject({ phase: 'failed', wrote: true, recoveryOffered: true });
    await r.until(() => false, 20_000);
    expect(r.board.state).toBe('bootloader');
    expect(r.board.build).toBeNull();
    expect(await r.call({ v: 3, kind: 'flash', command: { op: 'recover' } })).toMatchObject({ ok: true });
    await r.until(() => r.host.flash.view?.countdown !== null && r.host.flash.view?.countdown !== undefined);
    expect(r.host.flash.view?.phase).toBe('recovery');
    r.endpoint.reconnect();
    r.board.powerCycle();
    const firstId = (r.backupsPost() as FlashBackupsPost).backups.id;
    await r.until(() => r.backupsPost()?.backups.id !== firstId);
    await r.call({ v: 3, kind: 'flash', command: { op: 'backupsSaved', sha256: (r.backupsPost() as FlashBackupsPost).backups.sha256 } });
    await r.until(() => r.host.flash.view?.phase === 'done' || r.host.flash.view?.phase === 'failed');
    expect(r.host.flash.view?.message ?? r.host.flash.view?.phase).toBe('done');
    expect(r.board.build?.fb).toBe(450.02);
    expect(r.board.xboot.eraseCount).toBe(0);
  }, 180_000);

  it('custom firmware: read-only afterwards; trusted on its board it is approved, never on another board', async () => {
    const r = rig();
    await r.connect();
    await flash(r, 'custom', { st: 1 }, 'custom');
    expect(r.host.session.snapshot.identity?.fb).toBe(450.9);
    expect(r.host.session.snapshot.overlays).toContain('READ_ONLY');
    const installed = r.host.flash.installed('SIM-EN-0001');
    expect(installed?.sha256).toBe((await sim('custom')).sha256);
    expect(await r.call({ v: 3, kind: 'close' })).toMatchObject({ ok: true });
    const trust = { boardId: 'SIM-EN-0001', sha256: installed?.sha256, dialect: 'tinyg-en', fb: 450.9, fbs: null, name: SIM_IMAGES.custom.file };
    await r.connect([trust]);
    expect(r.host.session.snapshot.classification).toMatchObject({ mode: 'full', approvalSource: 'trusted' });
    expect(r.host.session.snapshot.overlays).not.toContain('READ_ONLY');
    expect(await r.call({ v: 3, kind: 'close' })).toMatchObject({ ok: true });
    // A fresh start of the board (its RAM heartbeat off), so the next link starts at a line boundary.
    r.board.powerCycle();
    await r.until(() => r.board.state === 'app', 10_000);
    await r.until(() => false, 1000);
    await r.connect([{ ...trust, boardId: 'ANOTHER-BOARD' }]);
    expect(r.host.session.snapshot.overlays).toContain('READ_ONLY');
  }, 120_000);
});

describe('approvals beyond the manifest', () => {
  it('a trusted build is strict, one board only, and nothing is added off staging or without the flasher', async () => {
    expect(parseTrustedBuild({ boardId: 'a', sha256: 'a'.repeat(64), dialect: 'tinyg-en', fb: 450.9, fbs: null, name: 'x.hex' })).not.toBeNull();
    for (const bad of [null, [], { boardId: '', sha256: 'a'.repeat(64), dialect: 'tinyg-en', fb: 1, fbs: null, name: 'x' }, { boardId: 'a', sha256: 'A'.repeat(64), dialect: 'tinyg-en', fb: 1, fbs: null, name: 'x' }, { boardId: 'a', sha256: 'a'.repeat(64), dialect: 'g2core-edge', fb: 1, fbs: null, name: 'x' }, { boardId: 'a', sha256: 'a'.repeat(64), dialect: 'tinyg-en', fb: 1, fbs: null, name: 'x', extra: 1 }]) {
      expect(parseTrustedBuild(bad)).toBeNull();
    }
    const releases = await releaseList(450.01);
    const base = { environment: 'staging' as const, builds: [] };
    const trusted = [{ boardId: 'B1', sha256: 'a'.repeat(64), dialect: 'tinyg-en' as const, fb: 450.9, fbs: null, name: 'x' }];
    const on = extraApprovals(base, { flasher: true, releases, simulated: true, trusted });
    expect(on.builds.filter((b) => b.source === 'release-list').every((b) => b.hv === 99)).toBe(true);
    expect(on.builds.find((b) => b.source === 'trusted')).toMatchObject({ boardId: 'B1', fb: 450.9 });
    expect(extraApprovals(base, { flasher: true, releases, simulated: false, trusted: [] }).builds).toEqual([]);
    expect(extraApprovals(base, { flasher: false, releases, simulated: true, trusted })).toBe(base);
    const prod = { environment: 'production' as const, builds: [] };
    expect(extraApprovals(prod, { flasher: true, releases, simulated: true, trusted })).toBe(prod);
  });
});
