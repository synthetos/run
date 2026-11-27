/**
 * Recovery ("Try the update again") on a marked board (owner report 2026-11-21, TinyG v8 3Y2462-WWR at 449.01).
 * Recovery looks at the port first: a firmware that answers the one line end runs, so the update goes in the normal
 * way ({"boot":1}) after the session read the board id; only a silent board gets the countdown, which sends ESC and S
 * all the time (xboot's short window after a Reset is caught whenever it comes) and which Cancel and Disconnect end.
 */
import { describe, expect, it } from 'vitest';
import type { PortSelector, TransportSource } from '@synthetos/machine';
import { sha256Hex } from '@synthetos/flasher';
import type { FirmwareReleases } from '@synthetos/protocol';
import { MockSerialPort, FlashableBoard, SIM_IMAGES, SimEndpoint, VirtualClock, simHex, simImage, type FlashableBoardOptions } from '@synthetos/testkit';
import { memoryBootloaderMarks } from '../src/machine-worker/bootloaderMark.ts';
import { MachineWorkerHost } from '../src/machine-worker/host.ts';
import { releaseFor } from '../src/machine-worker/motionFlag.ts';
import type { FlashBackupsPost, MachineReply, SnapshotMessage } from '../src/machine-worker/rpc.ts';
import { WebSerialTransport } from '@synthetos/machine/web-serial-transport';
import { SimTransport } from './simTransport.ts';

const PORT: PortSelector = Object.freeze({ usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 });
const ORIGIN = 'http://localhost:4173';
const RECOVER = { v: 3, kind: 'flash', command: { op: 'recover' } };

async function update() {
  const hex = simHex(simImage('update'));
  return { hex, sha256: await sha256Hex(hex), file: SIM_IMAGES.update.file, fb: SIM_IMAGES.update.build.fb, size: new TextEncoder().encode(hex).length };
}

async function releases(): Promise<FirmwareReleases> {
  const x = await update();
  return { env: 'staging', issuedMs: 0, expiresMs: Number.MAX_SAFE_INTEGER, boards: [{ hv: 99, minimumFb: 450.01, releases: [{ hv: 99, fb: x.fb, fv: 0.97, dialect: 'tinyg-en', part: 'x192a3', file: x.file, sha256: x.sha256, size: x.size, date: '2026-11-03', changelog: 'test', recommended: true, simulatorOnly: true, repo: null, tag: null }] }] };
}

