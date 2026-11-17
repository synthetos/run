import { describe, expect, it } from 'vitest';
import { gateState, hostedOrigin, lockProps } from '../src/gate/gateState.ts';
import type { AccountState } from '../src/live/account.ts';

const st = (status: AccountState['status'], signIn: boolean): AccountState => ({ status, signIn, display: status === 'signed-in' ? '@owner' : null, message: null });

describe('gateState', () => {
  it('follows the spec table on a hosted origin', () => {
    expect(gateState(st('signed-in', true), true)).toBe('open');
    expect(gateState(st('signed-out', true), true)).toBe('sign-in');
    expect(gateState(st('signed-out', false), true)).toBe('not-offered');
    expect(gateState(st('checking', false), true)).toBe('checking');
    expect(gateState(st('unavailable', false), true)).toBe('unavailable');
  });
  it('locks a non-hosted origin only when the session read offers sign-in and nobody is signed in', () => {
    expect(gateState(st('signed-out', true), false)).toBe('sign-in');
    expect(gateState(st('signed-out', false), false)).toBe('open');
    expect(gateState(st('checking', false), false)).toBe('open');
    expect(gateState(st('unavailable', false), false)).toBe('open');
    expect(gateState(st('signed-in', true), false)).toBe('open');
  });
});

describe('hostedOrigin and lockProps', () => {
  it('names the two hosted origins and nothing else', () => {
    expect(hostedOrigin('https://run.synthetos.com')).toBe(true);
    expect(hostedOrigin('https://staging.run.synthetos.com')).toBe(true);
    expect(hostedOrigin('http://127.0.0.1:8793')).toBe(false);
    expect(hostedOrigin('http://localhost:5173')).toBe(false);
  });
  it('lockProps is inert for every locked kind', () => {
    expect(lockProps('open')).toEqual({});
    for (const k of ['checking', 'sign-in', 'not-offered', 'unavailable'] as const) expect(lockProps(k)).toEqual({ inert: true });
  });
});
