/**
 * The closed AVR109 command set and the frame guard (SAFETY H83, H84): chip
 * erase (`e`) is unrepresentable, and the guard refuses it and every other
 * frame run does not send, whatever bytes it is handed.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_OPCODES, FrameGuard, MEMORY, OPCODES, X192A3, encodeCommand, replyLength, type Command } from '../src/index.ts';

const page = (fill = 0x5a): Uint8Array => new Uint8Array(512).fill(fill);

/** Every command the client can build, with representative arguments. */
export const ALL_COMMANDS: readonly Command[] = [
  { op: 'sync' },
  { op: 'programId' },
  { op: 'version' },
  { op: 'signature' },
  { op: 'autoIncrement' },
  { op: 'blockSupport' },
  { op: 'setAddress', value: 0 },
  { op: 'setAddress', value: 0x17f00 },
  { op: 'writeFlashBlock', data: page() },
  { op: 'readBlock', memory: 'flash', size: 512 },
  { op: 'readBlock', memory: 'eeprom', size: 512 },
  { op: 'crcApplication' },
  { op: 'exit' },
];

describe('the command set', () => {
  it('has no chip erase: no opcode is `e`, and no encoded frame starts with it', () => {
    expect(Object.values(OPCODES)).not.toContain(0x65);
    for (const v of Object.values(OPCODES)) expect(FORBIDDEN_OPCODES).not.toContain(v);
    expect(FORBIDDEN_OPCODES).toContain(0x65);
    for (const c of ALL_COMMANDS) expect(encodeCommand(c)[0]).not.toBe(0x65);
    // The type has no erase variant: an erase "command" is not a Command (checked by tsc), and at runtime it
    // reaches no branch of the encoder.
    expect(() => encodeCommand({ op: 'chipErase' } as unknown as Command)).toThrow('no such command');
    expect(() => replyLength({ op: 'chipErase' } as unknown as Command)).toThrow('no such command');
  });

  it('encodes each command exactly as xboot reads it', () => {
    expect([...encodeCommand({ op: 'sync' })]).toEqual([0x1b]);
    expect([...encodeCommand({ op: 'programId' })]).toEqual([0x53]);
    expect([...encodeCommand({ op: 'version' })]).toEqual([0x56]);
    expect([...encodeCommand({ op: 'signature' })]).toEqual([0x73]);
    expect([...encodeCommand({ op: 'autoIncrement' })]).toEqual([0x61]);
    expect([...encodeCommand({ op: 'blockSupport' })]).toEqual([0x62]);
    expect([...encodeCommand({ op: 'setAddress', value: 0x010203 })]).toEqual([0x48, 0x01, 0x02, 0x03]);
    expect([...encodeCommand({ op: 'readBlock', memory: 'flash', size: 512 })]).toEqual([0x67, 0x02, 0x00, 0x46]);
    expect([...encodeCommand({ op: 'readBlock', memory: 'eeprom', size: 256 })]).toEqual([0x67, 0x01, 0x00, 0x45]);
    expect([...encodeCommand({ op: 'crcApplication' })]).toEqual([0x68, 0x41]);
    expect([...encodeCommand({ op: 'exit' })]).toEqual([0x45]);
    const block = encodeCommand({ op: 'writeFlashBlock', data: page(7) });
    expect([...block.subarray(0, 4)]).toEqual([0x42, 0x02, 0x00, MEMORY.flash]);
    expect(block.length).toBe(516);
    expect(block[515]).toBe(7);
  });

  it('refuses malformed arguments instead of guessing', () => {
    expect(() => encodeCommand({ op: 'setAddress', value: -1 })).toThrow();
    expect(() => encodeCommand({ op: 'setAddress', value: 0x1000000 })).toThrow();
    expect(() => encodeCommand({ op: 'setAddress', value: 1.5 })).toThrow();
    expect(() => encodeCommand({ op: 'writeFlashBlock', data: new Uint8Array(0) })).toThrow();
    expect(() => encodeCommand({ op: 'writeFlashBlock', data: new Uint8Array(0x10000) })).toThrow();
    expect(() => encodeCommand({ op: 'readBlock', memory: 'flash', size: 0 })).toThrow();
    expect(() => encodeCommand({ op: 'readBlock', memory: 'flash', size: 0x10000 })).toThrow();
  });

  it('knows how many bytes each reply has', () => {
    expect(ALL_COMMANDS.map((c) => replyLength(c))).toEqual([0, 7, 2, 3, 1, 3, 1, 1, 1, 512, 512, 2, 1]);
  });
});

