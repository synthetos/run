import { TINYG_EN } from '@synthetos/protocol';
import { initialState, DEFAULT_TIMINGS, type JobState } from '../src/index.ts';
import { OVERRIDE_TOKENS, type OverrideState } from '../src/session/overrides/model.ts';
import { EN_APPROVED, JOBS_RELEASE } from './jobHarness.ts';
export const CONFIG = { release: JOBS_RELEASE, manifest: EN_APPROVED, timings: DEFAULT_TIMINGS };
export function overrideState(): OverrideState {
  const initial = initialState();
  return {
    ...initial, base: 'RUNNING', epoch: 1, dialect: TINYG_EN,
    identity: { id: 'test', hv: 8, fb: 450.06 }, classification: { mode: 'full', dialectId: 'tinyg-en' } as OverrideState['classification'],
    footerRev: 3, rxm: { ...initial.rxm, current: 1 }, live: { ...initial.live, stat: 5, lastRxAt: 100 },
    values: Object.fromEntries(OVERRIDE_TOKENS.map(key => [key, { value: key.endsWith('cp') ? 0 : 1, status: 0, at: 100 }])),
    job: { id: 1, phase: 'running', stopping: false, free: 8, next: 0, lines: [], events: [], feedLimit: null } as unknown as JobState,
    overrides: { epoch: 1, since: 0, nextRead: 1000, pending: null, error: null },
  };
}
