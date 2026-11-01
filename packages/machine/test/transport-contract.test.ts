/**
 * The Transport contract itself (ROADMAP P0-12; SAFETY H2b: "the Transport
 * has no abort()"). The interface and `GuardedTransport` are pinned to an
 * exact member list, at compile time and at run time, so adding a way to
 * cancel a write in progress (or any other member) fails here and needs a
 * safety review. Lint already bans the name in this package (P0-02).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import * as machine from '../src/index.ts';
import { GuardedTransport } from '../src/guardedTransport.ts';
import type { Transport } from '../src/transport.ts';

const TRANSPORT_MEMBERS = ['close', 'info', 'onDisconnect', 'open', 'readable', 'writeLine'] as const;

describe('Transport interface', () => {
  it('has exactly the reviewed members', () => {
    expectTypeOf<keyof Transport>().toEqualTypeOf<(typeof TRANSPORT_MEMBERS)[number]>();
  });

  it('GuardedTransport adds only read-only state and a tighten-only line cap to it', () => {
    const own = Object.getOwnPropertyNames(GuardedTransport.prototype).sort();
    expect(own).toEqual(['constructor', ...TRANSPORT_MEMBERS, 'state', 'writeFailed', 'disconnected', 'maxLineBytes', 'tightenLineCap'].sort());
    for (const getter of ['state', 'writeFailed', 'disconnected', 'maxLineBytes']) {
      const d = Object.getOwnPropertyDescriptor(GuardedTransport.prototype, getter);
      expect(d?.get, getter).toBeTypeOf('function');
      expect(d?.set, getter).toBeUndefined();
    }
  });

  it('GuardedTransport is a Transport', () => {
    expectTypeOf<GuardedTransport>().toMatchTypeOf<Transport>();
  });
});

describe('package entry', () => {
  it('exports the guard, the policy and the shape check, and never the Web Serial transport', () => {
    expect(Object.keys(machine).sort()).toEqual(
      [
        'BOOTLOADER_PORTS',
        'BOOTLOADER_TOUCH_BAUD',
        'CAPABILITY_BAUD_RATES',
        'DUE_PROGRAMMING_PORT',
        'FULL_SESSION_FLOW_CONTROL',
        'GuardedTransport',
        'MAX_REALTIME_GROUP_BYTES',
        'MAX_WRITE_LINE_BYTES',
        'REALTIME_BYTES',
        'REFUSED_PORTS',
        'SESSION_BAUD_RATES',
        'SESSION_OPEN_OPTIONS',
        'TRANSPORT_BUFFER_SIZE',
        'TransportRefusedError',
        'TransportWriteError',
        'VERSION',
        'capabilityBaudRatesOf',
        'classifyWrite',
        'decideOpen',
        'isPortSelector',
        'refusedPortsOf',
        'sessionOpenOptionsFor',
        'sharedSessionOptions',
        'writeLineCapFor',
        // The read-only machine session (P1-02).
        'DEFAULT_TIMINGS',
        'MAX_PROBE_RESTARTS',
        'MAX_QUEUED_READS',
        'MachineSession',
        'PROBE_TOKENS',
        'READING_TOKENS',
        'SESSION_BASES',
        'SNAPSHOT_STRING_MAX',
        'VERIFY_TOKENS',
        'checkWrite',
        'dialectOf',
        'enqAllowedNow',
        'escape',
        'initialState',
        'matrixSnapshot',
        'phase1WriteVerdict',
        'probeRecord',
        'readableNow',
        'reduce',
        'snapshotOf',
      ].sort(),
    );
  });

  it('exposes the Web Serial transport only on its own subpath, which only the machine worker seam may import (dependency-cruiser)', () => {
    expect((pkg as { exports: object }).exports).toEqual({ '.': './src/index.ts', './web-serial-transport': './src/webSerialTransport.ts' });
  });

  it('declares its runtime workspace edges as dependencies and keeps the test kit a dev dependency', () => {
    expect(Object.keys((pkg as { dependencies?: object }).dependencies ?? {}).sort()).toEqual(['@synthetos/flasher', '@synthetos/protocol', '@synthetos/safety', '@synthetos/schema']);
    expect(Object.keys((pkg as { devDependencies?: object }).devDependencies ?? {}).sort()).toEqual(['@synthetos/testkit']);
  });
});