describe('FrameGuard', () => {
  it('admits every frame the client builds, in a realistic order', () => {
    const g = new FrameGuard(X192A3);
    const order: Command[] = [
      { op: 'sync' },
      { op: 'programId' },
      { op: 'version' },
      { op: 'signature' },
      { op: 'blockSupport' },
      { op: 'autoIncrement' },
      { op: 'setAddress', value: 0 },
      { op: 'readBlock', memory: 'eeprom', size: 512 },
      { op: 'setAddress', value: 0x100 },
      { op: 'readBlock', memory: 'flash', size: 512 },
      { op: 'setAddress', value: 0x17f00 },
      { op: 'writeFlashBlock', data: page() },
      { op: 'crcApplication' },
      { op: 'exit' },
    ];
    for (const c of order) expect(g.check(encodeCommand(c))).toMatchObject({ ok: true, op: c.op });
  });

  it('tracks the address as xboot does: words for flash, bytes for EEPROM', () => {
    const g = new FrameGuard(X192A3);
    expect(g.address).toBeNull();
    g.check(encodeCommand({ op: 'setAddress', value: 0x100 }));
    g.check(encodeCommand({ op: 'readBlock', memory: 'flash', size: 512 }));
    expect(g.address).toBe(0x100 + 256);
    g.check(encodeCommand({ op: 'writeFlashBlock', data: page() }));
    expect(g.address).toBe(0x100 + 512);
    g.check(encodeCommand({ op: 'setAddress', value: 0x40 }));
    g.check(encodeCommand({ op: 'readBlock', memory: 'eeprom', size: 64 }));
    expect(g.address).toBe(0x80);
    g.check(encodeCommand({ op: 'exit' }));
    expect(g.address).toBeNull();
    g.check(encodeCommand({ op: 'setAddress', value: 1 }));
    g.reset();
    expect(g.address).toBeNull();
  });

  it('never admits `e`, lock bits, EEPROM or byte writes, alone or followed by anything', () => {
    const g = new FrameGuard(X192A3);
    for (const op of FORBIDDEN_OPCODES) {
      expect(g.check(Uint8Array.of(op))).toMatchObject({ ok: false, reason: 'forbidden-opcode' });
      expect(g.check(Uint8Array.of(op, 0x00, 0x00))).toMatchObject({ ok: false, reason: 'forbidden-opcode' });
    }
    expect(g.check(Uint8Array.of(0x65))).toMatchObject({ ok: false, reason: 'forbidden-opcode' });
  });

  it('refuses block loads that are not one aligned flash page below the boot section', () => {
    const g = new FrameGuard(X192A3);
    const load = (n = 512, mem: number = MEMORY.flash): Uint8Array => {
      const f = new Uint8Array(4 + n);
      f.set([0x42, n >> 8, n & 0xff, mem]);
      return f;
    };
    expect(g.check(load())).toMatchObject({ ok: false, reason: 'no-address' });
    g.check(encodeCommand({ op: 'setAddress', value: 0 }));
    expect(g.check(load(512, MEMORY.eeprom))).toMatchObject({ ok: false, reason: 'bad-memory' });
    expect(g.check(load(512, 0x55))).toMatchObject({ ok: false, reason: 'bad-memory' });
    expect(g.check(load(256))).toMatchObject({ ok: false, reason: 'block-size' });
    const short = load();
    expect(g.check(short.subarray(0, 100))).toMatchObject({ ok: false, reason: 'bad-length' });
    expect(g.check(Uint8Array.of(0x42, 0x02))).toMatchObject({ ok: false, reason: 'bad-length' });
    g.check(encodeCommand({ op: 'setAddress', value: 0x81 }));
    expect(g.check(load())).toMatchObject({ ok: false, reason: 'unaligned' });
    g.check(encodeCommand({ op: 'setAddress', value: 0x18000 }));
    expect(g.check(load())).toMatchObject({ ok: false, reason: 'boot-section' });
    g.check(encodeCommand({ op: 'setAddress', value: 0x17f00 }));
    expect(g.check(load())).toMatchObject({ ok: true });
    // After the last application page the address points at the bootloader: the next block load is refused.
    expect(g.check(load())).toMatchObject({ ok: false, reason: 'boot-section' });
  });

  it('refuses reads larger than a page, odd, of other memories, or with no address; other CRC sections; bad lengths', () => {
    const g = new FrameGuard(X192A3);
    expect(g.check(Uint8Array.of(0x67, 0x02, 0x00, 0x46))).toMatchObject({ ok: false, reason: 'no-address' });
    g.check(encodeCommand({ op: 'setAddress', value: 0 }));
    expect(g.check(Uint8Array.of(0x67, 0x02, 0x02, 0x46))).toMatchObject({ ok: false, reason: 'block-size' });
    expect(g.check(Uint8Array.of(0x67, 0x00, 0x03, 0x46))).toMatchObject({ ok: false, reason: 'block-size' });
    expect(g.check(Uint8Array.of(0x67, 0x00, 0x00, 0x46))).toMatchObject({ ok: false, reason: 'block-size' });
    expect(g.check(Uint8Array.of(0x67, 0x00, 0x02, 0x55))).toMatchObject({ ok: false, reason: 'bad-memory' });
    expect(g.check(Uint8Array.of(0x67, 0x00, 0x02))).toMatchObject({ ok: false, reason: 'bad-length' });
    expect(g.check(Uint8Array.of(0x68, 0x42))).toMatchObject({ ok: false, reason: 'bad-section' });
    expect(g.check(Uint8Array.of(0x68))).toMatchObject({ ok: false, reason: 'bad-length' });
    expect(g.check(Uint8Array.of(0x48, 0, 0))).toMatchObject({ ok: false, reason: 'bad-length' });
    expect(g.check(Uint8Array.of(0x53, 0x53))).toMatchObject({ ok: false, reason: 'bad-length' });
    expect(g.check(new Uint8Array(0))).toMatchObject({ ok: false, reason: 'empty' });
    expect(g.check(Uint8Array.of(0x7a))).toMatchObject({ ok: false, reason: 'unknown-opcode' });
    expect(g.check(Uint8Array.of(0x0a))).toMatchObject({ ok: false, reason: 'unknown-opcode' });
  });

  it('property: no byte sequence the guard admits begins with a forbidden opcode, and a refused frame leaves the address unchanged', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 600 }), fc.integer({ min: 0, max: 0x17f00 }), (bytes, start) => {
        const g = new FrameGuard(X192A3);
        g.check(encodeCommand({ op: 'setAddress', value: start - (start % 256) }));
        const before = g.address;
        const v = g.check(bytes);
        if (v.ok) expect(FORBIDDEN_OPCODES).not.toContain(bytes[0]);
        else expect(g.address).toBe(before);
      }),
      { numRuns: 2000 },
    );
  });
});
