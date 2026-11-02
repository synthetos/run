/**
 * P0 review fixes in the machine package: the dialect-derived line cap, the
 * session open options from dialect data, the port selector, and the
 * disconnect flag that cannot be missed during open.
 */
import { DIALECTS, G2CORE_EDGE, TINYG_EN, type Dialect } from '@synthetos/protocol';
import { describe, expect, it } from 'vitest';
import { GuardedTransport, TransportRefusedError } from '../src/guardedTransport.ts';
import { SESSION_BAUD_RATES, SESSION_OPEN_OPTIONS, TRANSPORT_BUFFER_SIZE, sessionOpenOptionsFor, sharedSessionOptions } from '../src/openPolicy.ts';
import { isPortSelector } from '../src/transport.ts';
import { MAX_WRITE_LINE_BYTES, writeLineCapFor } from '../src/writeShape.ts';
import { FakeTransport, SESSION_OPTIONS, enc } from './fakeTransport.ts';

describe('line cap on the guard (RUN_PLAN §5.1 rule 5)', () => {
  it('defaults to the cross-dialect maximum, and tightens to the classified dialect', async () => {
    const inner = new FakeTransport();
    const t = new GuardedTransport(inner);
    await t.open(SESSION_OPTIONS);
    expect(t.maxLineBytes).toBe(MAX_WRITE_LINE_BYTES);
    const line400 = enc(`${'G'.repeat(399)}\n`);
    await t.writeLine(line400); // a g2core-length line is accepted before classification
    t.tightenLineCap(writeLineCapFor(TINYG_EN));
    await expect(t.writeLine(line400)).rejects.toMatchObject({ code: 'invalid-write', rejection: 'too-long' });
    await t.writeLine(enc(`${'G'.repeat(254)}\n`));
    expect(inner.written()).toHaveLength(2);
  });

  it('only ever tightens, and refuses a malformed cap', () => {
    const t = new GuardedTransport(new FakeTransport(), { maxLineBytes: 255 });
    expect(t.maxLineBytes).toBe(255);
    expect(() => t.tightenLineCap(256)).toThrow(RangeError);
    expect(() => t.tightenLineCap(1)).toThrow(RangeError);
    expect(() => t.tightenLineCap(10.5)).toThrow(RangeError);
    t.tightenLineCap(121);
    expect(t.maxLineBytes).toBe(121);
    expect(() => new GuardedTransport(new FakeTransport(), { maxLineBytes: MAX_WRITE_LINE_BYTES + 1 })).toThrow(RangeError);
  });

  it('every dialect fits under the transport cap; g2core job and JSON lines are not refused mid-job', () => {
    for (const d of DIALECTS) expect(writeLineCapFor(d), d.id).toBeLessThanOrEqual(MAX_WRITE_LINE_BYTES);
    expect(writeLineCapFor(G2CORE_EDGE)).toBeGreaterThan(G2CORE_EDGE.limits.maxJsonLineBytes);
  });
});

describe('session open options come from dialect data', () => {
  it('SESSION_OPEN_OPTIONS uses the baud rate every dialect shares, and agrees with each dialect', () => {
    expect(SESSION_BAUD_RATES.size).toBe(1);
    for (const d of DIALECTS) {
      expect(SESSION_OPEN_OPTIONS.baudRate, d.id).toBe(d.transport.baudRate);
      expect(sessionOpenOptionsFor(d), d.id).toEqual({ baudRate: d.transport.baudRate, flowControl: 'none', bufferSize: TRANSPORT_BUFFER_SIZE });
    }
    expect(SESSION_OPTIONS).toBe(SESSION_OPEN_OPTIONS);
  });

  it('fails loudly, rather than guessing, if a dialect ever used another baud rate', () => {
    const odd: Dialect = { ...TINYG_EN, transport: { ...TINYG_EN.transport, baudRate: 250000 } };
    expect(() => sharedSessionOptions([TINYG_EN, odd])).toThrow(/do not share one session baud rate/);
    expect(() => sharedSessionOptions([])).toThrow();
    expect(sessionOpenOptionsFor(odd).baudRate).toBe(250000);
  });
});

describe('port selector (RUN_PLAN §5.4: the window chooses, the worker opens)', () => {
  it('accepts exactly {usbVendorId, usbProductId, grantIndex} with integers in range', () => {
    expect(isPortSelector({ usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0 })).toBe(true);
    for (const bad of [
      null,
      [],
      'x',
      {},
      { usbVendorId: 0x0403, usbProductId: 0x6015 },
      { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 0, extra: 1 },
      { usbVendorId: -1, usbProductId: 0x6015, grantIndex: 0 },
      { usbVendorId: 0x10000, usbProductId: 0x6015, grantIndex: 0 },
      { usbVendorId: 0x0403, usbProductId: 1.5, grantIndex: 0 },
      { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: -1 },
      { usbVendorId: 0x0403, usbProductId: 0x6015, grantIndex: 256 },
      { usbVendorId: '1027', usbProductId: 0x6015, grantIndex: 0 },
      Object.create({ usbVendorId: 1, usbProductId: 1, grantIndex: 0 }) as unknown,
    ]) {
      expect(isPortSelector(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('disconnected flag', () => {
  it('is set even when the link drops while open() is still pending, before any host callback exists', async () => {
    const inner = new FakeTransport();
    const t = new GuardedTransport(inner);
    const opening = t.open(SESSION_OPTIONS);
    inner.drop();
    await opening;
    expect(t.disconnected).toBe(true);
    await expect(t.writeLine(enc('G0\n'))).rejects.toBeInstanceOf(TransportRefusedError);
  });

  it('is false on a healthy link', async () => {
    const t = new GuardedTransport(new FakeTransport());
    await t.open(SESSION_OPTIONS);
    expect(t.disconnected).toBe(false);
  });
});


it('validates bounded ordered grant snapshots without accepting missing or malformed entries', () => {
  const port = { usbVendorId: 1027, usbProductId: 24597, grantIndex: 0 };
  expect(isPortSelector({ ...port, grantSnapshot: ['1027:24597'] })).toBe(true);
  for (const grantSnapshot of [undefined, null, '', [], Array(257).fill('1027:24597'), [1], ['bad'], ['65536:1'], ['1:65536'], ['01027:24597'], ['1027:24597', undefined], ['1:2']]) {
    expect(isPortSelector({ ...port, grantSnapshot }), String(grantSnapshot)).toBe(false);
  }
});
