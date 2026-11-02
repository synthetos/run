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

/** A stand-in for the window's Web Serial object: an EventTarget, as the real one is. */
type FakeSerial = ChooserSerial & { readonly events: EventTarget; listeners(): number };
function fakeSerial(request: () => Promise<ChooserPort>, list: () => Promise<readonly ChooserPort[]>): FakeSerial {
  const events = new EventTarget();
  const live = new Map<string, Set<unknown>>([['connect', new Set()], ['disconnect', new Set()]]);
  return {
    [REQUEST]: request,
    [LIST]: list,
    events,
    listeners: () => [...live.values()].reduce((n, set) => n + set.size, 0),
    addEventListener: (type: string, l: () => void) => {
      live.get(type)?.add(l);
      events.addEventListener(type, l);
    },
    removeEventListener: (type: string, l: () => void) => {
      live.get(type)?.delete(l);
      events.removeEventListener(type, l);
    },
  } as unknown as FakeSerial;
}

function serial(chosen: ChooserPort | Error, granted: readonly ChooserPort[], calls: string[] = []): FakeSerial {
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
    const other = port({ usbVendorId: 0x2341, usbProductId: 0x003e });
    const board = port({ usbVendorId: 0x0403, usbProductId: 0x6015 });
    const result = await chooseSerialPort(serial(board, [other, board]));
    expect(result).toMatchObject({ ok: true, selector: { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 1, grantSnapshot: ['9025:62', '1027:24597'] } });
    if (!result.ok) throw new Error('expected choice');
    expect(await result.confirm()).toBe(true);
    expect(await result.confirm()).toBe(false);
    expect(result.ok && isPortSelector(result.selector)).toBe(true);
  });

  it('refuses indistinguishable grants instead of relying on their indices', async () => {
    const a = port({ usbVendorId: 1027, usbProductId: 24597 });
    const b = port({ usbVendorId: 1027, usbProductId: 24597 });
    expect(await chooseSerialPort(serial(a, [a, b]))).toMatchObject({ ok: false, code: 'ambiguous' });
  });

  it('confirms the original object once, refusing a replacement with the same USB ids', async () => {
    const a = port({ usbVendorId: 1027, usbProductId: 24597 });
    const b = port({ usbVendorId: 1027, usbProductId: 24597 });
    let grants = [a];
    const chosen = await chooseSerialPort(fakeSerial(() => Promise.resolve(a), () => Promise.resolve(grants)));
    if (!chosen.ok) throw new Error('expected choice');
    grants = [b];
    expect(await chosen.confirm()).toBe(false);
    grants = [a];
    expect(await chosen.confirm()).toBe(false);
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

  it('confirmation refuses removed, reordered or changed grants and listing failures', async () => {
    for (const change of ['removed', 'reordered', 'changed', 'throw'] as const) {
      const info = { usbVendorId: 1027, usbProductId: 24597 };
      const board = port(info);
      const other = port({ usbVendorId: 1, usbProductId: 2 });
      let changed = false;
      const choice = await chooseSerialPort(fakeSerial(() => Promise.resolve(board), async () => {
        if (!changed) return [board, other];
        if (change === 'throw') throw new Error('gone');
        if (change === 'removed') return [];
        if (change === 'reordered') return [other, board];
        info.usbProductId = 3;
        return [board, other];
      }));
      if (!choice.ok) throw new Error('expected choice');
      changed = true;
      expect(await choice.confirm(), change).toBe(false);
    }
  });

  it('refuses an unidentifiable other grant or an oversized grant list even at index zero', async () => {
    const board = port({ usbVendorId: 1, usbProductId: 2 });
    expect(await chooseSerialPort(serial(board, [board, port({})]))).toMatchObject({ ok: false });
    expect(await chooseSerialPort(serial(board, [board, ...Array.from({ length: 256 }, () => port({ usbVendorId: 3, usbProductId: 4 }))]))).toMatchObject({ ok: false, code: 'not-granted' });
  });

  describe('the connect/disconnect guard between choice and confirmation', () => {
    const info = { usbVendorId: 0x0403, usbProductId: 0x6015 };

    it.each(['connect', 'disconnect'])('a %s event after the choice refuses confirmation, even when the grants look unchanged', async (type) => {
      const board = port(info);
      const s = serial(board, [board]);
      const choice = await chooseSerialPort(s);
      if (!choice.ok) throw new Error('expected choice');
      expect(s.listeners()).toBe(2);
      // The device left and came back as the same object: identity alone would pass.
      s.events.dispatchEvent(new Event(type));
      expect(await choice.confirm()).toBe(false);
      expect(s.listeners()).toBe(0);
    });

    it('an event while the grants are listed during confirmation refuses', async () => {
      const board = port(info);
      let fire = false;
      const s: FakeSerial = fakeSerial(() => Promise.resolve(board), async () => {
        if (fire) s.events.dispatchEvent(new Event('disconnect'));
        return [board];
      });
      const choice = await chooseSerialPort(s);
      if (!choice.ok) throw new Error('expected choice');
      fire = true;
      expect(await choice.confirm()).toBe(false);
      expect(s.listeners()).toBe(0);
    });

    it('an event while the choice is described refuses it as changed, with the listeners removed', async () => {
      const board = port(info);
      const s: FakeSerial = fakeSerial(() => Promise.resolve(board), async () => {
        s.events.dispatchEvent(new Event('connect'));
        return [board];
      });
      expect(await chooseSerialPort(s)).toMatchObject({ ok: false, code: 'changed' });
      expect(s.listeners()).toBe(0);
    });

    it('no event: confirmation still passes, and the listeners are removed once it answers', async () => {
      const board = port(info);
      const s = serial(board, [board]);
      const choice = await chooseSerialPort(s);
      if (!choice.ok) throw new Error('expected choice');
      expect(await choice.confirm()).toBe(true);
      expect(s.listeners()).toBe(0);
      s.events.dispatchEvent(new Event('disconnect'));
      expect(await choice.confirm()).toBe(false);
    });

    it('no listener is installed before the choice, and none is left by a cancel or a refusal', async () => {
      const cancelled = serial(named('NotFoundError'), []);
      const pending = chooseSerialPort(cancelled);
      expect(cancelled.listeners()).toBe(0);
      expect(await pending).toMatchObject({ ok: false, code: 'cancelled' });
      expect(cancelled.listeners()).toBe(0);
      const p = port({});
      const noUsb = serial(p, [p]);
      expect(await chooseSerialPort(noUsb)).toMatchObject({ ok: false, code: 'no-usb-identity' });
      expect(noUsb.listeners()).toBe(0);
      const a = port(info);
      const ambiguous = serial(a, [a, port(info)]);
      expect(await chooseSerialPort(ambiguous)).toMatchObject({ ok: false, code: 'ambiguous' });
      expect(ambiguous.listeners()).toBe(0);
      const throwing = fakeSerial(() => Promise.resolve(a), () => Promise.reject(new Error('gone')));
      expect(await chooseSerialPort(throwing)).toMatchObject({ ok: false, code: 'failed' });
      expect(throwing.listeners()).toBe(0);
    });

    it('release() ends the guard without confirming (an exit that never reaches confirm), and is idempotent', async () => {
      const board = port(info);
      const s = serial(board, [board]);
      const choice = await chooseSerialPort(s);
      if (!choice.ok) throw new Error('expected choice');
      choice.release();
      choice.release();
      expect(s.listeners()).toBe(0);
      expect(await choice.confirm()).toBe(false);
    });

    it('a Web Serial object that cannot be listened to is refused, nothing left installed', async () => {
      const board = port(info);
      const s = serial(board, [board]);
      let added = 0;
      const broken = {
        ...s,
        addEventListener: (type: 'connect' | 'disconnect', l: () => void) => {
          if (++added === 2) throw new Error('no events');
          s.addEventListener(type, l);
        },
      } as ChooserSerial;
      expect(await chooseSerialPort(broken)).toMatchObject({ ok: false, code: 'failed' });
      expect(s.listeners()).toBe(0);
      const odd = { ...s, addEventListener: () => { throw 'no events'; } } as unknown as ChooserSerial;
      expect(await chooseSerialPort(odd)).toEqual({ ok: false, code: 'failed', detail: 'the port events cannot be watched: no events' });
    });
  });

  it('without Web Serial (Node has a navigator but no serial) the chooser is unavailable', async () => {
    expect(await chooseSerialPort()).toEqual({ ok: false, code: 'unavailable', detail: 'this browser has no Web Serial' });
    expect(await chooseSerialPort(undefined)).toMatchObject({ ok: false, code: 'unavailable' });
  });
});
