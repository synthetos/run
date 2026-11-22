/**
 * Reply desync between the flasher and xboot (bench report 2026-11-21: a
 * TinyG v8 update 449.01 -> 450.06 stopped at "xboot refused the page at
 * 0x0" right after the backups were read).
 *
 * AVR109 has no framing: the host pairs each reply with the command it sent
 * only by counting bytes. One stale or extra byte shifts every later reply,
 * and xboot answers `?` to any byte it does not know (XB src/xboot.c:771-773;
 * ESC alone gets no reply). These tests put stale bytes where a real link
 * puts them (a late reply to an entry try, a garbled byte, a duplicated byte)
 * and check that the client never pairs a reply with the wrong command,
 * never trusts a shifted backup, and stops before sending anything more.
 */
import { describe, expect, it } from 'vitest';
import type { FlashBackups } from '@synthetos/flasher';
import { simImage } from '../src/index.ts';
import { flash, rig, sendLine } from './xbootRig.ts';

/** The first entry try's `S` reply leaves the board while the USB bridge holds it back 230 ms (past the 150 ms entry deadline). */
const LATE_FIRST_REPLY = { kind: 'latency', direction: 'toHost', fromMs: 0, toMs: 100, extraMs: 230 } as const;

const OPS = new Map<number, string>([
  [0x1b, '!'],
  [0x74, 't'], [0x54, 'T'], [0x50, 'P'], [0x4c, 'L'],
  [0x53, 'S'],
  [0x56, 'V'],
  [0x73, 's'],
  [0x62, 'b'],
  [0x61, 'a'],
  [0x48, 'H'],
  [0x67, 'g'],
  [0x42, 'B'],
  [0x68, 'h'],
  [0x45, 'E'],
]);

describe('the client and stale replies from xboot', () => {
  it('a late reply to an entry try: the duplicate that follows is drained, not read as the next answer', async () => {
    const r = rig({ start: 'bootloader' }, { faults: [LATE_FIRST_REPLY] });
    const { outcome } = await flash(r, 'update');
    expect(outcome.ok ? 'ok' : `${outcome.phase} ${outcome.code}: ${outcome.message}`).toBe('ok');
    expect(r.board.memory.subarray(0, 0x30000)).toEqual(simImage('update'));
  });

  it('a stale `?` from a garbled entry byte is drained before the first command', async () => {
    // Host byte 2 is the second try's ESC; garbled on the wire, xboot answers it `?` (it is not a command it knows).
    const r = rig({ start: 'bootloader' }, { faults: [LATE_FIRST_REPLY, { kind: 'corrupt', direction: 'toDevice', select: { at: [2] }, xor: 0x40 }] });
    const { outcome } = await flash(r, 'update');
    expect(outcome.ok ? 'ok' : `${outcome.phase} ${outcome.code}: ${outcome.message}`).toBe('ok');
    expect(r.board.xboot.commands).toContain(0x5b);
  });

  it('stale bytes waiting before the first page write: the run stops before sending it, and never reports a refusal for a page xboot never saw', async () => {
    const r = rig({ start: 'bootloader' });
    let framesAtStop = -1;
    const { outcome } = await flash(r, 'update', {
      beforeFirstWrite: () => {
        // A `\r` and a `?` that arrived late, after the last keep-alive was answered.
        r.link.buffer.push(Uint8Array.of(0x0d, 0x3f));
        framesAtStop = r.link.frames.length;
      },
    });
    expect(outcome).toMatchObject({ ok: false, code: 'desync', phase: 'write' });
    expect(outcome.ok ? '' : outcome.message).toContain('0d 3f');
    expect(r.link.frames.length).toBe(framesAtStop);
    expect(r.board.xboot.pageWrites).toEqual([]);
  });

  it('a duplicated reply byte that would shift an EEPROM block read: the backup is never handed on and nothing is written', async () => {
    // Reply bytes 0-22: the entry `S`, then S V s b a. EEPROM blocks: `H` ack, 512 bytes; the fourth block's ack is byte 1562.
    const r = rig({ start: 'bootloader' }, { faults: [{ kind: 'duplicate', direction: 'toHost', select: { at: [1562] } }] });
    const eeprom = r.board.eepromBytes.slice();
    let saved: FlashBackups | null = null;
    const { outcome } = await flash(r, 'update', {
      backupsReady: (b) => {
        saved = b;
        return Promise.resolve();
      },
    });
    if (saved !== null) expect((saved as FlashBackups).eeprom).toEqual(eeprom);
    expect(outcome).toMatchObject({ ok: false, code: 'desync', phase: 'backup', wrote: false });
    expect(saved).toBeNull();
    expect(r.board.xboot.pageWrites).toEqual([]);
    expect(r.link.frames.some((f) => f[0] === 0x42)).toBe(false);
  });
});

describe('the bytes a whole update puts on the wire', () => {
  it('only the documented command set, in order, every frame whole; xboot parses exactly the commands sent and nothing else', async () => {
    const r = rig();
    sendLine(r.endpoint, '{"boot":1}');
    r.clock.advance(50);
    const { outcome } = await flash(r, 'update');
    expect(outcome.ok).toBe(true);
    const ops = r.link.frames.map((f) => OPS.get(f[0] as number) ?? `<${(f[0] as number).toString(16)}>`).join('');
    // Entry; identify; EEPROM twice (4 blocks each) and the application (384 blocks) with its CRC; keep-alives;
    // stub page 0 and the pages that differ; read-back of every page; the real page 0 and its read-back; CRC; exit.
    expect(ops).toMatch(/^!SSVsba(Hg){4}(Hg){384}(Hg){4}ha+tTP(HB)+L(Hg){384}tTPHBLHghE$/);
    for (const f of r.link.frames) {
      if (f[0] === 0x42) expect([f.length, f[1], f[2], f[3]]).toEqual([516, 0x02, 0x00, 0x46]);
      if (f[0] === 0x67) expect([f.length, f[1], f[2]]).toEqual([4, 0x02, 0x00]);
      if (f[0] === 0x48) expect(f.length).toBe(4);
    }
    // The window consumed the first ESC; every later frame's first byte is one command xboot parsed, and no data
    // byte was ever parsed as a command.
    expect(r.board.xboot.commands).toEqual(r.link.frames.slice(1).map((f) => f[0]));
    expect(r.board.xboot.eraseCount).toBe(0);
    expect(r.board.xboot.lockWrites).toBe(0);
    expect(r.link.buffer.available).toBe(0);
  });
});
