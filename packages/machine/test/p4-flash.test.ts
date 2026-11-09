/**
 * The firmware update on the machine path (SAFETY §4.8 as amended 2026-11-03,
 * H79-H84, T-S121, T-S124):
 * - the session's `flash` intent: the flasher release only, a TinyG dialect,
 *   the idle gate (polled stat, hold, vel, qr), then exactly `{"boot":1}`,
 *   then the link closes and the session is NOT_CONNECTED with the port noted;
 * - the write gate's `boot` kind;
 * - the bootloader-role open needs the flasher's capability;
 * - `BootloaderLink`: the frame guard in front of every write, never `e`;
 * - end to end on the test kit's flashable board: connect, enter the
 *   bootloader through the session, open the SAME port in bootloader role,
 *   flash, exit, reconnect and read the new build.
 */
import { describe, expect, it } from 'vitest';
import type { ApprovedBuilds } from '@synthetos/protocol';
import { PHASE_1_RELEASE, PHASE_2_RELEASE, withFlasher, withSettingsWrites } from '@synthetos/safety';
import { X192A3, XbootClient, authorizeFlash, parseIntelHex, planFlash, runFlash, sha256Hex, type BootloaderCapability } from '@synthetos/flasher';
import { mintBootloaderCapability } from '../../flasher/src/bootloaderCapability.ts';
import { FlashableBoard, SimEndpoint, VirtualClock, simHex, simImage } from '@synthetos/testkit';
import { BOOT_LINE, BootloaderLink, EventLog, MachineSession, bootloaderOpenOptions, toHex, checkWrite, decideOpen, initialState, phase1WriteVerdict, type SessionEffect } from '../src/index.ts';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';
import { FakeTransport, enc, flush } from './fakeTransport.ts';
import { PORT, SimTransport, microtasks, simSource } from './simTransport.ts';

const EN_APPROVED: ApprovedBuilds = { environment: 'staging', builds: [{ channel: 'bench', dialect: 'tinyg-en', fb: 450.01, fbs: null, commit: 'e'.repeat(40), note: 't' }] };
const FLASH = withFlasher(withSettingsWrites(PHASE_2_RELEASE, 'staging'), 'staging');

function ready(release = FLASH, manifest: ApprovedBuilds | null = EN_APPROVED): Driver {
  const d = new Driver({ release, ...(manifest === null ? {} : { manifest }) });
  d.open();
  d.answer(EN_ANSWERS, (t) => t === 'boot');
  return d;
}

const lines = (effects: readonly SessionEffect[]) => effects.filter((e) => e.kind === 'writeLine') as Extract<SessionEffect, { kind: 'writeLine' }>[];
const GATE = { stat: '{"r":{"stat":1},"f":[3,0,10]}', hold: '{"r":{"hold":0},"f":[3,0,10]}', vel: '{"r":{"vel":0.00},"f":[3,0,10]}', qr: '{"r":{"qr":32},"f":[3,0,10]}' };

