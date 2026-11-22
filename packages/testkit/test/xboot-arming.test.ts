import { describe, expect, it } from 'vitest';
import { drive, flash, rig, sendLine } from './xbootRig.ts';

describe('hardened xboot (tg-xboot e607778)', () => {
  it('refuses an unarmed page and resets after its following size byte', async () => {
    const r = rig({ start: 'bootloader', xboot: { hardened: true } });
    await drive(r.clock, r.client.enter(4000));
    await drive(r.clock, r.client.setFlashAddress(0));
    const before = r.board.memory.slice();
    const write = r.client.command({ op: 'writeFlashBlock', data: new Uint8Array(512) }, 1500);
    expect(await drive(r.clock, write)).toEqual(Uint8Array.of(0x3f));
    r.clock.advance(1100);
    expect(r.endpoint.transcript.entries().some((e) => e.kind === 'device' && e.note === 'xboot: watchdog reset')).toBe(true);
    expect(r.board.xboot.mode).toBe('window');
    expect(r.board.memory).toEqual(before);
    expect(r.board.xboot.pageWrites).toEqual([]);
  });

  it('arms before page zero and completes a verified flash', async () => {
    const r = rig({ start: 'bootloader', xboot: { hardened: true } });
    const { outcome } = await flash(r, 'update');
    expect(outcome, outcome.ok ? '' : outcome.message).toMatchObject({ ok: true });
    expect(r.board.xboot.pageWrites[0]).toBe(0);
    expect(r.board.xboot.eraseCount).toBe(0);
    expect(r.board.xboot.lockWrites).toBe(0);
  });

  it('enters automatically after the running firmware handles boot=1, without reset', async () => {
    const r = rig({ xboot: { hardened: true } });
    sendLine(r.endpoint, '{"boot":1}');
    r.clock.advance(300);
    expect(r.board.history.some((s) => s.includes('software reset'))).toBe(true);
    const { outcome } = await flash(r, 'update');
    expect(outcome, outcome.ok ? '' : outcome.message).toMatchObject({ ok: true });
  });
  it('rearms after a lost write reply and watchdog recovery', async () => {
    const r = rig({ start: 'bootloader', xboot: { hardened: true } });
    await drive(r.clock, r.client.enter(1000));
    r.board.xboot.faults.dropTx = [r.endpoint.transcript.bytesOf('host-read').length + 6];
    const stub = new Uint8Array(512).fill(255);
    stub.set([0x0d, 0x94, 0, 0x80]);
    await expect(drive(r.clock, r.client.writePage(0, stub))).rejects.toMatchObject({ code: 'timeout' });
    await drive(r.clock, r.client.resync());
    await drive(r.clock, r.client.writePage(512, new Uint8Array(512)));
    expect(r.board.xboot.pageWrites).toEqual([0, 512]);
    expect(r.board.xboot.commands.filter((op) => op === 0x54)).toHaveLength(2);
  });

  it.each([
    [[0x54, 122], [0x50]],
    [[0x54, 123], [0x61], [0x50]],
    [[0x54, 123], [0x50], [0x4c]],
    [[0x54, 123], [0x50], [0xfe], [0x50]],
  ].map((frames) => ({ frames })))('keeps writes locked after wrong code, interrupted T/P, L or stray text %#', async ({ frames }) => {
    const r = rig({ start: 'bootloader', xboot: { hardened: true } });
    await drive(r.clock, r.client.enter(1000));
    for (const frame of frames) {
      r.endpoint.hostWrite(Uint8Array.from(frame));
      await drive(r.clock, r.link.read(1, 500));
    }
    await drive(r.clock, r.client.setFlashAddress(0));
    expect(await drive(r.clock, r.client.command({ op: 'writeFlashBlock', data: new Uint8Array(512) }, 1500))).toEqual(Uint8Array.of(63));
    expect(r.board.xboot.pageWrites).toEqual([]);
  });

});
