/**
 * A close must not cut the last line written (SAFETY H2b). On the owner's TinyG (2026-11-26) run wrote
 * `{"boot":1}\n` and closed the port at once: the board received only `{"boot"`, the operating system dropped the
 * rest when the port closed, so the board never reset into its bootloader. Closing therefore waits for the bytes
 * written to leave the computer before it closes the port.
 */
import { describe, expect, it } from 'vitest';
import { WEB_SERIAL_CLOSE_DRAIN_MS, WebSerialTransport } from '../src/webSerialTransport.ts';
import { SESSION_OPEN_OPTIONS } from '../src/openPolicy.ts';
import { enc, flush } from './fakeTransport.ts';
import { ScriptedSerialPort } from './serialPorts.ts';

function gate(): { wait: (ms: number) => Promise<void>; asked: number[]; release: () => void } {
  const asked: number[] = [];
  let release: () => void = () => undefined;
  const wait = (ms: number): Promise<void> => {
    asked.push(ms);
    return new Promise<void>((resolve) => { release = resolve; });
  };
  return { wait, asked, release: () => release() };
}

describe('closing after a write waits for the bytes to leave', () => {
  it('waits the drain time after the last write before the port closes', async () => {
    const port = new ScriptedSerialPort();
    const g = gate();
    const t = new WebSerialTransport(port, { wait: g.wait });
    await t.open(SESSION_OPEN_OPTIONS);
    port.log.length = 0;
    await t.writeLine(enc('{"boot":1}\n'));
    const closing = t.close();
    await flush();
    expect(g.asked).toEqual([WEB_SERIAL_CLOSE_DRAIN_MS]);
    expect(port.log).not.toContain('port-close');
    g.release();
    await closing;
    expect(port.log.at(-1)).toBe('port-close');
  });

  it('a port that was never written closes without waiting', async () => {
    const port = new ScriptedSerialPort();
    const g = gate();
    const t = new WebSerialTransport(port, { wait: g.wait });
    await t.open(SESSION_OPEN_OPTIONS);
    await t.close();
    expect(g.asked).toEqual([]);
    expect(port.log.at(-1)).toBe('port-close');
  });

  it('the drain time covers the USB adapter and the operating system (at least 200 ms)', () => {
    expect(WEB_SERIAL_CLOSE_DRAIN_MS).toBeGreaterThanOrEqual(200);
  });
});