describe('the session enters the bootloader only through `flash`', () => {
  it('is denied without the flasher release', () => {
    const d = ready(withSettingsWrites(PHASE_2_RELEASE, 'staging'));
    expect(d.intent({ intent: 'flash' })).toMatchObject({ allowed: false, reason: 'Not available in this release.' });
    expect(d.lines()).not.toContain(BOOT_LINE);
  });

  it('idle gate, then exactly {"boot":1}; once written, the link closes and the session is NOT_CONNECTED with the port noted', () => {
    const d = ready();
    const base = d.state.base;
    expect(['IDLE_UNHOMED', 'IDLE_HOMED', 'CONNECTED_UNKNOWN']).toContain(base);
    expect(d.intent({ intent: 'flash' })).toEqual({ allowed: true });
    expect(d.state.bootEntry).toMatchObject({ phase: 'gate' });
    expect(d.answer(GATE, (t) => t === 'boot')).toEqual(['stat', 'hold', 'vel', 'qr']);
    expect(d.state.bootEntry).toMatchObject({ phase: 'writing', gate: { stat: 1, hold: 0, vel: 0, qr: 32 } });
    const w = lines(d.last).at(-1);
    expect(w).toMatchObject({ line: BOOT_LINE, intent: 'flash' });
    d.at = 1234;
    const effects = d.feed({ type: 'lineWritten', epoch: d.state.epoch, seq: d.state.writing?.seq ?? -1, at: 1234 });
    expect(effects.some((e) => e.kind === 'close')).toBe(true);
    expect(d.state.base).toBe('NOT_CONNECTED');
    expect(d.state.notices.bootloaderEntered).toEqual({ at: 1234, port: PORT, boardId: 'EN-1' });
    expect(d.state.unknownOnNextConnect).toBe(true);
    expect(d.state.bootEntry).toBeNull();
  });

  it('a READ_ONLY (unapproved) TinyG may enter: the old-firmware gate opens the Update panel', () => {
    const d = ready(FLASH, null);
    expect(d.state.overlays).toContain('READ_ONLY');
    expect(d.intent({ intent: 'flash' }).allowed).toBe(true);
  });

  it('refuses a board that is moving or has moves queued, and says why; nothing is written', () => {
    const d = ready();
    d.intent({ intent: 'flash' });
    d.answer({ ...GATE, vel: '{"r":{"vel":12.5},"f":[3,0,10]}' }, (t) => t === 'boot');
    expect(d.state.bootEntry).toBeNull();
    expect(d.state.notices.bootRefused).toContain('moving');
    expect(d.state.notices.bootRefused).not.toContain('Not written');
    expect(d.lines()).not.toContain(BOOT_LINE);
    // A new request clears the old refusal.
    d.intent({ intent: 'flash' });
    expect(d.state.notices.bootRefused).toBeUndefined();
  });

  it('refuses when a gate read fails, arrives damaged or is not answered in time', () => {
    const bad = ready();
    bad.intent({ intent: 'flash' });
    bad.answer({ ...GATE, stat: '{"r":{},"f":[3,100,10]}' }, (t) => t === 'boot');
    expect(bad.state.notices.bootRefused).toContain('did not answer the stat read');
    const damaged = ready();
    damaged.intent({ intent: 'flash' });
    damaged.written();
    damaged.line('{"r":{"stat":1},"f":[3,0,10,999]}');
    expect(damaged.state.notices.bootRefused ?? '').toMatch(/damaged|did not answer/);
    const silent = ready();
    silent.intent({ intent: 'flash' });
    silent.written();
    silent.fire('answer');
    expect(silent.state.notices.bootRefused).toContain('in time');
  });

  it('a refusal keeps the reads queued meanwhile; a board with no id is noted with none; a trusted build classifies as such', () => {
    const d = ready();
    d.intent({ intent: 'flash' });
    d.intent({ intent: 'read', tokens: ['xvm'] });
    d.answer({ ...GATE, stat: '{"r":{"stat":5},"f":[3,0,10]}', xvm: '{"r":{"xvm":1},"f":[3,0,10]}' }, (t) => t === 'boot' || t === 'xvm');
    expect(d.state.notices.bootRefused).toContain('not idle');
    expect([...d.state.queue.map((q) => q.token), d.writing]).toContain('xvm');
    const noId = ready();
    noId.intent({ intent: 'flash' });
    noId.answer(GATE, (t) => t === 'boot');
    const { id: _id, ...identity } = noId.state.identity ?? {};
    noId.state = { ...noId.state, identity };
    noId.written();
    expect(noId.state.notices.bootloaderEntered?.boardId).toBeNull();
    const trusted = ready(FLASH, { environment: 'staging', builds: [{ ...EN_APPROVED.builds[0]!, source: 'trusted', boardId: 'EN-1', imageSha256: 'a'.repeat(64) }] });
    expect(trusted.state.classification).toMatchObject({ mode: 'full', approvalSource: 'trusted' });
  });

  it('is refused during a settings write', () => {
    const d = ready();
    d.intent({ intent: 'settingsWrite', key: 'xvm', value: 1234 });
    expect(d.intent({ intent: 'flash' })).toMatchObject({ allowed: false, reason: 'Something else is in progress: a move, a job or a settings write.' });
  });

  it('is cut off by a lost link; a second request while one is in progress, a move, a job or an unclassified board are refused', () => {
    const d = ready();
    d.intent({ intent: 'flash' });
    expect(d.intent({ intent: 'flash' })).toMatchObject({ allowed: false });
    d.feed({ type: 'linkLost', epoch: d.state.epoch, at: 5 });
    expect(d.state.notices.bootRefused).toContain('connection was lost');
    const unclassified = new Driver({ release: FLASH });
    unclassified.open();
    unclassified.answer({ ...EN_ANSWERS, fv: '{"r":{"fv":0.5},"f":[3,0,10]}' });
    expect(unclassified.intent({ intent: 'flash' })).toMatchObject({ allowed: false });
  });

  it('never accepts {"boot":1} as a settings write or a GET; the write gate admits it only while the entry writes it', () => {
    const ctx = { readable: () => true, enqAllowed: false };
    expect(phase1WriteVerdict(enc(`${BOOT_LINE}\n`), ctx)).toMatchObject({ ok: false });
    expect(phase1WriteVerdict(enc(`${BOOT_LINE}\n`), { ...ctx, bootWritable: () => false })).toMatchObject({ ok: false });
    expect(phase1WriteVerdict(enc(`${BOOT_LINE}\n`), { ...ctx, bootWritable: () => true, settingWritable: () => true })).toEqual({ ok: true, kind: 'boot' });
    const d = ready();
    const s = d.state;
    expect(checkWrite(s, s, FLASH, enc(`${BOOT_LINE}\n`), 'flash')).toMatchObject({ kind: 'refused' });
    expect(checkWrite(s, s, FLASH, enc('{"stat":null}\n'), 'flash')).toMatchObject({ kind: 'refused' });
    expect(checkWrite(initialState(), initialState(), FLASH, enc(`${BOOT_LINE}\n`), 'flash')).toMatchObject({ kind: 'denied' });
    expect(checkWrite(s, s, PHASE_1_RELEASE, enc(`${BOOT_LINE}\n`), 'read')).toMatchObject({ kind: 'refused' });
  });
});

