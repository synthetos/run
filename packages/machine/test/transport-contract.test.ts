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

  it('GuardedTransport adds only read-only state to it', () => {
    const own = Object.getOwnPropertyNames(GuardedTransport.prototype).sort();
    expect(own).toEqual(['constructor', ...TRANSPORT_MEMBERS, 'state', 'writeFailed'].sort());
    const state = Object.getOwnPropertyDescriptor(GuardedTransport.prototype, 'state');
    const failed = Object.getOwnPropertyDescriptor(GuardedTransport.prototype, 'writeFailed');
    expect(state?.set).toBeUndefined();
    expect(failed?.set).toBeUndefined();
  });

  it('GuardedTransport is a Transport', () => {
    expectTypeOf<GuardedTransport>().toMatchTypeOf<Transport>();
  });
});

describe('package entry', () => {
  it('exports the guard, the policy and the shape check, and no Web Serial transport (Phase 0)', () => {
    expect(Object.keys(machine).sort()).toEqual(
      [
        'BOOTLOADER_PORTS',
        'BOOTLOADER_TOUCH_BAUD',
        'CAPABILITY_BAUD_RATES',
        'DUE_PROGRAMMING_PORT',
        'GuardedTransport',
        'MAX_REALTIME_GROUP_BYTES',
        'MAX_WRITE_LINE_BYTES',
        'REALTIME_BYTES',
        'REFUSED_PORTS',
        'SESSION_BAUD_RATES',
        'TRANSPORT_BUFFER_SIZE',
        'TransportRefusedError',
        'TransportWriteError',
        'VERSION',
        'capabilityBaudRatesOf',
        'classifyWrite',
        'decideOpen',
        'refusedPortsOf',
      ].sort(),
    );
  });

  it('keeps every workspace package a dev dependency: no runtime dependencies at all', () => {
    expect(Object.keys((pkg as { devDependencies?: object }).devDependencies ?? {}).sort()).toEqual([
      '@synthetos/flasher',
      '@synthetos/protocol',
      '@synthetos/testkit',
    ]);
  });
});
