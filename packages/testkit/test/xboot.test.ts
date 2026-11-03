/**
 * The fake xboot and the flashable board (XB tg-xboot @ 29d08013), and the
 * flasher's xboot client and flash run against them (SAFETY H79-H84, T-S121,
 * T-S122): every command, the entry windows, the watchdog, faults (a dropped
 * byte, a timeout, a wrong signature, a failed write), an interrupted write
 * that leaves the board without an application, and recovery through the
 * reset window. Chip erase is never sent.
 */
import { describe, expect, it } from 'vitest';
import {
  ByteBuffer,
  FrameGuard,
  X192A3,
  XbootClient,
  crc16,
  parseIntelHex,
  planFlash,
  recoverEntry,
  runFlash,
  type ByteLink,
  type FlashOutcome,
  type FlashProgress,
} from '@synthetos/flasher';
import { FlashableBoard, SimEndpoint, VirtualClock, readSimBuild, simCrc16, simHex, simImage, type FlashableBoardOptions } from '../src/index.ts';

/** The host end of the simulated link as a ByteLink, with the flasher's frame guard in front, as the machine package does. */
class SimByteLink implements ByteLink {
  readonly buffer: ByteBuffer;
  readonly guard = new FrameGuard(X192A3);
  readonly frames: Uint8Array[] = [];
  closed = false;
  readonly #endpoint: SimEndpoint;
  constructor(endpoint: SimEndpoint, clock: VirtualClock) {
    this.#endpoint = endpoint;
    this.buffer = new ByteBuffer(clock);
    endpoint.onHostData((c) => this.buffer.push(c));
    endpoint.onDisconnect(() => {
      this.closed = true;
      this.buffer.end();
    });
  }
  write(frame: Uint8Array): Promise<void> {
    if (this.closed) return Promise.reject(new Error('closed'));
    const v = this.guard.check(frame);
    if (!v.ok) return Promise.reject(new Error(`guard: ${v.reason}`));
    this.frames.push(frame.slice());
    this.#endpoint.hostWrite(frame);
    return Promise.resolve();
  }
  read(n: number, timeoutMs: number): Promise<Uint8Array> {
    return this.buffer.read(n, timeoutMs);
  }
  discardInput(): void {
    this.buffer.discard();
  }
}

