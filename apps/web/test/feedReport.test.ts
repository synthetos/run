/**
 * The feed-limit feedback (H78, MACHINING_ASSISTANT appendix): the firmware's v1 frames folded into the window and
 * worded as observational shares and notes. The two fixtures are every frame bench 2 (edge-next 425fa92e = 450.01)
 * sent during the dense 0.04 mm perfbench section: once host-starved (one line per 80 ms), once at full line-mode
 * speed (feed-limited). Nothing here may read as starvation or name an axis.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyLine } from '@synthetos/protocol';
import { feedLimitWindow, foldFeedLimit, type FeedLimitState } from '@synthetos/machine';
import { FEED_CAUSES, feedDiagnosis, feedReport, feedShareLine } from '../src/workspace/jobUi.ts';

const FIXTURES = join(import.meta.dirname, '../../../packages/testkit/fixtures');

/** Folds every fs and fl frame of a capture, in order, as the session would. */
function replay(name: string): { readonly state: FeedLimitState; readonly frames: number } {
  let state = feedLimitWindow(2);
  let frames = 0;
  for (const line of readFileSync(join(FIXTURES, name), 'utf8').split('\n')) {
    if (line.length === 0) continue;
    const { raw } = JSON.parse(line) as { raw: string };
    const c = classifyLine(raw);
    if (c.kind === 'FeedLimitSummary') {
      state = foldFeedLimit(state, 'fs', c.fs, c.totalsShort);
      frames++;
    } else if (c.kind === 'FeedLimitEvent') {
      state = foldFeedLimit(state, 'fl', c.fl, false);
      frames++;
    }
  }
  return { state, frames };
}

const forbidden = /starv|host too slow|board too slow|\bX axis|\bY axis|\bZ axis/i;

describe('feedReport over the bench 2 captures', () => {
  it('feed-limited (full line-mode speed): short moves dominate, the dense-file note appears, nothing says starvation', () => {
    const { state, frames } = replay('feed-vectors-limited.jsonl');
    expect(frames).toBe(20);
    expect(state.unsupported).toBe(false);
    expect(state.last).not.toBeNull();
    const r = feedReport(state);
    if (r === null) throw new Error('no report');
    expect(r.cuttingS).toBeGreaterThan(3);
    expect(r.cuttingMm).toBeGreaterThan(20);
    expect(r.job[0]?.cause).toBe('an axis speed limit');
    const short = r.job.find((x) => x.cause === FEED_CAUSES[3]);
    expect(short?.fraction ?? 0).toBeGreaterThan(0.4);
    expect(r.notes.some((n) => n.startsWith('Moves too short to reach the feed'))).toBe(true);
    expect(r.notes.some((n) => n.startsWith("An axis's own speed limit"))).toBe(true);
    for (const n of r.notes) expect(n).not.toMatch(forbidden);
    expect(feedShareLine(r.job)).toMatch(/^an axis speed limit \d+%, moves too short to reach the feed \d+%/);
    // The last interval is the difference of the last two summaries, not the window.
    expect(r.recent).not.toBeNull();
    // The capture ends after the last move: the executing-move line is only for a feed move (k = 1).
    expect(state.move).not.toBeNull();
    expect(r.move === null || typeof r.move.pct === 'number').toBe(true);
  });

  it('host-starved (one line per 80 ms): the frames say nothing about starvation and neither does the report', () => {
    const { state, frames } = replay('feed-vectors-starving.jsonl');
    expect(frames).toBe(73);
    const r = feedReport(state);
    if (r === null) throw new Error('no report');
    expect(r.cuttingS).toBeGreaterThan(0);
    for (const n of r.notes) expect(n).not.toMatch(forbidden);
    for (const share of r.job) expect(share.cause).not.toMatch(forbidden);
    // At the end nothing cuts (k = 0 between lines, or a rapid): no move line is shown then.
    expect(state.move?.k).not.toBe(1);
    expect(r.move).toBeNull();
  });

  it('an empty window reports nothing but the move; shares under 2% are left out; causes overlap', () => {
    expect(feedReport(null)).toBeNull();
    const empty = feedReport(feedLimitWindow(2));
    expect(empty).toMatchObject({ cuttingS: 0, job: [], recent: null, move: null, notes: [] });
    const s = foldFeedLimit(feedLimitWindow(2), 'fs', { v: 1, e: 1, q: 1, c: [1000, 10, 0, 900, 0, 0], ct: 1000, cd: 5 }, false);
    const r = feedReport(s);
    expect(r?.job.map((x) => [x.cause, Math.round(x.fraction * 100)])).toEqual([
      ['an axis speed limit', 100],
      ['moves too short to reach the feed', 90],
    ]);
    expect(r?.notes).toHaveLength(2);
    expect(feedShareLine([])).toBeNull();
    const moving = foldFeedLimit(s, 'fl', { k: 1, m: 11, p: 7, n: 0 }, false);
    expect(feedReport(moving)?.move).toEqual({ pct: 7, causes: 'an axis speed limit, a corner, too short to reach the feed' });
  });
});

it('step 3 distinguishes no-input gaps, input pending, and reported machine limits; v1 never gains a cause', () => {
  const fs = { v: 2, e: 1, q: 2, c: [0, 0, 0, 0, 0, 0, 80], ct: 100, cd: 2 };
  const s = foldFeedLimit(feedLimitWindow(2), 'fs', fs, false);
  expect(feedReport(s)?.job[0]?.cause).toBe('command boundaries');
  expect(feedDiagnosis(foldFeedLimit(s, 'fl', { k: 0, g: 2, n: 9 }, false))).toBe("Run didn't send lines fast enough");
  expect(feedDiagnosis(foldFeedLimit(s, 'fl', { k: 0, g: 1 }, false))).toBe('Lines are waiting on the machine');
  expect(feedDiagnosis(foldFeedLimit(s, 'fl', { k: 1, m: 32, p: 70, n: 9 }, false))).toBe('The machine limited the speed');
  const legacy = foldFeedLimit(feedLimitWindow(2), 'fs', { ...fs, v: 1 }, false);
  expect(feedDiagnosis(foldFeedLimit(legacy, 'fl', { k: 1, m: 1, p: 70 }, false))).toBeNull();
  const pair = foldFeedLimit(s, 'fg', { e: 1, q: 2, g: [0, 50, 1], b: [[0, 0], [0, 0], [0, 0]] }, false);
  expect(feedReport(pair)?.diagnosis).toBe("Run didn't send lines fast enough");
});
