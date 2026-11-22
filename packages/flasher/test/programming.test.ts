import { describe, expect, it } from 'vitest';
import { FrameGuard, X192A3, XbootClient, type ByteLink, type FlasherClock } from '../src/index.ts';
import { encodeCommand, replyLength, type Command } from '../src/targets/xboot-xmega/avr109.ts';

function rig(replies: Record<number, number[]> = {}) {
  const frames: Uint8Array[] = [];
  let reply = new Uint8Array();
  const link: ByteLink = {
    closed: false, discardInput: () => new Uint8Array(),
    write: async (frame) => {
      frames.push(frame);
      reply = Uint8Array.from(replies[frame[0] as number] ?? (frame[0] === 0x74 ? [123, 0] : frame[0] === 0x61 ? [0x59] : [13]));
    },
    read: async () => reply,
  };
  const clock: FlasherClock = { now: () => 0, setTimeout: () => 1, clearTimeout: () => undefined };
  return { frames, client: new XbootClient(link, clock, X192A3), link };
}
const page = new Uint8Array(512);

describe('AVR109 write arming', () => {
  it('holds the write lock across t/T/P/H/B and relocks before readback', async () => {
    const r = rig();
    const writing = r.client.writePage(0, page);
    await expect(r.client.ping()).rejects.toThrow('in progress');
    await expect(r.client.enter(1000)).rejects.toThrow('one command');
    await expect(r.client.writePage(512, page)).rejects.toThrow('one page');
    await writing;
    await r.client.writePage(512, page);
    await r.client.readFlash(0, 2);
    await r.client.writePage(1024, page);
    await r.client.exit();
    expect(r.frames.map((f) => String.fromCharCode(f[0] as number)).join('')).toBe('tTPHBHBLHgtTPHBLE');
    expect(r.frames[1]).toEqual(Uint8Array.of(0x54, 123));
  });

  it.each([[0x74, [122, 0], 'configured'], [0x74, [123, 1], 'configured'], [0x54, [63], 'refused'], [0x50, [63], 'refused'], [0x54, [1], 'out of step'], [0x50, [1], 'out of step']] as const)('stops without writing on invalid arming response %#', async (op, reply, message) => {
    const r = rig({ [op]: [...reply] });
    await expect(r.client.writePage(0, page)).rejects.toThrow(message);
    expect(r.frames.some((f) => f[0] === 0x42)).toBe(false);
    const count = r.frames.length;
    await expect(r.client.ping()).rejects.toThrow('nothing is sent');
    expect(r.frames).toHaveLength(count);
  });

  it('stops before verification if L is refused', async () => {
    const r = rig({ 0x4c: [63] });
    await r.client.writePage(0, page);
    await expect(r.client.readFlash(0, 2)).rejects.toThrow('refused');
    expect(r.frames.at(-1)?.[0]).toBe(0x4c);
  });

  it('rearms after an explicit leave command', async () => {
    const r = rig();
    await r.client.writePage(0, page);
    await r.client.command({ op: 'leaveProgramming' }, 500);
    await r.client.writePage(512, page);
    expect(r.frames.filter((f) => f[0] === 0x54)).toHaveLength(2);
  });

  it('rejects malformed device selection before I/O without poisoning the reply stream', async () => {
    const r = rig();
    await expect(r.client.command({ op: 'selectDevice', code: 0 }, 500)).rejects.toMatchObject({ code: 'unexpected' });
    expect(r.frames).toHaveLength(0);
    await expect(r.client.ping()).resolves.toBeUndefined();
  });

  it('admits exactly t/T123/P/L frames without widening write permissions', () => {
    const guard = new FrameGuard(X192A3);
    for (const op of ['deviceCodes', 'enterProgramming', 'leaveProgramming'] as const) {
      const frame = encodeCommand({ op });
      expect(guard.check(frame).ok).toBe(true);
      expect(guard.check(Uint8Array.of(frame[0] as number, 0)).ok).toBe(false);
    }
    expect(guard.check(encodeCommand({ op: 'selectDevice', code: 123 })).ok).toBe(true);
    for (const frame of [[84], [84, 123, 80], [84, 122], [101], [108, 1], [68, 1], [99, 1]]) expect(guard.check(Uint8Array.from(frame)).ok).toBe(false);
    expect(() => replyLength({ op: 'toString' } as unknown as Command)).toThrow();
    for (const code of [0, -1, 256, 1.5, NaN]) expect(() => encodeCommand({ op: 'selectDevice', code })).toThrow();
  });
});
