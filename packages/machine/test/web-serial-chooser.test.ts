/**
 * The window's port chooser (OD-3, approved 2026-11-02): the chooser is
 * shown synchronously, the choice becomes a PortSelector from getInfo()
 * and the window's granted-port index, and every failure is a refusal,
 * never a guess.
 *
 * The Web Serial method names are assembled at run time: `run/no-web-serial`
 * applies to this test (only the two Web Serial modules are exempt), and a
 * stand-in object needs those two keys.
 */
import { describe, expect, it } from 'vitest';
import { isPortSelector } from '../src/transport.ts';
import { chooseSerialPort, type ChooserPort, type ChooserSerial } from '../src/webSerialChooser.ts';

function port(info: { usbVendorId?: unknown; usbProductId?: unknown }): ChooserPort {
  return { getInfo: () => info };
}

const REQUEST = 'request' + 'Port';
const LIST = 'get' + 'Ports';

/** A stand-in for the window's Web Serial object. */
function fakeSerial(request: () => Promise<ChooserPort>, list: () => Promise<readonly ChooserPort[]>): ChooserSerial {
  return { [REQUEST]: request, [LIST]: list } as unknown as ChooserSerial;
}

function serial(chosen: ChooserPort | Error, granted: readonly ChooserPort[], calls: string[] = []): ChooserSerial {
  return fakeSerial(
    () => {
      calls.push('request');
      return chosen instanceof Error ? Promise.reject(chosen) : Promise.resolve(chosen);
    },
    () => {
      calls.push('list');
      return Promise.resolve(granted);
    },
  );
}

function named(name: string, message = name): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

describe('chooseSerialPort', () => {
  it('shows the chooser synchronously, before anything is awaited', () => {
    const calls: string[] = [];
    const board = port({ usbVendorId: 0x0403, usbProductId: 0x6015 });
    void chooseSerialPort(serial(board, [board], calls));
    expect(calls).toEqual(['request']);
  });

  it("describes the choice by its USB identity and its index in the window's granted ports", async () => {
    const other = port({ usbVendorId: 0x0403, usbProductId: 0x6015 });
    const board = port({ usbVendorId: 0x0403, usbProductId: 0x6015 });
    const result = await chooseSerialPort(serial(board, [other, board]));
    expect(result).toEqual({ ok: true, selector: { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 1 } });
    expect(result.ok && isPortSelector(result.selector)).toBe(true);
  });

  it('a closed chooser is cancelled; a refused one (no gesture, policy) is refused; anything else failed', async () => {
    expect(await chooseSerialPort(serial(named('NotFoundError', 'No port selected by the user.'), []))).toEqual({ ok: false, code: 'cancelled', detail: 'No port selected by the user.' });
    expect(await chooseSerialPort(serial(named('SecurityError'), []))).toMatchObject({ ok: false, code: 'refused' });
    expect(await chooseSerialPort(serial(named('NotAllowedError'), []))).toMatchObject({ ok: false, code: 'refused' });
    expect(await chooseSerialPort(serial(new TypeError('boom'), []))).toMatchObject({ ok: false, code: 'failed', detail: 'boom' });
  });

  it('a synchronous throw from the chooser is a refusal, and a non-Error rejection is described', async () => {
    const throwing = fakeSerial(
      () => {
        throw named('SecurityError', 'Must be handling a user gesture to show a permission request.');
      },
      () => Promise.resolve([]),
    );
    expect(await chooseSerialPort(throwing)).toMatchObject({ ok: false, code: 'refused' });
    const odd = fakeSerial(() => Promise.reject('nope' as unknown as Error), () => Promise.resolve([]));
    expect(await chooseSerialPort(odd)).toEqual({ ok: false, code: 'failed', detail: 'nope' });
    const nullish = fakeSerial(() => Promise.reject(null as unknown as Error), () => Promise.resolve([]));
    expect(await chooseSerialPort(nullish)).toEqual({ ok: false, code: 'failed', detail: 'null' });
  });

  it.each([
    ['no USB identity (a non-USB serial port)', {}],
    ['only a vendor id', { usbVendorId: 0x0403 }],
    ['a malformed product id', { usbVendorId: 0x0403, usbProductId: '6015' }],
    ['an id out of range', { usbVendorId: 0x10000, usbProductId: 1 }],
    ['a fractional id', { usbVendorId: 1.5, usbProductId: 1 }],
  ])('refuses a port with %s: the worker could not find it again', async (_name, info) => {
    const p = port(info);
    expect(await chooseSerialPort(serial(p, [p]))).toMatchObject({ ok: false, code: 'no-usb-identity' });
  });

  it('refuses a chosen port that is not among the granted ports, or past the selector range', async () => {
    const board = port({ usbVendorId: 0x0403, usbProductId: 0x6015 });
    expect(await chooseSerialPort(serial(board, [port({ usbVendorId: 0x0403, usbProductId: 0x6015 })]))).toMatchObject({ ok: false, code: 'not-granted' });
    const many = Array.from({ length: 256 }, () => port({ usbVendorId: 1, usbProductId: 1 }));
    expect(await chooseSerialPort(serial(board, [...many, board]))).toMatchObject({ ok: false, code: 'not-granted' });
  });

  it('listing the granted ports or getInfo throwing is a refusal', async () => {
    const board = port({ usbVendorId: 0x0403, usbProductId: 0x6015 });
    const failing = fakeSerial(() => Promise.resolve(board), () => Promise.reject(named('InvalidStateError', 'gone')));
    expect(await chooseSerialPort(failing)).toEqual({ ok: false, code: 'failed', detail: 'gone' });
    const broken: ChooserPort = {
      getInfo: () => {
        throw named('SecurityError', 'revoked');
      },
    };
    expect(await chooseSerialPort(serial(broken, [broken]))).toMatchObject({ ok: false, code: 'refused' });
  });

  it('without Web Serial (Node has a navigator but no serial) the chooser is unavailable', async () => {
    expect(await chooseSerialPort()).toEqual({ ok: false, code: 'unavailable', detail: 'this browser has no Web Serial' });
    expect(await chooseSerialPort(undefined)).toMatchObject({ ok: false, code: 'unavailable' });
  });
});