describe('the bootloader-role open', () => {
  const info = { kind: 'serial' as const, usbVendorId: 0x0403, usbProductId: 0x6015 };
  it('needs the capability, at the bootloader rate; the Due programming port is refused even with one', () => {
    const options = bootloaderOpenOptions(X192A3);
    expect(options).toEqual({ baudRate: 115200, flowControl: 'none', bufferSize: 256 });
    expect(decideOpen(info, options, false, 'bootloader')).toMatchObject({ ok: false, reason: 'capability-required', detail: 'a bootloader-role open needs the flasher\'s bootloader capability' });
    expect(decideOpen(info, options, true, 'bootloader')).toEqual({ ok: true });
    expect(decideOpen(info, options, true)).toMatchObject({ ok: false, reason: 'unexpected-capability' });
    expect(decideOpen({ kind: 'serial', usbVendorId: 0x2341, usbProductId: 0x003d }, options, true, 'bootloader')).toMatchObject({ ok: false, reason: 'refused-port' });
    expect(decideOpen(info, { ...options, baudRate: 9600 }, true, 'bootloader')).toMatchObject({ ok: false, reason: 'baud-rate' });
  });
});

/** A fake whose read stream stays open (FakeTransport's ends at once, which is a dropped link). */
class OpenFake extends FakeTransport {
  override readonly readable: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<Uint8Array>>(() => undefined) }) };
}

const clock = { now: () => 0, setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number, clearTimeout: (id: number) => clearTimeout(id) };