function rig(board: FlashableBoardOptions = {}, webSerial = false) {
  const clock = new VirtualClock();
  const device = new FlashableBoard({ model: { bootMs: 50, eepromWriteMs: 0 }, linkBaud: 2_000_000, eeprom: { __layout: 10002, st: 1 }, ...board });
  const endpoint = new SimEndpoint({ clock, device, link: { baudRate: 2_000_000, latencyMs: 0.2, coalesceMs: 2 } });
  const serialPort = new MockSerialPort(endpoint);
  const source: TransportSource = { kind: 'fake', request: async () => (endpoint.connected ? webSerial ? new WebSerialTransport(serialPort, { wait: (ms) => new Promise<void>((resolve) => clock.setTimeout(resolve, ms)) }) : new SimTransport(endpoint, clock, { open: 0, most: 0 }, 0) : null) };
  const marks = memoryBootloaderMarks();
  const host = new MachineWorkerHost(source, clock, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130' }, {
    file: null, origin: ORIGIN,
    verify: async () => ({ approved: { environment: 'staging', builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 't' }] }, channels: [] }),
    releases,
  }, releaseFor(ORIGIN), marks);
  const posted: (SnapshotMessage | FlashBackupsPost)[] = [];
  void host.handle({ v: 3, kind: 'subscribe' }, { postMessage: (m) => posted.push(m) });
  const until = async (done: () => boolean, maxMs = 300_000): Promise<boolean> => {
    const end = clock.now() + maxMs;
    let idle = 0;
    while (!done() && clock.now() < end) {
      for (let k = 0; k < 30; k++) await Promise.resolve();
      if (done()) break;
      const next = clock.nextAt();
      if (next !== undefined && next <= end) {
        idle = 0;
        // Real time too, so WebCrypto (the backup's SHA-256) keeps up with the virtual clock.
        await new Promise((r) => setImmediate(r));
        clock.advanceTo(next);
        continue;
      }
      // Nothing due on the virtual clock: real work may be pending (WebCrypto). Give it real time, then move on.
      await new Promise((r) => setTimeout(r, 1));
      if (++idle > 2000) clock.advanceTo(end);
    }
    for (let k = 0; k < 30; k++) await Promise.resolve();
    return done();
  };
  const call = async (request: unknown): Promise<MachineReply> => {
    let reply: MachineReply | undefined;
    void host.handle(request).then((r) => (reply = r));
    await until(() => reply !== undefined);
    return reply as MachineReply;
  };
  const backups = (): FlashBackupsPost | undefined => posted.filter((m): m is FlashBackupsPost => m.kind === 'flashBackups').at(-1);
  /** Stores each run's backups as the page does, once posted. */
  const saveBackups = async (after: number | undefined): Promise<void> => {
    const posted = await until(() => (backups() !== undefined && backups()?.backups.id !== after) || host.flash.view?.phase === 'failed');
    expect(posted && host.flash.view?.phase !== 'failed', JSON.stringify(host.flash.view)).toBe(true);
    expect(await call({ v: 3, kind: 'flash', command: { op: 'backupsSaved', sha256: (backups() as FlashBackupsPost).backups.sha256 } })).toMatchObject({ ok: true });
  };
  const writes = (): string[] => (host.flash.flashTranscript()?.jsonl ?? '').trim().split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as { dir: string; hex: string }).filter((l) => l.dir === 'tx').map((l) => l.hex);
  return { clock, board: device, endpoint, marks, host, until, call, backups, saveBackups, writes };
}

type Rig = ReturnType<typeof rig>;

/** Connect, then an update whose firmware boots 40 s late: it fails, the board keeps its mark, the firmware then runs. */
async function markedRunning(r: Rig): Promise<void> {
  expect(await r.call({ v: 3, kind: 'open', port: PORT, boardId: null, previousSessionEnded: false })).toMatchObject({ ok: true });
  await r.until(() => r.host.session.snapshot.classification !== null && r.host.session.snapshot.base !== 'READING' && r.host.session.snapshot.base !== 'IDENTIFYING', 30_000);
  r.board.setBannerDelay(40_000);
  const x = await update();
  expect(await r.call({ v: 3, kind: 'flash', command: { op: 'begin', source: { kind: 'release', hv: 99, fb: x.fb, file: x.file }, hex: x.hex, sha256: x.sha256, settingsBackup: 'saved', baseline: { st: 1 }, recovery: false } })).toMatchObject({ ok: true });
  await r.saveBackups(undefined);
  expect(await r.until(() => r.host.flash.view?.phase === 'failed')).toBe(true);
  expect(await r.marks.find(PORT)).not.toBeNull();
  await r.until(() => false, 15_000);
  r.board.setBannerDelay(0);
  expect(r.board.state).toBe('app');
}

