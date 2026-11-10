/**
 * RTS held on after every open (OD-33; SAFETY H61 as amended 2026-11-10; TinyG B-FC-1): a TinyG on `$ex=2` sends
 * nothing while the host's RTS is off. The session's open, a reconnect and the flasher's bootloader reopen all turn
 * RTS on, explicitly, and never touch DTR. A port whose RTS cannot be set is closed and the open is refused in
 * plain words.
 */
import { describe, expect, it } from 'vitest';
import { X192A3 } from '@synthetos/flasher';
import { mintBootloaderCapability } from '../../flasher/src/bootloaderCapability.ts';
import { MockSerialPort, SimEndpoint, TinyGEdgeNextModel, VirtualClock } from '@synthetos/testkit';
import { BootloaderLink, GuardedTransport, RTS_ON, RTS_REFUSAL, RtsRefusedError, SESSION_OPEN_OPTIONS, openWithRts } from '../src/index.ts';
import { WEB_SERIAL_RTS_ON, WEB_SERIAL_RTS_REFUSAL, WebSerialTransport } from '../src/webSerialTransport.ts';
import { ScriptedSerialPort } from './serialPorts.ts';

const RTS_ONLY = [{ requestToSend: true }];

describe('openWithRts', () => {
  it('turns RTS on after the open, and sets nothing else', async () => {
    const order: string[] = [];
    const port = { setSignals: async (s: object) => void order.push(`signals ${JSON.stringify(s)}`), close: async () => void order.push('close') };
    await openWithRts(port, async () => void order.push('open'));
    expect(order).toEqual(['open', 'signals {"requestToSend":true}']);
    expect(RTS_ON).toEqual({ requestToSend: true });
    expect(Object.isFrozen(RTS_ON)).toBe(true);
  });

  it('an open that fails is passed on as it is: no RTS, no close', async () => {
    const order: string[] = [];
    const port = { setSignals: async () => void order.push('signals'), close: async () => void order.push('close') };
    const failure = new Error('Failed to open serial port.');
    await expect(openWithRts(port, () => Promise.reject(failure))).rejects.toBe(failure);
    expect(order).toEqual([]);
  });

  it('RTS that cannot be set closes the port and refuses in plain words; a failing close changes nothing', async () => {
    const cause = new DOMException('The device has been lost.', 'NetworkError');
    for (const close of [async () => undefined, () => Promise.reject(new Error('close failed'))]) {
      let closed = 0;
      const port = { setSignals: () => Promise.reject(cause), close: () => (closed++, close()) };
      const error = await openWithRts(port, async () => undefined).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RtsRefusedError);
      expect((error as Error).message).toBe(RTS_REFUSAL);
      expect((error as Error).cause).toBe(cause);
      expect(closed).toBe(1);
    }
    expect(RTS_REFUSAL).not.toMatch(/RtsRefusedError|DOMException|setSignals/);
  });
});

describe('WebSerialTransport turns RTS on after every open', () => {
  it('holds rts.ts\'s rule as literals (it imports types only): the same signals and the same words', () => {
    expect(WEB_SERIAL_RTS_ON).toEqual(RTS_ON);
    expect(Object.isFrozen(WEB_SERIAL_RTS_ON)).toBe(true);
    expect(WEB_SERIAL_RTS_REFUSAL).toBe(RTS_REFUSAL);
  });

  it('RTS on after the open, DTR never touched', async () => {
    const port = new ScriptedSerialPort();
    await new WebSerialTransport(port).open(SESSION_OPEN_OPTIONS);
    expect(port.log).toEqual(['open']);
    expect(port.signals).toEqual(RTS_ONLY);
    expect(port.signals.every((s) => !('dataTerminalReady' in s))).toBe(true);
  });

  it('a port whose RTS cannot be set is closed, the open refused, and nothing is ever written', async () => {
    const port = new ScriptedSerialPort();
    port.signalsError = new DOMException('The device has been lost.', 'NetworkError');
    const t = new WebSerialTransport(port);
    const error = await t.open(SESSION_OPEN_OPTIONS).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'RtsRefusedError', message: RTS_REFUSAL, cause: port.signalsError });
    expect(port.log).toEqual(['open', 'port-close']);
    await expect(t.writeLine(new TextEncoder().encode('{"sr":null}\n'))).rejects.toThrow('not-open');
    await t.close();
    expect(port.log).toEqual(['open', 'port-close']);
  });

  it('a port that fails to open is never signalled', async () => {
    const port = new ScriptedSerialPort();
    port.openError = new DOMException('Failed to open serial port.', 'NetworkError');
    await expect(new WebSerialTransport(port).open(SESSION_OPEN_OPTIONS)).rejects.toThrow('Failed to open');
    expect(port.signals).toEqual([]);
  });

  it('a close while opening still waits for RTS, then closes the port', async () => {
    const port = new ScriptedSerialPort();
    port.holdOpen = true;
    const t = new WebSerialTransport(port);
    const opening = t.open(SESSION_OPEN_OPTIONS);
    const closing = t.close();
    port.releaseOpen();
    await opening;
    await closing;
    expect(port.signals).toEqual(RTS_ONLY);
    expect(port.log).toEqual(['open', 'writable-close', 'port-close']);
  });

  it('on the simulated board: the session open, a reconnect and the flasher\'s bootloader reopen each turn RTS on', async () => {
    const clock = new VirtualClock();
    const port = new MockSerialPort(new SimEndpoint({ clock, device: new TinyGEdgeNextModel({ start: 'boot', bootMs: 0 }) }));

    const session = new GuardedTransport(new WebSerialTransport(port));
    await session.open(SESSION_OPEN_OPTIONS);
    expect(port.signalLog).toEqual(RTS_ONLY);
    await session.close();

    const reconnect = new GuardedTransport(new WebSerialTransport(port));
    await reconnect.open(SESSION_OPEN_OPTIONS);
    expect(port.signalLog).toEqual([...RTS_ONLY, ...RTS_ONLY]);
    await reconnect.close();

    const bootloader = new BootloaderLink(new WebSerialTransport(port), clock, X192A3);
    await bootloader.open(mintBootloaderCapability());
    expect(port.signalLog).toEqual([...RTS_ONLY, ...RTS_ONLY, ...RTS_ONLY]);
    expect(port.outputSignals()).toEqual({ dataTerminalReady: false, requestToSend: true, break: false });
    await bootloader.close();
  });
});
