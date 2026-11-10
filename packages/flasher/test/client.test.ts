/**
 * The byte buffer and the xboot client over a scripted link (the full
 * client-against-fake-xboot suite is packages/testkit/test/xboot.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { ByteBuffer, LinkClosed, LinkTimeout, X192A3, XbootClient, XbootError, toXbootError, type ByteLink, type FlasherClock } from '../src/index.ts';
import { CommandError } from '../src/targets/xboot-xmega/avr109.ts';

/** A manual clock: timers fire only when the test advances time. */
export class ManualClock implements FlasherClock {
  t = 0;
  #next = 1;
  readonly #timers = new Map<number, { at: number; fn: () => void }>();
  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): number {
    const id = this.#next++;
    this.#timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(id: number): void {
    this.#timers.delete(id);
  }
  /** Advance, firing due timers in order, letting promises settle between them. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      await flush();
      const due = [...this.#timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) break;
      this.#timers.delete(due[0]);
      this.t = due[1].at;
      due[1].fn();
    }
    this.t = end;
    await flush();
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** A link whose replies come from `respond(frame)`; records every frame. */
class ScriptLink implements ByteLink {
  readonly frames: Uint8Array[] = [];
  readonly buffer: ByteBuffer;
  closed = false;
  readonly respond: (frame: Uint8Array) => readonly number[] | null;
  constructor(clock: FlasherClock, respond: (frame: Uint8Array) => readonly number[] | null) {
    this.buffer = new ByteBuffer(clock);
    this.respond = respond;
  }
  write(frame: Uint8Array): Promise<void> {
    if (this.closed) return Promise.reject(new LinkClosed());
    this.frames.push(frame.slice());
    const r = this.respond(frame);
    if (r !== null) this.buffer.push(Uint8Array.from(r));
    return Promise.resolve();
  }
  read(n: number, timeoutMs: number): Promise<Uint8Array> {
    return this.buffer.read(n, timeoutMs);
  }
  discardInput(): void {
    this.buffer.discard();
  }
}

const XB = [...'XBoot++'].map((c) => c.charCodeAt(0));

/** A tiny well-behaved xboot for the client's happy paths. */
function goodXboot(frame: Uint8Array): readonly number[] | null {
  switch (frame[0]) {
    case 0x1b:
      return [];
    case 0x53:
      return XB;
    case 0x56:
      return [0x31, 0x37];
    case 0x73:
      return [0x44, 0x97, 0x1e];
    case 0x62:
      return [0x59, 0x02, 0x00];
    case 0x61:
      return [0x59];
    case 0x48:
      return [0x0d];
    case 0x42:
      return [0x0d];
    case 0x67:
      return Array.from({ length: ((frame[1] as number) << 8) | (frame[2] as number) }, (_, i) => i & 0xff);
    case 0x68:
      return [0x12, 0x34];
    case 0x45:
      return [0x0d];
    default:
      return [0x3f];
  }
}

describe('ByteBuffer', () => {
  it('reads exact counts across chunks and keeps the rest', async () => {
    const clock = new ManualClock();
    const b = new ByteBuffer(clock);
    b.push(Uint8Array.of(1, 2));
    b.push(Uint8Array.of(3, 4, 5));
    b.push(new Uint8Array(0));
    expect([...(await b.read(3, 10))]).toEqual([1, 2, 3]);
    expect(b.available).toBe(2);
    expect([...(await b.read(0, 10))]).toEqual([]);
    const later = b.read(4, 100);
    b.push(Uint8Array.of(6, 7));
    await flush();
    expect([...(await later)]).toEqual([4, 5, 6, 7]);
  });

  it('times out with the partial bytes, refuses two reads at once, and drops the oldest bytes past its limit', async () => {
    const clock = new ManualClock();
    const b = new ByteBuffer(clock, 4);
    b.push(Uint8Array.of(9));
    const p = b.read(3, 50);
    await expect(b.read(1, 50)).rejects.toThrow('one read at a time');
    const settled = p.catch((e: unknown) => e);
    await clock.advance(60);
    const e = (await settled) as LinkTimeout;
    expect(e).toBeInstanceOf(LinkTimeout);
    expect([...e.partial]).toEqual([9]);
    b.push(Uint8Array.of(1, 2, 3));
    b.push(Uint8Array.of(4, 5, 6));
    expect(b.dropped).toBe(2);
    b.push(Uint8Array.of(7, 8, 9, 10, 11));
    expect(b.available).toBe(4);
    expect([...(await b.read(4, 1))]).toEqual([8, 9, 10, 11]);
    b.push(Uint8Array.of(1));
    b.discard();
    expect(b.available).toBe(0);
  });

  it('ends: pending and later reads reject, later pushes are ignored', async () => {
    const clock = new ManualClock();
    const b = new ByteBuffer(clock);
    const p = b.read(2, 100);
    b.end();
    await expect(p).rejects.toBeInstanceOf(LinkClosed);
    await expect(b.read(1, 100)).rejects.toBeInstanceOf(LinkClosed);
    b.push(Uint8Array.of(1));
    expect(b.available).toBe(0);
    expect(b.ended).toBe(true);
    b.end(new Error('again'));
  });
});

