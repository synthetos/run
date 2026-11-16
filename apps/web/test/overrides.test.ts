import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { signal } from '@preact/signals';
import { expect, it } from 'vitest';
import { initialState, snapshotOf } from '@synthetos/machine';
import { OverrideControls, nextOverride, overrideVisible } from '../src/workspace/views/OverrideControls.ts';
import type { WorkspaceModel } from '../src/workspace/model.ts';
import { parseJobCommand } from '../src/machine-worker/jobRpc.ts';
const base = snapshotOf(initialState());
function snapshot(fb = 450.06) {
  return { ...base, identity: { id: 'test', hv: 8, fb }, classification: { dialectId: 'tinyg-en' } as NonNullable<typeof base.classification>, job: { phase: 'running', stopping: false } as NonNullable<typeof base.job> };
}
function html(permitted: boolean, capped: boolean, fb = 450.06) {
  const reading = { requested: 120, effective: 110, permitted, capped };
  const model = { live: signal({ message: { snapshot: { ...snapshot(fb), overrides: { feed: reading, spindle: reading, busy: false, error: null } } } }), actions: signal({ job: async () => null }) } as unknown as WorkspaceModel;
  return renderToString(h(OverrideControls, { model }));
}
it('hides older firmware and no-job states, and shows confirmed request/effect and program/speed limits', () => {
  expect(overrideVisible(null)).toBe(false);
  expect(overrideVisible(base)).toBe(false);
  expect(html(true, false, 450.05)).toBe('');
  expect(overrideVisible({ ...snapshot(), job: { ...snapshot().job!, phase: 'draining' } })).toBe(true);
  expect(html(true, true)).toContain('held at a speed limit');
  expect(html(false, false)).toContain('locked by the program');
  expect(html(false, false)).toMatch(/disabled/);
  expect(html(true, false)).toContain('120% requested · 110% in effect');
  expect(html(true, false)).not.toContain('Rapid');
});
it('clamps both control directions and strictly validates the RPC', () => {
  expect(nextOverride(10, -10)).toBe(10); expect(nextOverride(150, 10)).toBe(150);
  expect(nextOverride(100, 10)).toBe(110);
  for (const channel of ['feed', 'spindle']) {
    for (let percent = 10; percent <= 150; percent += 10) expect(parseJobCommand({ op: 'override', channel, percent })).toEqual({ op: 'override', channel, percent });
    for (const percent of [0, 160, 115, NaN, Infinity, '120']) expect(parseJobCommand({ op: 'override', channel, percent })).toBeNull();
  }
  expect(parseJobCommand({ op: 'override', channel: 'rapid', percent: 100 })).toBeNull();
  expect(parseJobCommand({ op: 'override', channel: 'feed', percent: 100, extra: true })).toBeNull();
});
