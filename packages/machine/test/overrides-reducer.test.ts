import { expect, it } from 'vitest';
import { classifyLine } from '@synthetos/protocol';
import { reduceOverrides } from '../src/session/overrides/reducer.ts';
import { overrideLine, type OverrideState } from '../src/session/overrides/model.ts';
import type { SessionEvent } from '../src/index.ts';
import { CONFIG, overrideState } from './overridesFixture.ts';
const quiet = (s = overrideState()): OverrideState => ({ ...s, base: 'HELD', job: { ...s.job!, phase: 'paused' }, live: { ...s.live, hold: 6, stat: 6 } });
const noop: SessionEvent = { type: 'lineModeMemory', epoch: -1, remembered: null };
it('rejects malformed requests and blockers, and reinitializes stale link memory', () => {
  const state = quiet();
  for (const value of [null, { channel: 'feed', percent: 200 }]) {
    const request = { intent: 'jobRuntime' as const, override: value };
    const r = reduceOverrides(CONFIG, state, { type: 'intent', request, at: 100 });
    expect(r.effects).toContainEqual(expect.objectContaining({ kind: 'decision', decision: expect.objectContaining({ allowed: false }) }));
  }
  const reset = reduceOverrides(CONFIG, { ...state, overrides: { ...state.overrides!, epoch: 0 } }, noop).state as OverrideState;
  expect(reset.overrides?.epoch).toBe(1);
  const crowded = { ...state, queue: Array.from({ length: 21 }, () => ({ token: 'sr', purpose: 'request' as const })), overrides: { ...state.overrides!, nextRead: 0 } };
  expect((reduceOverrides(CONFIG, crowded, noop).state as OverrideState).overrides?.nextRead).toBe(0);
});
it('handles 110/104 and other refusal statuses without replacing confirmed values', () => {
  for (const status of [0, 110, 104, 106]) {
    const line = overrideLine({ channel: 'feed', percent: 120 });
    const s = quiet();
    const queued = { token: 'rt', purpose: 'jobRuntime' as const, line, seq: 1 };
    const state = { ...s, writing: queued, overrides: { ...s.overrides!, pending: line } };
    const result = reduceOverrides(CONFIG, state, { type: 'inbound', epoch: 1, at: 100, event: classifyLine(JSON.stringify({ r: { rt: {} }, f: [3, status, 8] })) });
    const after = result.state as OverrideState;
    expect(after.overrides?.pending).toBeNull();
    expect(after.values.mfo?.value).toBe(1);
    expect(result.effects.some(e => e.kind === 'log' && e.text.includes('job flag'))).toBe(false);
    expect(after.overrides?.error).toEqual(status === 0 ? null : expect.any(String));
  }
});
it('a dropped write clears pending, and a reset discards prior override memory', () => {
  const s = quiet(), line = overrideLine({ channel: 'spindle', percent: 80 });
  const state = { ...s, writing: { token: 'rt', purpose: 'jobRuntime' as const, line, seq: 1 }, overrides: { ...s.overrides!, pending: line } };
  const dropped = reduceOverrides(CONFIG, state, { type: 'lineDropped', epoch: 1, seq: 1 });
  expect((dropped.state as OverrideState).overrides?.error).toMatch(/did not confirm/);
  const identifying = { ...state, base: 'IDENTIFYING' as const };
  expect((reduceOverrides(CONFIG, identifying, noop).state as OverrideState).overrides).toBeUndefined();
  const { lastRxAt: _at, ...unobserved } = s.live;
  expect((reduceOverrides(CONFIG, { ...s, live: unobserved }, noop).state as OverrideState).overrides).toBeDefined();
});

it('clears pending on a clean disconnect, and never mistakes a different pending line for this one', () => {
  const s = quiet(), line = overrideLine({ channel: 'feed', percent: 120 });
  const idle = { ...s, base: 'IDLE_UNHOMED' as const, job: null, overrides: { ...s.overrides!, pending: line } };
  const disconnected = reduceOverrides(CONFIG, idle, { type: 'intent', at: 100, request: { intent: 'disconnect' } });
  expect((disconnected.state as OverrideState).overrides).toBeUndefined();
  const waiting = { ...s, expected: [{ token: 'stat', purpose: 'request' as const, late: false }, { token: 'rt', purpose: 'jobRuntime' as const, line: '{"rt":{"job":1}}', late: false }], overrides: { ...s.overrides!, pending: line } };
  expect((reduceOverrides(CONFIG, waiting, noop).state as OverrideState).overrides?.pending).toBeNull();
});

it('keeps the single pending override while its transport write has not completed', () => {
  const s = quiet(), line = overrideLine({ channel: 'feed', percent: 120 });
  const state = { ...s, writing: { token: 'rt', purpose: 'jobRuntime' as const, line, seq: 1 }, overrides: { ...s.overrides!, pending: line } };
  expect((reduceOverrides(CONFIG, state, noop).state as OverrideState).overrides?.pending).toBe(line);
});

it('does not inject background override reads into an operator action or poll an already refreshed idle board', () => {
  const s = overrideState();
  const idle = { ...s, job: null, base: 'IDLE_UNHOMED' as const, overrides: { ...s.overrides!, nextRead: 0 } };
  expect((reduceOverrides(CONFIG, idle, noop).state as OverrideState).overrides?.nextRead).toBe(0);
  const action = reduceOverrides(CONFIG, { ...s, overrides: { ...s.overrides!, nextRead: 0 } }, { type: 'intent', request: { intent: 'feedhold' }, at: 100 });
  expect(action.effects.some(e => e.kind === 'writeLine' && e.token === 'mfo')).toBe(false);
});


it('legacy runtime replies without an override line keep their existing handling', () => {
  const s = quiet();
  for (const line of [undefined, '{"rt":{"job":1}}']) {
    const state = { ...s, job: null, writing: { token: 'rt', purpose: 'jobRuntime' as const, ...(line === undefined ? {} : { line }), seq: 1 } };
    const result = reduceOverrides(CONFIG, state, { type: 'inbound', epoch: 1, at: 100, event: classifyLine('{"r":{"rt":{}},"f":[3,0,8]}') });
    expect(result.state.expected).toEqual([]);
  }
});
