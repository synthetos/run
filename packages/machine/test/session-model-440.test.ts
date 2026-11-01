/**
 * ROADMAP P1-02 model test, 440.21 half: random read-only sessions
 * against the test kit's 440.21 model (sessionModel.ts). The edge-next half
 * is session-model-en.test.ts; together they run SESSIONS (10k) sessions.
 */
import { describe, expect, it } from 'vitest';
import { MODEL_SESSIONS, runModelSessions } from './sessionModel.ts';

describe('model test (440.21): first line {"sr":null}; only allowlisted GETs, ENQ after a rev-2/3 footer, and !', () => {
  it(`${MODEL_SESSIONS / 2} random sessions`, async () => {
    const result = await runModelSessions('440', MODEL_SESSIONS / 2);
    expect(result.problems).toEqual([]);
    // The sessions really exercised the paths: most connected, and the gated bytes were asked for.
    expect(result.connected / result.sessions).toBeGreaterThan(0.6);
    expect(result.enqWritten).toBe(0);
    expect(result.feedholdWritten).toBeGreaterThan(0);
    expect(result.requestReads).toBeGreaterThan(0);
  }, 300_000);
});
