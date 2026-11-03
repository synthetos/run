/**
 * The jobs phase switch is pinned (Phase 3, owner 2026-11-02; SAFETY §4.4a): jobs run on the bench and staging
 * builds only, and production stays read-only until the owner changes this test and the switch together.
 */
import { describe, expect, it } from 'vitest';
import { JOBS, PHASE_1_RELEASE, PHASE_2_RELEASE, jobsEnabled, withJobs, withSettingsWrites } from '../src/index.ts';

describe('the jobs phase switch', () => {
  it('is on for staging (and the localhost bench, which is staging) and off for production', () => {
    expect(JOBS).toEqual({ staging: true, production: false });
    expect(Object.isFrozen(JOBS)).toBe(true);
  });

  it('fails closed for no environment or anything unknown', () => {
    expect(jobsEnabled('staging')).toBe(true);
    expect(jobsEnabled('production')).toBe(false);
    for (const env of [null, undefined, 'bench', 'Staging', '', 'toString'] as unknown[]) expect(jobsEnabled(env as never)).toBe(false);
  });

  it('adds jobs only to a motion release, only where enabled, and composes with settings writes', () => {
    expect(withJobs(PHASE_2_RELEASE, 'staging')).toMatchObject({ motion: true, jobs: true, name: 'Phase 2 + jobs' });
    expect(Object.isFrozen(withJobs(PHASE_2_RELEASE, 'staging'))).toBe(true);
    expect(withJobs(PHASE_1_RELEASE, 'staging')).toBe(PHASE_1_RELEASE);
    expect(withJobs(PHASE_2_RELEASE, 'production')).toBe(PHASE_2_RELEASE);
    expect(withJobs(PHASE_2_RELEASE, null)).toBe(PHASE_2_RELEASE);
    expect(withJobs(withSettingsWrites(PHASE_2_RELEASE, 'staging'), 'staging')).toMatchObject({ settings: true, jobs: true });
    expect(PHASE_2_RELEASE.jobs).toBeUndefined();
  });
});
