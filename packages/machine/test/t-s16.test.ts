/**
 * T-S16 (SAFETY §10; OLD-S T-S16): "1200 baud open throws without the
 * token; 2341:003D refused before open". Both are asserted through the real
 * `GuardedTransport`, and every refusal is shown to happen before the inner
 * port's `open` is called.
 */
import { G2CORE_EDGE } from '@synthetos/protocol';
import { mintBootloaderCapability, type BootloaderCapability } from '@synthetos/flasher/bootloader-capability';
import { describe, expect, it } from 'vitest';
import { GuardedTransport, TransportRefusedError } from '../src/guardedTransport.ts';
import {
  BOOTLOADER_PORTS,
  BOOTLOADER_TOUCH_BAUD,
  CAPABILITY_BAUD_RATES,
  DUE_PROGRAMMING_PORT,
  REFUSED_PORTS,
  SESSION_BAUD_RATES,
  TRANSPORT_BUFFER_SIZE,
  capabilityBaudRatesOf,
  decideOpen,
  refusedPortsOf,
} from '../src/openPolicy.ts';
import { FakeTransport, SESSION_OPTIONS } from './fakeTransport.ts';

const G2_NATIVE = { kind: 'serial', usbVendorId: 0x1d50, usbProductId: 0x606d } as const;
const TINYG_FTDI = { kind: 'serial', usbVendorId: 0x0403, usbProductId: 0x6015 } as const;
const DUE_PROG = { kind: 'serial', usbVendorId: 0x2341, usbProductId: 0x003d } as const;
const SAM_BA = { kind: 'serial', usbVendorId: 0x03eb, usbProductId: 0x6124 } as const;
const AT_1200 = { ...SESSION_OPTIONS, baudRate: 1200 } as const;

async function refusal(promise: Promise<unknown>): Promise<TransportRefusedError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(TransportRefusedError);
  return error as TransportRefusedError;
}

describe('T-S16: 1200 baud needs the bootloader capability', () => {
  it('throws without the token, and the inner port is never opened', async () => {
    for (const info of [G2_NATIVE, TINYG_FTDI, { kind: 'sim' } as const]) {
      const inner = new FakeTransport(info);
      const t = new GuardedTransport(inner);
      const e = await refusal(t.open(AT_1200));
      expect(e.code).toBe('capability-required');
      expect(inner.opens()).toBe(0);
      expect(t.state).toBe('new');
    }
  });

  it('throws with a forged token (shape is not enough) and never opens', async () => {
    const inner = new FakeTransport(G2_NATIVE);
    const t = new GuardedTransport(inner);
    const forged = Object.freeze(Object.create(null)) as BootloaderCapability;
    expect((await refusal(t.open(AT_1200, forged))).code).toBe('invalid-capability');
    expect((await refusal(t.open(AT_1200, {} as BootloaderCapability))).code).toBe('invalid-capability');
    expect(inner.opens()).toBe(0);
  });

  it('opens at 1200 with a token minted by the flasher, passing only the options to the port', async () => {
    const inner = new FakeTransport(G2_NATIVE);
    const t = new GuardedTransport(inner);
    await t.open(AT_1200, mintBootloaderCapability());
    expect(inner.calls).toEqual([{ op: 'open', options: AT_1200, args: 1 }]);
    expect(t.state).toBe('open');
  });

  it('a token is single use: the second open with it is refused', async () => {
    const token = mintBootloaderCapability();
    await new GuardedTransport(new FakeTransport(G2_NATIVE)).open(AT_1200, token);
    const inner = new FakeTransport(G2_NATIVE);
    expect((await refusal(new GuardedTransport(inner).open(AT_1200, token))).code).toBe('invalid-capability');
    expect(inner.opens()).toBe(0);
  });

  it('a token presented to a refused open is still used up', async () => {
    const token = mintBootloaderCapability();
    expect((await refusal(new GuardedTransport(new FakeTransport(DUE_PROG)).open(AT_1200, token))).code).toBe('refused-port');
    expect((await refusal(new GuardedTransport(new FakeTransport(G2_NATIVE)).open(AT_1200, token))).code).toBe('invalid-capability');
  });

  it('a token presented to an already-opened transport is still used up', async () => {
    const opened = new GuardedTransport(new FakeTransport(G2_NATIVE));
    await opened.open(SESSION_OPTIONS);
    const token = mintBootloaderCapability();
    expect((await refusal(opened.open(AT_1200, token))).code).toBe('already-opened');
    const inner = new FakeTransport(G2_NATIVE);
    expect((await refusal(new GuardedTransport(inner).open(AT_1200, token))).code).toBe('invalid-capability');
    expect(inner.opens()).toBe(0);
  });

  it('refuses a token on an ordinary 115200 open (it would hide a flasher bug)', async () => {
    const inner = new FakeTransport(TINYG_FTDI);
    expect((await refusal(new GuardedTransport(inner).open(SESSION_OPTIONS, mintBootloaderCapability()))).code).toBe('unexpected-capability');
    expect(inner.opens()).toBe(0);
  });

  it('1200 is in the capability set even though it is also stated in the dialect data', () => {
    expect(BOOTLOADER_TOUCH_BAUD).toBe(1200);
    expect(CAPABILITY_BAUD_RATES.has(1200)).toBe(true);
    expect(G2CORE_EDGE.transport.refuseBaudRates).toContain(1200);
    expect(SESSION_BAUD_RATES.has(1200)).toBe(false);
  });

  it('1200 still needs the capability if the dialect data stopped listing it', () => {
    expect(capabilityBaudRatesOf([])).toEqual(new Set([1200]));
  });
});