describe('XbootClient', () => {
  it('enters with ESC then S, identifies the part, reads, writes, CRCs and exits', async () => {
    const clock = new ManualClock();
    const link = new ScriptLink(clock, goodXboot);
    const c = new XbootClient(link, clock, X192A3);
    expect(await c.enter(1000)).toBe(1);
    expect([...(link.frames[0] as Uint8Array)]).toEqual([0x1b]);
    expect([...(link.frames[1] as Uint8Array)]).toEqual([0x53]);
    const id = await c.identify();
    expect(id).toEqual({ programId: 'XBoot++', version: '17', signature: '1E 97 44', blockSize: 512 });
    const flash = await c.readFlash(0x200, 600);
    expect(flash.length).toBe(600);
    expect([...link.frames.at(-2) as Uint8Array]).toEqual([0x48, 0x00, 0x02, 0x00]);
    const eeprom = await c.readEeprom(0, 0x800);
    expect(eeprom.length).toBe(0x800);
    await c.writePage(0x400, new Uint8Array(512));
    expect(await c.crcApplication()).toBe(0x1234);
    await c.ping();
    await c.exit();
    expect(c.sent).toBeGreaterThan(10);
    expect(c.part).toBe(X192A3);
    expect(c.timings.blockWriteMs).toBe(1500);
  });

  it('refuses the wrong bootloader, chip, block size and auto-increment', async () => {
    const clock = new ManualClock();
    const variants: [number, readonly number[], string][] = [
      [0x53, [...'Hello!!'].map((ch) => ch.charCodeAt(0)), 'wrong-bootloader'],
      [0x73, [0x42, 0x97, 0x1e], 'wrong-part'],
      [0x62, [0x59, 0x01, 0x00], 'block-size'],
      [0x62, [0x4e, 0x02, 0x00], 'block-size'],
      [0x61, [0x4e], 'unexpected'],
    ];
    for (const [op, reply, code] of variants) {
      const link = new ScriptLink(clock, (f) => (f[0] === op ? reply : goodXboot(f)));
      await expect(new XbootClient(link, clock, X192A3).identify()).rejects.toMatchObject({ code });
    }
  });

  it('maps a refusal (?) and a wrong ack byte; refuses unaligned or boot-section page writes before sending', async () => {
    const clock = new ManualClock();
    const refusing = new ScriptLink(clock, (f) => (f[0] === 0x42 ? [0x3f] : goodXboot(f)));
    await expect(new XbootClient(refusing, clock, X192A3).writePage(0, new Uint8Array(512))).rejects.toMatchObject({ code: 'refused' });
    const odd = new ScriptLink(clock, (f) => (f[0] === 0x45 ? [0x00] : goodXboot(f)));
    await expect(new XbootClient(odd, clock, X192A3).exit()).rejects.toMatchObject({ code: 'unexpected' });
    const pinging = new ScriptLink(clock, (f) => (f[0] === 0x61 ? [0x00] : goodXboot(f)));
    await expect(new XbootClient(pinging, clock, X192A3).ping()).rejects.toMatchObject({ code: 'unexpected' });
    const quiet = new ScriptLink(clock, goodXboot);
    const c = new XbootClient(quiet, clock, X192A3);
    await expect(c.writePage(0x100, new Uint8Array(512))).rejects.toMatchObject({ code: 'unexpected' });
    await expect(c.writePage(0, new Uint8Array(100))).rejects.toMatchObject({ code: 'unexpected' });
    await expect(c.writePage(0x30000, new Uint8Array(512))).rejects.toMatchObject({ code: 'unexpected' });
    await expect(c.setFlashAddress(1)).rejects.toMatchObject({ code: 'unexpected' });
    expect(quiet.frames).toEqual([]);
  });

  it('times out when nothing answers, and gives up entry after its deadline', async () => {
    const clock = new ManualClock();
    const silent = new ScriptLink(clock, () => null);
    const c = new XbootClient(silent, clock, X192A3);
    const p = c.command({ op: 'version' }, 100).catch((e: unknown) => e);
    await clock.advance(150);
    expect(await p).toMatchObject({ code: 'timeout' });
    const entry = c.enter(1000).catch((e: unknown) => e);
    await clock.advance(2000);
    expect(await entry).toMatchObject({ code: 'no-entry' });
    expect(silent.frames.filter((f) => f[0] === 0x1b).length).toBeGreaterThan(3);
  });

  it('allows one command at a time', async () => {
    const clock = new ManualClock();
    const silent = new ScriptLink(clock, () => null);
    const c = new XbootClient(silent, clock, X192A3);
    const first = c.command({ op: 'version' }, 100).catch(() => undefined);
    await expect(c.command({ op: 'version' }, 100)).rejects.toMatchObject({ code: 'unexpected' });
    await clock.advance(200);
    await first;
  });

  it('stops entry at once when the link closes', async () => {
    const clock = new ManualClock();
    const link = new ScriptLink(clock, goodXboot);
    link.closed = true;
    await expect(new XbootClient(link, clock, X192A3).enter(1000)).rejects.toMatchObject({ code: 'closed' });
    const closing = new ScriptLink(clock, () => {
      closing.buffer.end();
      return null;
    });
    await expect(new XbootClient(closing, clock, X192A3).enter(1000)).rejects.toMatchObject({ code: 'closed' });
  });

  it('keeps the bootloader awake until the page answers, and passes on a rejection', async () => {
    const clock = new ManualClock();
    const link = new ScriptLink(clock, goodXboot);
    const c = new XbootClient(link, clock, X192A3);
    let resolve: (v: string) => void = () => undefined;
    const done = c.keepAlive(new Promise<string>((r) => (resolve = r)));
    await clock.advance(1000);
    const pings = link.frames.filter((f) => f[0] === 0x61).length;
    expect(pings).toBeGreaterThanOrEqual(4);
    resolve('saved');
    await clock.advance(300);
    expect(await done).toBe('saved');
    const failing = c.keepAlive(Promise.reject(new Error('quota')));
    await clock.advance(300);
    await expect(failing).rejects.toThrow('quota');
  });

  it('resyncs: waits past the watchdog, then enters again', async () => {
    const clock = new ManualClock();
    const link = new ScriptLink(clock, goodXboot);
    const c = new XbootClient(link, clock, X192A3, { watchdogMs: 1000 });
    const p = c.resync(2000);
    await clock.advance(1100);
    await p;
    expect(link.frames.map((f) => f[0])).toEqual([0x1b, 0x53]);
  });

  it('turns link and command failures into XbootError', () => {
    expect(toXbootError(new LinkTimeout(2, new Uint8Array(0))).code).toBe('timeout');
    expect(toXbootError(new LinkClosed()).code).toBe('closed');
    expect(toXbootError(new CommandError('x')).code).toBe('unexpected');
    expect(toXbootError('boom').code).toBe('closed');
    expect(toXbootError(new Error('boom')).message).toBe('boom');
    const e = new XbootError('refused', 'no');
    expect(toXbootError(e)).toBe(e);
  });
});
