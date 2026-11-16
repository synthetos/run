/** Production and staging use the same machine abilities after the port grant. */
import { describe, expect, it } from 'vitest';
import { JOBS, PHASE_1_RELEASE, PHASE_2_RELEASE, jobsEnabled, withJobs, withSettingsWrites } from '../src/index.ts';

describe('the jobs phase switch', () => {
  it('is on for staging (and the localhost bench, which is staging) and on for production after the Connect grant', () => {
    expect(JOBS).toEqual({ staging: true, production: true });
    expect(Object.isFrozen(JOBS)).toBe(true);
  });

  it('fails closed for no environment or anything unknown', () => {
    expect(jobsEnabled('staging')).toBe(true);
    expect(jobsEnabled('production')).toBe(true);
    for (const env of [null, undefined, 'bench', 'Staging', '', 'toString'] as unknown[]) expect(jobsEnabled(env as never)).toBe(false);
  });

  it('adds jobs only to a motion release, only where enabled, and composes with settings writes', () => {
    expect(withJobs(PHASE_2_RELEASE, 'staging')).toMatchObject({ motion: true, jobs: true, name: 'Phase 2 + jobs' });
    expect(Object.isFrozen(withJobs(PHASE_2_RELEASE, 'staging'))).toBe(true);
    expect(withJobs(PHASE_1_RELEASE, 'staging')).toBe(PHASE_1_RELEASE);
    expect(withJobs(PHASE_2_RELEASE, 'production')).toMatchObject({ motion: true, jobs: true });
    expect(withJobs(PHASE_2_RELEASE, null)).toBe(PHASE_2_RELEASE);
    expect(withJobs(withSettingsWrites(PHASE_2_RELEASE, 'staging'), 'staging')).toMatchObject({ settings: true, jobs: true });
    expect(PHASE_2_RELEASE.jobs).toBeUndefined();
  });
});

describe('jobsEnabled: only the two named environments', () => {
  it('fails closed for an unknown name even when Object.prototype carries it as true (the switch is never read for it)', () => {
    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto['bench'] = true;
    try {
      expect(jobsEnabled('bench' as never)).toBe(false);
    } finally {
      delete proto['bench'];
    }
  });
});
