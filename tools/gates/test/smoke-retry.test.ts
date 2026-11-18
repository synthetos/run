/**
 * A deploy propagates across the edge over a few seconds; the post-deploy smoke test ran three seconds after the
 * staging deploy of 2026-11-18 and read the previous version's headers, which rolled a good deploy back. The HTTP
 * checks therefore retry for a short window until they come back clean, and only then is a finding a regression.
 */
import { describe, expect, it } from 'vitest';
import { untilClean } from '../src/smoke/retry.ts';

const finding = (message: string) => [{ check: 'headers', message }];

describe('untilClean', () => {
  it('returns at once when the first run is clean, without waiting', async () => {
    const waits: number[] = [];
    let runs = 0;
    const result = await untilClean(async () => { runs += 1; return []; }, { attempts: 5, delayMs: 10, wait: async (ms) => { waits.push(ms); } });
    expect(result).toEqual([]);
    expect(runs).toBe(1);
    expect(waits).toEqual([]);
  });

  it('retries after a finding, waiting between runs, and stops at the first clean run', async () => {
    const waits: number[] = [];
    const answers = [finding('old header'), finding('old header'), []];
    let runs = 0;
    const result = await untilClean(async () => answers[runs++] ?? [], { attempts: 5, delayMs: 10, wait: async (ms) => { waits.push(ms); } });
    expect(result).toEqual([]);
    expect(runs).toBe(3);
    expect(waits).toEqual([10, 10]);
  });

  it('gives up after the attempts and reports the last findings, never an earlier or empty set', async () => {
    const waits: number[] = [];
    let runs = 0;
    const result = await untilClean(async () => { runs += 1; return finding(`still wrong ${runs}`); }, { attempts: 3, delayMs: 10, wait: async (ms) => { waits.push(ms); } });
    expect(result).toEqual(finding('still wrong 3'));
    expect(runs).toBe(3);
    expect(waits).toEqual([10, 10]);
  });

  it('treats a thrown check as findings to retry, not as a crash', async () => {
    let runs = 0;
    const result = await untilClean(async () => { runs += 1; if (runs < 2) throw new Error('fetch failed'); return []; }, { attempts: 3, delayMs: 1, wait: async () => undefined });
    expect(result).toEqual([]);
    expect(runs).toBe(2);
  });
});