describe('recovery on a marked board', () => {
  it('the firmware runs: the line end, the session checks the id, {"boot":1}, and the same image goes on', async () => {
    const r = rig();
    await markedRunning(r);
    const first = r.backups()?.backups.id;
    const pages = r.board.xboot.pageWrites.length;
    expect(await r.call(RECOVER)).toMatchObject({ ok: true });
    await r.saveBackups(first);
    expect(await r.until(() => r.host.flash.view?.phase === 'done' || r.host.flash.view?.phase === 'failed')).toBe(true);
    expect(r.host.flash.view?.message ?? r.host.flash.view?.phase).toBe('done');
    expect(r.board.xboot.pageWrites.length).toBeGreaterThan(pages);
    expect(r.board.xboot.eraseCount).toBe(0);
    expect(r.host.session.snapshot.identity?.fb).toBe(450.02);
    expect(await r.marks.find(PORT)).toBeNull();
    // Before the board identified: ESC, S and one line end; then the bootloader entry after {"boot":1}.
    expect(r.writes().slice(0, 3)).toEqual(['1b', '53', '0a']);
    expect(r.writes().filter((w) => w === '0a')).toHaveLength(1);
  }, 120_000);

  it('another board answers: nothing is written, the mark stays, and the reply names both boards', async () => {
    const r = rig();
    await markedRunning(r);
    const mark = await r.marks.find(PORT);
    if (mark === null) throw new Error('no mark');
    const saved = mark.recovery as { begin: unknown; view: { board: Record<string, unknown> } };
    await r.marks.clear(mark);
    await r.marks.put({ ...mark, boardId: 'ANOTHER-BOARD', recovery: { ...saved, view: { ...saved.view, board: { ...saved.view.board, id: 'ANOTHER-BOARD' } } } });
    // Connect restores the mark (the firmware is frozen, so Connect only waits); Cancel ends the wait.
    r.board.applicationFrozen = true;
    const opening = r.call({ v: 3, kind: 'open', port: PORT, boardId: null, previousSessionEnded: false });
    expect(await r.until(() => r.host.flash.view?.bannerWait?.phase === 'waiting', 5_000)).toBe(true);
    expect(await r.call({ v: 3, kind: 'flash', command: { op: 'cancel' } })).toMatchObject({ ok: true });
    expect(await opening).toMatchObject({ ok: false });
    r.board.applicationFrozen = false;
    const pages = r.board.xboot.pageWrites.length;
    expect(await r.call(RECOVER)).toMatchObject({ ok: true });
    expect(await r.until(() => r.host.flash.view?.phase === 'failed')).toBe(true);
    expect(r.host.flash.view?.message).toContain('not board ANOTHER-BOARD');
    expect(r.board.xboot.pageWrites.length).toBe(pages);
    expect(await r.marks.find(PORT)).toMatchObject({ boardId: 'ANOTHER-BOARD' });
    expect(r.host.session.snapshot.base).toBe('NOT_CONNECTED');
    expect(r.writes()).toEqual(['1b', '53', '0a']);
  }, 120_000);
});

describe('Cancel during recovery’s first look (safety review 2026-11-26)', () => {
  it('the firmware answers after Cancel: no {"boot":1}, the board stays in its firmware, the mark stays', async () => {
    const r = rig();
    await markedRunning(r);
    const pages = r.board.xboot.pageWrites.length;
    void r.host.handle(RECOVER);
    expect(await r.until(() => r.host.flash.busy, 5_000)).toBe(true);
    expect(await r.call({ v: 3, kind: 'flash', command: { op: 'cancel' } })).toMatchObject({ ok: true });
    expect(await r.until(() => !r.host.flash.busy, 30_000)).toBe(true);
    expect(r.host.flash.view?.message).toContain('Recovery was cancelled');
    expect(r.board.state).toBe('app');
    expect(r.board.xboot.pageWrites.length).toBe(pages);
    expect(await r.marks.find(PORT)).not.toBeNull();
    expect(r.host.session.snapshot.base).toBe('NOT_CONNECTED');
  }, 120_000);
});