describe('BootloaderLink', () => {
  it('opens only with a valid, unused capability, and only once', async () => {
    const t = new FakeTransport();
    const link = new BootloaderLink(t, clock, X192A3);
    await expect(link.open(undefined)).rejects.toThrow('capability');
    await expect(new BootloaderLink(t, clock, X192A3).open({} as BootloaderCapability)).rejects.toThrow('capability');
    const token = mintBootloaderCapability();
    const ok = new BootloaderLink(t, clock, X192A3);
    await ok.open(token);
    expect(t.calls.filter((c) => c.op === 'open')).toEqual([{ op: 'open', options: { baudRate: 115200, flowControl: 'none', bufferSize: 256 }, args: 1 }]);
    await expect(ok.open(mintBootloaderCapability())).rejects.toThrow('already opened');
    // The used token cannot open anything else.
    await expect(new BootloaderLink(t, clock, X192A3).open(token)).rejects.toThrow('capability');
    const due = new FakeTransport({ kind: 'serial', usbVendorId: 0x2341, usbProductId: 0x003d });
    await expect(new BootloaderLink(due, clock, X192A3).open(mintBootloaderCapability())).rejects.toThrow('refused-port');
    const erroring = new OpenFake();
    const e = new BootloaderLink(erroring, clock, X192A3);
    await e.open(mintBootloaderCapability());
    erroring.writeError = new Error('NetworkError');
    await expect(e.write(Uint8Array.of(0x1b))).rejects.toThrow('the write failed: NetworkError');
    const failing = new FakeTransport();
    failing.openError = new Error('busy');
    const f = new BootloaderLink(failing, clock, X192A3);
    await expect(f.open(mintBootloaderCapability())).rejects.toThrow('busy');
    expect(f.closed).toBe(true);
  });

  it('sends only frames the guard admits, one at a time; never `e`; nothing after a failed write', async () => {
    const t = new OpenFake();
    const link = new BootloaderLink(t, clock, X192A3);
    await expect(link.write(Uint8Array.of(0x1b))).rejects.toThrow('closed');
    await link.open(mintBootloaderCapability());
    await expect(link.write(Uint8Array.of(0x65))).rejects.toThrow('forbidden-opcode');
    await expect(link.write('S' as unknown as Uint8Array)).rejects.toThrow('Uint8Array');
    t.holdWrites = true;
    const a = link.write(Uint8Array.of(0x1b));
    const b = link.write(Uint8Array.of(0x53));
    await flush();
    expect(t.maxInFlight).toBe(1);
    t.failWrite('not an Error');
    await expect(a).rejects.toThrow('the write failed: not an Error');
    // The frame queued behind the failed one is never sent.
    await expect(b).rejects.toThrow('closed before the frame was sent');
    await expect(link.write(Uint8Array.of(0x53))).rejects.toThrow('nothing more');
    expect(t.written().map((w) => w.charCodeAt(0))).toEqual([0x1b]);
    expect(link.wire.map((w) => w.head)).toEqual(['1b']);
  });

  it('keeps a bounded transcript, and drops what arrives after close()', async () => {
    let push: ((chunk: Uint8Array) => void) | null = null;
    class Pushing extends OpenFake {
      override readonly readable: AsyncIterable<Uint8Array> = {
        [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<Uint8Array>>((resolve) => (push = (value) => resolve({ done: false, value }))) }),
      };
    }
    const t = new Pushing();
    const link = new BootloaderLink(t, clock, X192A3);
    await link.open(mintBootloaderCapability());
    for (let i = 0; i < 20_001; i++) await link.write(Uint8Array.of(0x1b));
    expect(link.wire.length).toBe(19_001);
    await link.close();
    (push as unknown as (c: Uint8Array) => void)(Uint8Array.of(0x58));
    await flush();
    expect(link.wire.at(-1)?.dir).toBe('tx');
  });

  it('records every frame and every chunk received, whole and timestamped, in the flash transcript', async () => {
    const clockV = new VirtualClock();
    const board = new FlashableBoard({ start: 'bootloader' });
    const endpoint = new SimEndpoint({ clock: clockV, device: board });
    const log = new EventLog(clockV.now());
    const link = new BootloaderLink(new SimTransport(endpoint), clockV, X192A3, log);
    await link.open(mintBootloaderCapability());
    clockV.advanceTo(clockV.now() + 300);
    await link.write(Uint8Array.of(0x1b));
    await link.write(Uint8Array.of(0x53));
    const reply = link.read(7, 1000);
    for (let i = 0; i < 40 && clockV.nextAt() !== undefined; i++) {
      clockV.advanceTo(clockV.nextAt() as number);
      await microtasks();
    }
    await reply;
    const events = log.events();
    expect(events.filter((e) => e.dir === 'tx').map((e) => [e.t, toHex(e.bytes)])).toEqual([
      [300, '1b'],
      [300, '53'],
    ]);
    const rx = events.filter((e) => e.dir === 'rx');
    // The answer first (the loop above runs the clock on past xboot's watchdog, so the firmware's banners follow).
    expect(new TextDecoder().decode(Uint8Array.from(rx.flatMap((e) => [...e.bytes]))).slice(0, 7)).toBe('XBoot++');
    expect((rx[0] as { t: number }).t).toBeGreaterThan(300);
    expect(log.toJsonl().split('\n')[0]).toBe('{"t":300,"dir":"tx","hex":"1b"}');
    await link.close();
  });

  it('reads exact counts from the port, ends reads on a disconnect, closes once', async () => {
    const clockV = new VirtualClock();
    const board = new FlashableBoard({ start: 'bootloader' });
    const endpoint = new SimEndpoint({ clock: clockV, device: board });
    const t = new SimTransport(endpoint);
    const link = new BootloaderLink(t, clockV, X192A3);
    await link.open(mintBootloaderCapability());
    await link.write(Uint8Array.of(0x1b));
    await link.write(Uint8Array.of(0x53));
    const reply = link.read(7, 1000);
    for (let i = 0; i < 40 && clockV.nextAt() !== undefined; i++) {
      clockV.advanceTo(clockV.nextAt() as number);
      await microtasks();
    }
    expect(new TextDecoder().decode(await reply)).toBe('XBoot++');
    link.discardInput();
    const pending = link.read(1, 100_000).catch((e: unknown) => e);
    endpoint.disconnect();
    await microtasks();
    expect(String(await pending)).toContain('dropped');
    expect(link.closed).toBe(true);
    await link.close();
    await link.close();
    class CloseFails extends OpenFake {
      override close(): Promise<void> {
        return Promise.reject(new Error('already gone'));
      }
    }
    const gone = new BootloaderLink(new CloseFails(), clockV, X192A3);
    await gone.open(mintBootloaderCapability());
    await gone.close();
    const never = new BootloaderLink(new FakeTransport(), clockV, X192A3);
    await never.close();
    expect(never.closed).toBe(true);
  });
});