async function microtasks(): Promise<void> {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

/** Run `p` to completion, advancing virtual time from timer to timer. */
async function drive<T>(clock: VirtualClock, p: Promise<T>, maxMs = 900_000): Promise<T> {
  let done = false;
  let value: T | undefined;
  let error: unknown;
  let failed = false;
  p.then(
    (v) => {
      done = true;
      value = v;
    },
    (e: unknown) => {
      done = true;
      failed = true;
      error = e;
    },
  );
  const end = clock.now() + maxMs;
  for (;;) {
    await microtasks();
    if (done) break;
    const next = clock.nextAt();
    if (next === undefined || next > end) throw new Error(`stalled at ${clock.now()} ms`);
    clock.advanceTo(next);
  }
  if (failed) throw error;
  return value as T;
}

function rig(options: FlashableBoardOptions = {}) {
  const clock = new VirtualClock();
  const board = new FlashableBoard({ model: { bootMs: 50 }, linkBaud: 2_000_000, ...options });
  const endpoint = new SimEndpoint({ clock, device: board, link: { baudRate: 2_000_000, latencyMs: 0.2, coalesceMs: 2 } });
  const link = new SimByteLink(endpoint, clock);
  const client = new XbootClient(link, clock, X192A3);
  return { clock, board, endpoint, link, client };
}

/** Bytes the host wrote, as one string of printable characters (for the app's `{"boot":1}`). */
function sendLine(endpoint: SimEndpoint, line: string): void {
  endpoint.hostWrite(new TextEncoder().encode(`${line}\n`));
}

function plan(name: Parameters<typeof simImage>[0]) {
  const parsed = parseIntelHex(simHex(simImage(name)), X192A3);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.image;
}

describe('simulated firmware images', () => {
  it('carry their build; a damaged image has none; HEX round-trips through the flasher parser', () => {
    const img = simImage('update');
    expect(readSimBuild(img)).toEqual({ fb: 450.02, fv: 0.97, hv: 99, layout: 10002 });
    const broken = img.slice();
    broken[0x1000] = (broken[0x1000] as number) ^ 1;
    expect(readSimBuild(broken)).toBeNull();
    const parsed = parseIntelHex(simHex(img), X192A3);
    expect(parsed.ok && parsed.image.bytes).toEqual(img);
    expect(simCrc16(img)).toBe(crc16(img));
  });
});

describe('the fake xboot: entry windows and the watchdog', () => {
  it('{"boot":1} from the running firmware: a 60 s window that only ESC ends; S answers XBoot++', async () => {
    const { clock, board, endpoint, client } = rig();
    expect(board.state).toBe('app');
    sendLine(endpoint, '{"boot":1}');
    clock.advance(100);
    expect(board.state).toBe('bootloader');
    expect(board.xboot.mode).toBe('window');
    // Non-ESC bytes are read and ignored in the window.
    endpoint.hostWrite(new TextEncoder().encode('S!?'));
    clock.advance(30_000);
    expect(board.xboot.mode).toBe('window');
    expect(await drive(clock, client.enter(2000))).toBe(1);
    expect(board.xboot.mode).toBe('command');
  });

  it('after a power cycle: 4.8 s, then the application starts again', () => {
    const { clock, board } = rig();
    board.powerCycle();
    expect(board.state).toBe('bootloader');
    clock.advance(4700);
    expect(board.state).toBe('bootloader');
    clock.advance(200);
    expect(board.state).toBe('app');
  });

  it('the watchdog resets a board left waiting in a command (here, half an address) into the short window', async () => {
    const { clock, board, endpoint, client } = rig({ start: 'bootloader' });
    await drive(clock, client.enter(2000));
    endpoint.hostWrite(Uint8Array.of(0x48, 0x00));
    clock.advance(1100);
    expect(board.xboot.mode).toBe('window');
    expect(board.history.at(-1)).toContain('bootloader');
  });
});

describe('the fake xboot: every command, as the source answers it', () => {
  it('answers the identification and info commands', async () => {
    const { clock, client } = rig({ start: 'bootloader' });
    await drive(clock, client.enter(2000));
    expect(await drive(clock, client.identify())).toEqual({ programId: 'XBoot++', version: '17', signature: '1E 97 44', blockSize: 512 });
    const r = async (bytes: number[], n: number) => {
      const rr = rig({ start: 'bootloader' });
      await drive(rr.clock, rr.client.enter(2000));
      rr.endpoint.hostWrite(Uint8Array.from(bytes));
      return [...(await drive(rr.clock, rr.link.read(n, 500)))];
    };
    expect(await r([0x70], 1)).toEqual([0x53]); // p
    expect(await r([0x74], 2)).toEqual([123, 0]); // t
    expect(await r([0x50], 1)).toEqual([0x0d]); // P
    expect(await r([0x4c], 1)).toEqual([0x0d]); // L
    expect(await r([0x78, 0x01], 1)).toEqual([0x0d]); // x
    expect(await r([0x72], 1)).toEqual([0xff]); // r
    expect(await r([0x46], 1)).toEqual([0xff]); // F
    expect(await r([0x7a], 1)).toEqual([0x3f]); // unknown
    expect(await r([0x68, 0x5a], 1)).toEqual([0x3f]); // h, unknown section
    expect(await r([0x1b, 0x61], 1)).toEqual([0x59]); // ESC: no reply; a: Y
    expect(await r([0x41, 0x00, 0x10, 0x52], 3)).toEqual([0x0d, 0x94, 0x0c]); // A then R: a program word, high byte first
    expect(await r([0x41, 0x00, 0x00, 0x64], 2)).toEqual([0x0d, 0x7b]); // A then d: the EEPROM's first byte ('{')
  });

  it('reads flash and EEPROM in blocks, with the CRC of each section', async () => {
    const { clock, board, client } = rig({ start: 'bootloader' });
    await drive(clock, client.enter(2000));
    const flash = await drive(clock, client.readFlash(0x200, 1024));
    expect(flash).toEqual(board.memory.slice(0x200, 0x600));
    const eeprom = await drive(clock, client.readEeprom(0, 0x800));
    expect(eeprom).toEqual(board.eepromBytes);
    expect(new TextDecoder().decode(eeprom.subarray(0, 1))).toBe('{');
    expect(await drive(clock, client.crcApplication())).toBe(simCrc16(board.memory, 0, 0x30000));
  });

  it('a block read of another memory sends nothing; a read larger than its buffer resets the board', async () => {
    const { clock, board, endpoint, link, client } = rig({ start: 'bootloader' });
    await drive(clock, client.enter(2000));
    await drive(clock, client.setFlashAddress(0));
    endpoint.hostWrite(Uint8Array.of(0x67, 0x00, 0x02, 0x58));
    await expect(drive(clock, link.read(1, 200))).rejects.toThrow();
    endpoint.hostWrite(Uint8Array.of(0x67, 0x04, 0x00, 0x46));
    clock.advance(10);
    expect(board.xboot.mode).toBe('window');
  });

  it('models `e` honestly (application AND all EEPROM erased) — and the flasher can never send it', async () => {
    const { clock, board, endpoint, link, client } = rig({ start: 'bootloader' });
    await drive(clock, client.enter(2000));
    await expect(link.write(Uint8Array.of(0x65))).rejects.toThrow('guard: forbidden-opcode');
    expect(board.xboot.eraseCount).toBe(0);
    // Sent around the flasher, straight onto the wire:
    endpoint.hostWrite(Uint8Array.of(0x65));
    await drive(clock, link.read(1, 500));
    expect(board.xboot.eraseCount).toBe(1);
    expect(board.memory.subarray(0, 0x30000).every((b) => b === 0xff)).toBe(true);
    expect(board.eepromBytes.every((b) => b === 0xff)).toBe(true);
  });

  it('byte-wise writes, lock bits, EEPROM byte and block writes, and `m` refused at the boot section', async () => {
    const { clock, board, endpoint, link, client } = rig({ start: 'bootloader' });
    await drive(clock, client.enter(2000));
    /** One command at a time, each answered before the next (xboot's two-byte buffer). */
    const send = async (...commands: number[][]) => {
      const out: number[] = [];
      for (const c of commands) {
        endpoint.hostWrite(Uint8Array.from(c));
        out.push(...(await drive(clock, link.read(1, 500))));
      }
      return out;
    };
    expect(await send([0x41, 0x00, 0x00], [0x63, 0x11], [0x43, 0x22])).toEqual([0x0d, 0x0d, 0x0d]);
    expect(await send([0x41, 0x00, 0x00], [0x6d])).toEqual([0x0d, 0x0d]);
    expect(board.memory[0]).toBe(0x11);
    expect(board.memory[1]).toBe(0x22);
    expect(await send([0x48, 0x01, 0x80, 0x00], [0x6d])).toEqual([0x0d, 0x3f]);
    expect(await send([0x41, 0x00, 0x05], [0x44, 0x99])).toEqual([0x0d, 0x0d]);
    expect(board.eepromBytes[5]).toBe(0x99);
    expect(await send([0x6c, 0x00])).toEqual([0x0d]);
    expect(board.xboot.lockWrites).toBe(1);
    expect(await send([0x41, 0x00, 0x10], [0x42, 0x00, 0x02, 0x45, 0xaa, 0xbb])).toEqual([0x0d, 0x0d]);
    expect([board.eepromBytes[0x10], board.eepromBytes[0x11]]).toEqual([0xaa, 0xbb]);
    expect(await send([0x42, 0x00, 0x02, 0x58, 0x01, 0x02])).toEqual([0x3f]);
    expect(await send([0x42, 0x00, 0x02, 0x55, 0x01, 0x02])).toEqual([0x0d]);
    // A flash block load at the boot section changes nothing (and still answers).
    const before = board.memory.slice(0x30000);
    const page = Array.from({ length: 512 }, () => 0);
    expect(await send([0x48, 0x01, 0x80, 0x00], [0x42, 0x02, 0x00, 0x46, ...page])).toEqual([0x0d, 0x0d]);
    expect(board.memory.slice(0x30000)).toEqual(before);
    expect(await send([0x48, 0x00, 0x00, 0x00], [0x42, 0x00, 0x00, 0x46])).toEqual([0x0d, 0x0d]);
  });
});

describe('the flash run against the fake xboot', () => {
  async function flash(r: ReturnType<typeof rig>, name: Parameters<typeof simImage>[0], hooks: Partial<Parameters<typeof runFlash>[2]> = {}): Promise<{ outcome: FlashOutcome; progress: FlashProgress[] }> {
    const progress: FlashProgress[] = [];
    const image = plan(name);
    const outcome = await drive(
      r.clock,
      runFlash(r.client, planFlash(image, null), { onProgress: (p) => progress.push(p), backupsReady: () => Promise.resolve(), ...hooks }, { entryMs: 5000 }),
    );
    return { outcome, progress };
  }

  it('updates the board: backups first, stub page 0, pages N..1, verify, real page 0, CRC, exit; the new build starts; never `e`', async () => {
    const r = rig();
    const before = r.board.memory.slice(0, 0x30000);
    sendLine(r.endpoint, '{"boot":1}');
    r.clock.advance(50);
    let saved: { eeprom: Uint8Array; flash: Uint8Array } | null = null;
    let writesWhenSaved = -1;
    const { outcome, progress } = await flash(r, 'update', {
      backupsReady: (b) => {
        saved = b;
        writesWhenSaved = r.board.xboot.pageWrites.length;
        return Promise.resolve();
      },
    });
    expect(outcome.ok ? 'ok' : `${outcome.code}: ${outcome.message}`).toBe('ok');
    expect(writesWhenSaved).toBe(0);
    expect((saved as unknown as { flash: Uint8Array }).flash).toEqual(before);
    expect(r.board.xboot.pageWrites[0]).toBe(0);
    expect(r.board.xboot.pageWrites.at(-1)).toBe(0);
    expect(r.board.xboot.pageWrites[1]).toBe(0x2fe00);
    expect(r.board.xboot.commands).not.toContain(0x65);
    expect(r.board.xboot.eraseCount).toBe(0);
    expect(r.board.xboot.lockWrites).toBe(0);
    expect(r.board.memory.subarray(0, 0x30000)).toEqual(simImage('update'));
    expect(progress.map((p) => p.phase).filter((p, i, a) => a.indexOf(p) === i)).toEqual(['enter', 'identify', 'backup', 'saving', 'write', 'verify', 'final', 'crc', 'exit', 'done']);
    r.clock.advance(200);
    expect(r.board.state).toBe('app');
    expect(r.board.build?.fb).toBe(450.02);
  });

  it('a dropped byte during a page write: the reply times out, the run resyncs through the watchdog and finishes', async () => {
    const r = rig({ start: 'bootloader', faults: { dropRx: [3000] } });
    const { outcome } = await flash(r, 'update');
    expect(outcome).toMatchObject({ ok: true });
    if (outcome.ok) expect(outcome.resyncs).toBeGreaterThanOrEqual(1);
    expect(r.board.memory.subarray(0, 0x30000)).toEqual(simImage('update'));
  });

  it('a dropped reply byte and a swallowed command (a timeout) are retried after a resync', async () => {
    const r = rig({ start: 'bootloader', faults: { dropTx: [40], swallow: { opcode: 0x48, count: 1 } } });
    const { outcome } = await flash(r, 'update');
    expect(outcome.ok ? 'ok' : `${outcome.phase} ${outcome.code}: ${outcome.message}`).toBe('ok');
    if (outcome.ok) expect(outcome.resyncs).toBeGreaterThanOrEqual(2);
  });

  it('a wrong signature stops the run before anything is read or written', async () => {
    const r = rig({ start: 'bootloader', faults: { signature: [0x42, 0x97, 0x1e] } });
    const { outcome } = await flash(r, 'update');
    expect(outcome).toMatchObject({ ok: false, code: 'wrong-part', wrote: false });
    expect(r.board.xboot.pageWrites).toEqual([]);
  });

  it('a page written wrong is found by the read-back and written again', async () => {
    const r = rig({ start: 'bootloader', faults: { corruptPage: { byteAddress: 0x1000, count: 1 } } });
    const { outcome, progress } = await flash(r, 'update');
    expect(outcome.ok).toBe(true);
    expect(progress.some((p) => p.note?.includes('writing them again') === true)).toBe(true);
    expect(r.board.xboot.pageWrites.filter((a) => a === 0x1000).length).toBe(2);
  });

  it('a page that never verifies fails the run in verify, with the board left in the bootloader', async () => {
    const r = rig({ start: 'bootloader', faults: { corruptPage: { byteAddress: 0x1000, count: 5 } } });
    const { outcome } = await flash(r, 'update');
    expect(outcome).toMatchObject({ ok: false, code: 'verify-failed', wrote: true });
  });

  it('a refused page write ends the run; the board has no application and stays in the bootloader; recovery flashes it', async () => {
    const r = rig({ start: 'bootloader', faults: { refuseBlockLoadFrom: 20 } });
    const { outcome } = await flash(r, 'update');
    expect(outcome).toMatchObject({ ok: false, code: 'refused', wrote: true });
    // Page 0 holds the stub: every window ends back in the bootloader.
    r.clock.advance(20_000);
    expect(r.board.state).toBe('bootloader');
    expect(r.board.history.filter((h) => h.includes('stub')).length).toBeGreaterThan(2);
    r.board.xboot.faults = {};
    const second = await flash(r, 'update');
    expect(second.outcome.ok).toBe(true);
    r.clock.advance(200);
    expect(r.board.state).toBe('app');
  });

  it('an interrupted write (USB pulled mid-flash) leaves no application; after a replug, ESC in the 4.8 s window recovers it', async () => {
    const r = rig({ start: 'bootloader' });
    const image = plan('update');
    let pulled = false;
    const outcome = await drive(
      r.clock,
      runFlash(
        r.client,
        planFlash(image, null),
        {
          onProgress: (p) => {
            if (p.phase === 'write' && p.done === 30 && !pulled) {
              pulled = true;
              r.endpoint.disconnect('USB pulled');
            }
          },
          backupsReady: () => Promise.resolve(),
        },
        { entryMs: 5000 },
      ),
    );
    expect(outcome).toMatchObject({ ok: false, code: 'closed', wrote: true });
    r.clock.advance(30_000);
    expect(r.board.state).toBe('bootloader');
    expect(r.board.build).toBeNull();
    // Unplug and plug back in: the link returns, the board power-cycles into the short window.
    r.endpoint.reconnect();
    r.board.powerCycle();
    const link = new SimByteLink(r.endpoint, r.clock);
    const client = new XbootClient(link, r.clock, X192A3);
    const ticks: number[] = [];
    await drive(r.clock, recoverEntry(client, () => r.clock.now(), 10_000, (s) => ticks.push(s), (ms) => new Promise((res) => r.clock.setTimeout(res, ms))));
    expect(ticks[0]).toBe(10);
    const again = await drive(r.clock, runFlash(client, planFlash(image, null), { onProgress: () => undefined, backupsReady: () => Promise.resolve() }, { entryMs: 5000 }));
    expect(again.ok).toBe(true);
    r.clock.advance(200);
    expect(r.board.build?.fb).toBe(450.02);
  });

  it('recovery gives up after its deadline when nothing answers', async () => {
    const r = rig();
    const silent = new XbootClient(r.link, r.clock, X192A3);
    await expect(drive(r.clock, recoverEntry(silent, () => r.clock.now(), 3000, () => undefined, (ms) => new Promise((res) => r.clock.setTimeout(res, ms))))).rejects.toMatchObject({ code: 'no-entry' });
  });

  it('backups not saved: nothing is written and the old firmware starts again', async () => {
    const r = rig({ start: 'bootloader' });
    const { outcome } = await flash(r, 'update', { backupsReady: () => Promise.reject(new Error('quota exceeded')) });
    expect(outcome).toMatchObject({ ok: false, code: 'backup-not-saved', wrote: false });
    expect(r.board.xboot.pageWrites).toEqual([]);
    r.clock.advance(200);
    expect(r.board.state).toBe('app');
    expect(r.board.build?.fb).toBe(450.01);
  });

  it('cancel before writing leaves the board untouched', async () => {
    const r = rig({ start: 'bootloader' });
    const { outcome } = await flash(r, 'update', { cancelled: () => true });
    expect(outcome).toMatchObject({ ok: false, code: 'cancelled', wrote: false });
    expect(r.board.xboot.pageWrites).toEqual([]);
  });

  it('a firmware with a new EEPROM layout loads its defaults on first boot; the same layout keeps the settings', async () => {
    const eeprom = {};
    const r = rig({ eeprom, start: 'app' });
    r.clock.advance(10);
    sendLine(r.endpoint, '{"st":1}');
    r.clock.advance(100);
    expect((eeprom as Record<string, number>)['st']).toBe(1);
    sendLine(r.endpoint, '{"boot":1}');
    r.clock.advance(50);
    expect((await flash(r, 'newLayout')).outcome.ok).toBe(true);
    r.clock.advance(500);
    expect(r.board.build?.layout).toBe(10003);
    expect((eeprom as Record<string, number>)['st']).not.toBe(1);
  });
});