describe('T-S16: the Due programming port 2341:003D is refused before open', () => {
  it('is refused at every baud rate, with or without a token, and never opened', async () => {
    for (const [options, token] of [
      [SESSION_OPTIONS, undefined],
      [AT_1200, undefined],
      [AT_1200, mintBootloaderCapability()],
    ] as const) {
      const inner = new FakeTransport(DUE_PROG);
      const t = new GuardedTransport(inner);
      const e = await refusal(t.open(options, token));
      expect(e.code).toBe('refused-port');
      expect(e.message).toContain('2341:003d');
      expect(inner.opens()).toBe(0);
    }
  });

  it('is on the refusal list from the g2core data and directly', () => {
    expect(DUE_PROGRAMMING_PORT).toEqual({ vendorId: 0x2341, productId: 0x003d });
    expect(G2CORE_EDGE.transport.usb).toContainEqual(expect.objectContaining({ vendorId: 0x2341, productId: 0x003d, role: 'refuse' }));
    expect(REFUSED_PORTS.filter((u) => u.vendorId === 0x2341 && u.productId === 0x003d).length).toBeGreaterThanOrEqual(1);
    expect(REFUSED_PORTS.every((u) => u.role === 'refuse')).toBe(true);
  });

  it('stays refused if the dialect data stopped listing it', () => {
    expect(refusedPortsOf([])).toEqual([{ vendorId: 0x2341, productId: 0x003d, role: 'refuse', label: 'Arduino Due programming port' }]);
  });

  it('the refusal does not depend on the order of checks: a bad baud rate on that port still reports the port', () => {
    expect(decideOpen(DUE_PROG, { ...SESSION_OPTIONS, baudRate: 9600 }, false)).toMatchObject({ ok: false, reason: 'refused-port' });
  });
});

describe('the rest of the open policy', () => {
  it('opens the TinyG and g2core control ports at 115200 without a token', async () => {
    for (const info of [TINYG_FTDI, G2_NATIVE, { kind: 'serial' } as const, { kind: 'replay' } as const]) {
      const inner = new FakeTransport(info);
      await new GuardedTransport(inner).open(SESSION_OPTIONS);
      expect(inner.opens()).toBe(1);
    }
  });

  it('opens the SAM-BA bootloader port only with a token', async () => {
    expect(BOOTLOADER_PORTS).toContainEqual(expect.objectContaining({ vendorId: 0x03eb, productId: 0x6124 }));
    const inner = new FakeTransport(SAM_BA);
    const e = await refusal(new GuardedTransport(inner).open(SESSION_OPTIONS));
    expect(e.code).toBe('capability-required');
    expect(e.message).toContain('bootloader port 03eb:6124');
    expect(inner.opens()).toBe(0);
    await new GuardedTransport(inner).open(SESSION_OPTIONS, mintBootloaderCapability());
    expect(inner.opens()).toBe(1);
  });

  it.each([9600, 57600, 230400, 0, -115200, Number.NaN, 115200.5])('refuses baud rate %s', async (baudRate) => {
    const inner = new FakeTransport(TINYG_FTDI);
    expect((await refusal(new GuardedTransport(inner).open({ ...SESSION_OPTIONS, baudRate }))).code).toBe('baud-rate');
    expect(inner.opens()).toBe(0);
  });

  it("refuses flowControl 'hardware' (PN §7.4, B-FC-1)", async () => {
    const inner = new FakeTransport(TINYG_FTDI);
    expect((await refusal(new GuardedTransport(inner).open({ ...SESSION_OPTIONS, flowControl: 'hardware' }))).code).toBe('flow-control');
    expect(inner.opens()).toBe(0);
  });

  it.each([255, 257, 4096, 0])('refuses bufferSize %s; only 256', async (bufferSize) => {
    expect(TRANSPORT_BUFFER_SIZE).toBe(256);
    const inner = new FakeTransport(TINYG_FTDI);
    expect((await refusal(new GuardedTransport(inner).open({ ...SESSION_OPTIONS, bufferSize }))).code).toBe('buffer-size');
    expect(inner.opens()).toBe(0);
  });

  it('refuses a half-known or malformed USB identity, which cannot be checked against the list', async () => {
    for (const info of [
      { kind: 'serial', usbVendorId: 0x2341 },
      { kind: 'serial', usbProductId: 0x003d },
      { kind: 'serial', usbVendorId: 0x12341, usbProductId: 0x003d },
      { kind: 'serial', usbVendorId: 0x2341, usbProductId: -1 },
      { kind: 'serial', usbVendorId: 0x2341, usbProductId: 61.5 },
    ] as const) {
      const inner = new FakeTransport(info);
      expect((await refusal(new GuardedTransport(inner).open(SESSION_OPTIONS))).code).toBe('invalid-port-identity');
      expect(inner.opens()).toBe(0);
    }
  });

  it('reads each option once, so a getter cannot pass the check and then send something else', async () => {
    let reads = 0;
    const tricky = {
      get baudRate(): number {
        reads++;
        return reads === 1 ? 115200 : 1200;
      },
      flowControl: 'none',
      bufferSize: 256,
    } as const;
    const inner = new FakeTransport(G2_NATIVE);
    await new GuardedTransport(inner).open(tricky);
    expect(inner.calls[0]).toEqual({ op: 'open', options: { baudRate: 115200, flowControl: 'none', bufferSize: 256 }, args: 1 });
    expect(Object.isFrozen((inner.calls[0] as { options: object }).options)).toBe(true);
  });

  it('checks the identity the link reports at open time', async () => {
    const inner = new FakeTransport(TINYG_FTDI);
    const t = new GuardedTransport(inner);
    inner.setInfo(DUE_PROG);
    expect((await refusal(t.open(SESSION_OPTIONS))).code).toBe('refused-port');
    expect(inner.opens()).toBe(0);
  });
});