describe('end to end on the flashable board: session → bootloader → flash → reconnect', () => {
  it('updates 450.01 to 450.02 over the same port, never sending `e`', async () => {
    const vclock = new VirtualClock();
    const board = new FlashableBoard({ model: { bootMs: 50 }, linkBaud: 2_000_000 });
    const endpoint = new SimEndpoint({ clock: vclock, device: board, link: { baudRate: 2_000_000, latencyMs: 0.2, coalesceMs: 2 } });
    const transports: SimTransport[] = [];
    const source = simSource(() => {
      const t = new SimTransport(endpoint);
      transports.push(t);
      return t;
    });
    const session = new MachineSession({ source, clock: vclock, release: FLASH, manifest: { environment: 'staging', builds: [{ ...EN_APPROVED.builds[0]!, fb: 450.01 }, { ...EN_APPROVED.builds[0]!, fb: 450.02 }] } });
    const run = async (ms: number): Promise<void> => {
      const end = vclock.now() + ms;
      for (;;) {
        await microtasks();
        const next = vclock.nextAt();
        if (next === undefined || next > end) break;
        vclock.advanceTo(next);
      }
      vclock.advanceTo(end);
      await microtasks();
    };
    const until = async <T>(p: Promise<T>): Promise<T> => {
      let done = false;
      let value: T | undefined;
      void p.then((v) => {
        done = true;
        value = v;
      });
      for (let i = 0; i < 2_000_000 && !done; i++) {
        await microtasks();
        if (done) break;
        const next = vclock.nextAt();
        if (next === undefined) break;
        vclock.advanceTo(next);
      }
      return value as T;
    };
    // No link yet: nothing holds the port.
    await expect(session.portReleased()).resolves.toBeUndefined();
    const connected = session.connect(PORT);
    await run(3000);
    expect((await connected).ok).toBe(true);
    await run(3000);
    expect(session.snapshot.identity?.fb).toBe(450.01);
    // Open and not closing: nothing to wait for.
    await expect(session.portReleased()).resolves.toBeUndefined();
    expect(session.request({ intent: 'flash' }).allowed).toBe(true);
    await run(500);
    expect(session.snapshot.base).toBe('NOT_CONNECTED');
    // The link closed after {"boot":1}: the flasher waits for this before it opens the port in bootloader role.
    await expect(until(session.portReleased())).resolves.toBeUndefined();
    expect(session.snapshot.notices.bootloaderEntered?.port).toEqual(PORT);
    expect(board.state).toBe('bootloader');

    const hex = simHex(simImage('update'));
    const auth = await authorizeFlash({ source: { kind: 'custom', confirmed: true, name: 'update.hex' }, hexText: hex, sha256: await sha256Hex(hex), board: { id: 'SIM-EN-0001', hv: 99, fb: 450.01 }, part: X192A3, settingsBackup: 'saved', simulatedPort: true });
    if (!auth.ok) throw new Error(auth.message);
    const inner = await source.request(PORT);
    const link = new BootloaderLink(inner!, vclock, X192A3);
    await link.open(auth.authorization.capability() ?? undefined);
    const client = new XbootClient(link, vclock, X192A3);
    const parsed = parseIntelHex(hex, X192A3);
    if (!parsed.ok) throw new Error('parse');
    const outcome = await until(runFlash(client, planFlash(parsed.image, null), { onProgress: () => undefined, backupsReady: () => Promise.resolve() }, { entryMs: 5000 }));
    expect(outcome.ok).toBe(true);
    await link.close();
    auth.authorization.finish();
    expect(auth.authorization.capability()).toBeNull();
    expect(board.xboot.eraseCount).toBe(0);
    await run(500);
    expect(board.build?.fb).toBe(450.02);
    const again = session.connect(PORT);
    await run(3000);
    expect((await again).ok).toBe(true);
    await run(3000);
    expect(session.snapshot.identity?.fb).toBe(450.02);
    expect(session.snapshot.overlays).toContain('UNKNOWN');
  }, 60_000);
});
