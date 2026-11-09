/**
 * Play preview (play/; owner, 2026-11-09, SAFETY H15 and T-S41 amended): durations at programmed speeds, the
 * timeline and where the tool is at a time, and the player's clock (speeds, pause, seek, the end).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_FEED_MM_MIN, DEFAULT_RAPID_MM_MIN, PLAY_SPEEDS, SEGMENT, buildTimeline, createPlayer, lineStartTime, pointAt, programmedTiming } from '../src/index.ts';
import { listOf } from './helpers.ts';

const { RAPID, FEED, BREAK } = SEGMENT;
// Line 0: a 50 mm rapid; line 1: two 10 mm feeds; line 2: no move; line 3: a 30 mm feed.
const LIST = listOf([[[RAPID, 50, 0, 0]], [[FEED, 60, 0, 0], [FEED, 70, 0, 0]], [], [[FEED, 70, 30, 0]]]);
const FEEDS = Float32Array.from([Number.NaN, 600, 600, 1200]);

describe('programmedTiming', () => {
  it('times feeds by their F and rapids by the stated rapid rate', () => {
    const d = programmedTiming(FEEDS, 3000).durations(LIST);
    // 50 mm at 3000 mm/min = 1 s; 10 mm at 600 = 1 s each; 30 mm at 1200 = 1.5 s.
    expect(Array.from(d).map((x) => Number(x.toFixed(6)))).toEqual([0, 1, 1, 1, 1.5]);
  });
  it('states its defaults: rapids at 5000 mm/min, a feed before any F at 1000 mm/min', () => {
    expect(DEFAULT_RAPID_MM_MIN).toBe(5000);
    expect(DEFAULT_FEED_MM_MIN).toBe(1000);
    const list = listOf([[[FEED, 10, 0, 0]], [[BREAK, 99, 0, 0]]]);
    expect(Array.from(programmedTiming(Float32Array.from([Number.NaN, Number.NaN])).durations(list)).map((x) => Number(x.toFixed(6)))).toEqual([0, 0.6, 0]);
    expect(programmedTiming(FEEDS).label).toBe('programmed speeds');
  });
});

describe('timeline', () => {
  const tl = buildTimeline(programmedTiming(FEEDS, 3000).durations(LIST));
  it('adds up the durations', () => {
    expect(tl.total).toBeCloseTo(4.5, 6);
    expect(lineStartTime(LIST, tl, 1)).toBeCloseTo(1, 6);
    expect(lineStartTime(LIST, tl, 3)).toBeCloseTo(3, 6);
  });
  it('places the tool on the move under way at a time, and counts the lines done', () => {
    expect(pointAt(LIST, tl, 0.5)).toMatchObject({ pos: [25, 0, 0], line: 0, completed: 0 });
    expect(pointAt(LIST, tl, 1.5)?.pos[0]).toBeCloseTo(55, 4);
    expect(pointAt(LIST, tl, 1.5)).toMatchObject({ line: 1, completed: 1 });
    expect(pointAt(LIST, tl, 3.75)?.pos[1]).toBeCloseTo(15, 4);
    expect(pointAt(LIST, tl, 3.75)).toMatchObject({ line: 3, completed: 3 });
    expect(pointAt(LIST, tl, 99)).toMatchObject({ pos: [70, 30, 0], completed: 4 });
  });
});

describe('createPlayer', () => {
  it('plays at 1×, 2×, 5× and 10× from a clock, pauses, seeks and stops at the end', () => {
    expect(PLAY_SPEEDS).toEqual([1, 2, 5, 10]);
    let t = 0;
    const p = createPlayer(10, () => t);
    expect(p.playing).toBe(false);
    expect(p.speed).toBe(1);
    p.play();
    t = 1000;
    expect(p.time()).toBeCloseTo(1, 6);
    p.setSpeed(5);
    t = 2000;
    expect(p.time()).toBeCloseTo(6, 6);
    p.pause();
    t = 9000;
    expect(p.time()).toBeCloseTo(6, 6);
    p.seek(2);
    expect(p.time()).toBe(2);
    p.play();
    t = 12_000;
    expect(p.time()).toBe(10);
    expect(p.playing).toBe(false);
    expect(p.ended).toBe(true);
    // Play at the end starts again.
    p.play();
    expect(p.time()).toBe(0);
  });
});
