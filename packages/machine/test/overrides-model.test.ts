import { expect, it } from 'vitest';
import { clampOverride, validOverride, overrideLine, parseOverrideLine, overrideView, supportsOverrides, OVERRIDE_TOKENS } from '../src/session/overrides/model.ts';
import { overrideDecision, overrideWrite } from '../src/session/overrides/policy.ts';
import { overrideState, CONFIG } from './overridesFixture.ts';
it('bounds both overrides and admits only the two exact factor shapes', () => {
  for (const channel of ['feed', 'spindle'] as const) {
    expect(clampOverride(-100)).toBe(10); expect(clampOverride(900)).toBe(150);
    expect(clampOverride(114)).toBe(110);
    for (let percent = 10; percent <= 150; percent += 10) {
      const request = { channel, percent };
      expect(validOverride(request)).toBe(true);
      expect(parseOverrideLine(overrideLine(request))).toEqual(request);
    }
  }
  for (const value of [null, 1, {}, { channel: 'rapid', percent: 100 }, { channel: 'feed', percent: NaN }, { channel: 'feed', percent: 0 }, { channel: 'feed', percent: 160 }, { channel: 'feed', percent: 115 }, { channel: 'feed', percent: '100' }]) expect(validOverride(value)).toBe(false);
  for (const line of ['{"mfo":1}', '{"rt":{"mfo":2}}', '{"rt":{"mfoe":1}}', '{"rt":{"sso":0}}']) expect(parseOverrideLine(line)).toBeNull();
});
it('reads only current, successful, finite board values; booleans are accepted for flags', () => {
  const s = overrideState();
  expect(overrideView(s)?.feed).toEqual({ requested: 100, effective: 100, capped: false, permitted: true });
  expect(overrideView({ ...s, values: { ...s.values, mcp: { value: true, at: 100, status: 0 } } })?.feed.capped).toBe(true);
  expect(overrideView({ ...s, identity: { ...s.identity!, fb: 450.05 } })).toBeNull();
  expect(supportsOverrides({ ...s, identity: null })).toBe(false);
  expect(supportsOverrides({ ...s, dialect: null })).toBe(false);
  for (const entry of [undefined, { value: 1, at: -1, status: 0 }, { value: 1, at: 100, status: 110 }, { value: 'bad', at: 100, status: 0 }, { value: Infinity, at: 100, status: 0 }]) {
    const values = { ...s.values }; delete values.mfo;
    if (entry) values.mfo = entry;
    expect(overrideView({ ...s, values })?.feed.requested).toBeNull();
  }
  expect(overrideView({ ...s, overrides: undefined })?.feed.requested).toBeNull();
  expect(overrideView({ ...s, live: { ...s.live, lastRxAt: 3000 } })?.spindle.effective).toBeNull();
  expect(overrideView({ ...s, live: { ...s.live, lastRxAt: 0 } })?.spindle.effective).toBe(100);
  expect(OVERRIDE_TOKENS).toHaveLength(8);
});
it('requires full 450.06, this job, line mode, fresh values and permission, with every overlay intact', () => {
  const s = overrideState(), request = { channel: 'feed' as const, percent: 120 };
  expect(overrideDecision(s, CONFIG.release, request).allowed).toBe(true);
  for (const patch of [
    { overlays: ['UNKNOWN'] as const }, { identity: { ...s.identity!, fb: 450.05 } }, { classification: null }, { job: null },
    { job: { ...s.job!, phase: 'done' as const } }, { job: { ...s.job!, stopping: true } }, { footerRev: 2 as const },
    { rxm: { ...s.rxm, current: 0 as const } }, { values: {} }, { values: { mfo: s.values.mfo!, mfc: s.values.mfc! } }, { values: { ...s.values, mfe: { value: 0, at: 100, status: 0 } } },
  ]) expect(overrideDecision({ ...s, ...patch }, CONFIG.release, request).allowed).toBe(false);
  const line = overrideLine(request), emitted = { ...s, overrides: { ...s.overrides!, pending: line } };
  const item = { epoch: 1, seq: 1, bytes: new TextEncoder().encode(line+'\n'), emitted, jobRuntime: true as const };
  expect(overrideWrite(emitted, emitted, CONFIG.release, item)).toBeUndefined();
  expect(overrideWrite(s, emitted, CONFIG.release, item)?.kind).toBe('denied');
  expect(overrideWrite({ ...emitted, overlays: ['FAULT'] }, emitted, CONFIG.release, item)?.kind).toBe('denied');
  expect(overrideWrite(emitted, emitted, CONFIG.release, { ...item, bytes: new TextEncoder().encode(line) })?.kind).toBe('refused');
  expect(overrideWrite(emitted, s, CONFIG.release, item)?.kind).toBe('refused');
  const { jobRuntime: _, ...plain } = item;
  expect(overrideWrite(emitted, emitted, CONFIG.release, plain)?.kind).toBe('refused');
});

it('can project an unobserved link without inventing a firmware value', () => {
  const s = overrideState();
  const { lastRxAt: _at, ...unobserved } = s.live;
  expect(overrideView({ ...s, live: unobserved, values: {} })?.feed.requested).toBeNull();
});