describe('the recovery countdown on a silent board', () => {
  async function counting(r: Rig): Promise<void> {
    await markedRunning(r);
    r.board.applicationFrozen = true;
    expect(await r.call(RECOVER)).toMatchObject({ ok: true });
    expect(await r.until(() => typeof r.host.flash.view?.countdown === 'number', 10_000)).toBe(true);
  }

  it('Cancel ends the wait at once: the port is free, the mark stays, nothing was written', async () => {
    const r = rig();
    await counting(r);
    const pages = r.board.xboot.pageWrites.length;
    const started = r.clock.now();
    expect(await r.call({ v: 3, kind: 'flash', command: { op: 'cancel' } })).toMatchObject({ ok: true });
    expect(await r.until(() => !r.host.flash.busy, 3_000)).toBe(true);
    expect(r.clock.now() - started).toBeLessThan(3_000);
    expect(r.host.flash.view?.message).toContain('Recovery was cancelled');
    expect(r.board.xboot.pageWrites.length).toBe(pages);
    expect(await r.marks.find(PORT)).not.toBeNull();
    expect(r.writes().filter((w) => w !== '1b' && w !== '53')).toEqual(['0a']);
  }, 120_000);

  it('Disconnect ends the wait too and is not refused', async () => {
    const r = rig();
    await counting(r);
    const started = r.clock.now();
    const closed = await r.call({ v: 3, kind: 'close' });
    expect(closed, JSON.stringify(closed)).toMatchObject({ ok: true });
    expect(r.clock.now() - started).toBeLessThan(3_000);
    expect(r.host.flash.busy).toBe(false);
    expect(await r.marks.find(PORT)).not.toBeNull();
  }, 120_000);

  it('a Reset at any moment is caught: xboot’s 3 s window 17 s into the wait', async () => {
    const r = rig({ xboot: { windowMs: 3000 } });
    await counting(r);
    const first = r.backups()?.backups.id;
    r.clock.setTimeout(() => r.board.resetBoard(), 17_300);
    await r.saveBackups(first);
    expect(await r.until(() => r.host.flash.view?.phase === 'done' || r.host.flash.view?.phase === 'failed')).toBe(true);
    expect(r.host.flash.view?.message ?? r.host.flash.view?.phase).toBe('done');
    expect(r.board.build?.fb).toBe(450.02);
    expect(r.board.xboot.eraseCount).toBe(0);
  }, 120_000);
});


describe('hardened bootloader through Web Serial', () => {
  it('connects, boots automatically, saves backups, arms, verifies and reconnects without reset', async () => {
    const r = rig({ xboot: { hardened: true } }, true);
    expect(await r.call({ v: 3, kind: 'open', port: PORT, boardId: null, previousSessionEnded: false })).toMatchObject({ ok: true });
    expect(await r.until(() => r.host.session.snapshot.classification !== null && r.host.session.snapshot.base !== 'READING' && r.host.session.snapshot.base !== 'IDENTIFYING', 30_000)).toBe(true);
    const x = await update();
    expect(await r.call({ v: 3, kind: 'flash', command: { op: 'begin', source: { kind: 'release', hv: 99, fb: x.fb, file: x.file }, hex: x.hex, sha256: x.sha256, settingsBackup: 'saved', baseline: { st: 1 }, recovery: false } })).toMatchObject({ ok: true });
    await r.saveBackups(undefined);
    expect(await r.until(() => r.host.flash.view?.phase === 'done' || r.host.flash.view?.phase === 'failed')).toBe(true);
    expect(r.host.flash.view?.message ?? r.host.flash.view?.phase).toBe('done');
    expect(r.host.session.snapshot.identity?.fb).toBe(450.02);
    expect(r.board.xboot.eraseCount).toBe(0);
    expect(await r.marks.find(PORT)).toBeNull();
    const metadata = JSON.parse(r.host.flash.flashTranscript()?.entryJson ?? '{}') as Record<string, unknown>;
    expect(metadata).toMatchObject({ recovery: false, viaBoot: true, omittedLinks: 0, links: [{ portOpen: true, readerStarted: true, transport: { readerAcquired: true } }] });
    expect(r.writes().filter((w) => w === '547b').length).toBeGreaterThan(0);
  }, 120_000);
});
