/**
 * Play preview's page side (OD-25; SAFETY H15 and T-S41 amended 2026-11-09): when it may be offered, the rapid rate
 * it plays at, and its controls and notice.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { MOTION_STATES, playAllowedFor, playRapidOf } from '../src/preview/playAllowed.ts';
import { PLAY_NOTICE, PlayControls, PlayNotice } from '../src/preview/PlayControls.ts';
import type { PlayView } from '../src/preview/usePlay.ts';

describe('playAllowedFor', () => {
  it('offers Play with no board or an idle one', () => {
    expect(playAllowedFor(false, null)).toBe(true);
    expect(playAllowedFor(false, { base: 'IDLE_UNHOMED', overlays: [] })).toBe(true);
    expect(playAllowedFor(false, { base: 'IDLE_HOMED', overlays: ['STALE'] })).toBe(true);
  });
  it('never while a job of this tab runs, the board moves or holds motion, or motion is not ours', () => {
    expect(playAllowedFor(true, null)).toBe(false);
    for (const base of MOTION_STATES) expect(playAllowedFor(false, { base, overlays: [] }), base).toBe(false);
    expect(playAllowedFor(false, { base: 'IDLE_HOMED', overlays: ['ORPHANED_MOTION'] })).toBe(false);
    expect([...MOTION_STATES].sort()).toEqual(['HELD', 'HOMING', 'JOGGING', 'PREAMBLE', 'PROGRAM_PAUSED', 'RUNNING', 'STOPPING_JOB']);
  });
});

describe('playRapidOf', () => {
  it('plays rapids at the profile’s slower of X and Y, else the stated default (undefined here)', () => {
    expect(playRapidOf({ axes: { x: { maxFeed: 8000 }, y: { maxFeed: 6000 } } })).toBe(6000);
    expect(playRapidOf({ axes: { x: { maxFeed: 8000 } } })).toBe(8000);
    expect(playRapidOf({})).toBeUndefined();
    expect(playRapidOf(null)).toBeUndefined();
  });
});

describe('the controls', () => {
  const view = (over: Partial<PlayView> = {}): PlayView => ({
    available: true, active: false, playing: false, speed: 1, completed: 0, reducedMotion: false,
    feed: { subscribe: () => () => undefined },
    play: () => undefined, pause: () => undefined, setSpeed: () => undefined, seekLine: () => undefined, stop: () => undefined, step: () => undefined,
    ...over,
  });
  it('shows Play and the four speeds, 1× chosen, and nothing when Play may not be offered', () => {
    const html = renderToString(h(PlayControls, { play: view() }));
    expect(html).toContain('>Play<');
    for (const s of ['1×', '2×', '5×', '10×']) expect(html).toContain(`>${s}<`);
    expect(html).toContain('aria-pressed="true" data-play-speed="1"');
    expect(renderToString(h(PlayControls, { play: view({ available: false }) }))).toBe('');
  });
  it('says Pause while playing, and offers End preview during a session', () => {
    const html = renderToString(h(PlayControls, { play: view({ playing: true, active: true }) }));
    expect(html).toContain('>Pause<');
    expect(html).toContain('>End preview<');
  });
  it('under reduced motion offers Next move and no speeds', () => {
    const html = renderToString(h(PlayControls, { play: view({ reducedMotion: true }) }));
    expect(html).toContain('>Next move<');
    expect(html).not.toContain('data-play-speed');
    expect(html).not.toContain('>Play<');
  });
  it('the notice is short and plain, and shows for the whole session', () => {
    expect(PLAY_NOTICE).toBe('Preview at programmed speeds: not timed like the machine');
    expect(renderToString(h(PlayNotice, { play: view({ active: true }) }))).toContain(PLAY_NOTICE);
    expect(renderToString(h(PlayNotice, { play: view({ active: false }) }))).toBe('');
  });
});
