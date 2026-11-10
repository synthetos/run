/** The modular updater (owner, 2026-11-09): the target table and the xboot target's adapter over the existing code. */
import { describe, expect, it } from 'vitest';
import { UPDATER_TARGETS, X192A3, toIntelHex, updaterFor, xbootXmega } from '../src/index.ts';

function image(): string {
  const bytes = new Uint8Array(X192A3.appBytes).fill(0xff);
  // A reset vector (jmp) at 0, as a real image starts.
  bytes.set([0x0c, 0x94, 0x00, 0x01], 0);
  return toIntelHex(bytes, X192A3);
}

describe('the target table', () => {
  it('has TinyG xboot for the xmega family, and nothing for a family it does not know', () => {
    expect(UPDATER_TARGETS['tinyg-xmega']).toBe(xbootXmega);
    expect(updaterFor('tinyg-xmega')).toBe(xbootXmega);
    expect(updaterFor('g2-sam3x')).toBeNull();
    expect(updaterFor('toString')).toBeNull();
    expect(xbootXmega).toMatchObject({ family: 'tinyg-xmega', bootloader: 'TinyG xboot (AVR109)' });
  });
});

describe('the xboot target', () => {
  it('prepares a plan from an image, refuses what is not one, and restores a backup as a plan', () => {
    const ok = xbootXmega.prepare(image());
    expect(ok.ok).toBe(true);
    expect(xbootXmega.prepare('<html>not a hex file</html>')).toMatchObject({ ok: false, reason: expect.any(String) });
    const backup = new Uint8Array(X192A3.appBytes).fill(0xff);
    backup.set([0x0c, 0x94, 0x00, 0x01], 0);
    expect(xbootXmega.restore({ flash: backup }).ok).toBe(true);
  });

  it('a write is verified only when it succeeded', () => {
    expect(xbootXmega.verify({ ok: true, identity: { programId: 'XBoot++', version: '1', signature: '1e 97 44', blockSize: 512 }, written: 1, unchanged: 0, resyncs: 0, crc: 0 })).toBe(true);
    expect(xbootXmega.verify({ ok: false, phase: 'crc', code: 'crc-mismatch', message: 'x', wrote: true, backups: null })).toBe(false);
  });
});
