/** What the flasher reports when the bootloader never answers (flashDiagnosis.ts). */
import { describe, expect, it } from 'vitest';
import type { WireEvent } from '@synthetos/machine';
import { entryDiagnosis, entryTraffic } from '../src/machine-worker/flashDiagnosis.ts';

const tx = (t: number, ...bytes: number[]): WireEvent => ({ t, dir: 'tx', bytes: Uint8Array.from(bytes) });
const rx = (t: number, text: string): WireEvent => ({ t, dir: 'rx', bytes: new TextEncoder().encode(text) });

describe('entryDiagnosis', () => {
  it('nothing back: says so, with how often and how long run tried', () => {
    const events = [tx(310, 0x1b), tx(311, 0x53), tx(512, 0x1b), tx(513, 0x53), tx(10_300, 0x1b)];
    expect(entryTraffic(events)).toMatchObject({ escapes: 3, ids: 2, received: 0, spanMs: 9_990 });
    expect(entryDiagnosis(events)).toBe('Nothing came back: run sent ESC 3 times and S 2 times over 10.0 s and the board sent no byte at all.');
  });

  it('bytes back that are not XBoot++: shows the first ones, control bytes escaped, and that the firmware may be running', () => {
    const events = [tx(310, 0x1b), tx(311, 0x53), rx(400, '{"r":{"fv":0.970,"fb":450.02}}\r\n'), tx(512, 0x1b)];
    const text = entryDiagnosis(events);
    expect(text).toBe('The board sent 32 bytes, none of them the bootloader\'s answer ("{"r":{"fv":0.970,"fb":45"…), while run sent ESC 2 times and S once over 0.2 s: the firmware may still be running.');
    expect(text).toContain('the firmware may still be running');
    expect(entryDiagnosis([rx(5, '\x00\r')])).toContain('("\\x00\\x0d")');
  });

  it('no events at all (the port never opened in bootloader role)', () => {
    expect(entryDiagnosis([])).toBe('Nothing came back: run sent ESC 0 times and S 0 times over 0.0 s and the board sent no byte at all.');
  });
});
