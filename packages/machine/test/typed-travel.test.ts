/**
 * H91: the check of one typed move (typedTravel.ts): the job sanitiser and the travel check on a one-line program,
 * against the model board (X and Y 0..150 mm, Z 0..75 mm) as read by a job load.
 */
import { describe, expect, it } from 'vitest';
import { TYPED_NO_FEED, TYPED_TOO_LONG, feedInEffect, findingWords, typedCheck } from '../src/index.ts';
import type { SessionState } from '../src/session/types.ts';
import { jobHarness, load } from './jobHarness.ts';

async function board(): Promise<SessionState> {
  const h = await jobHarness({ rxm: 1 });
  await load(h, 'G21 G90\nG0 X1\nM30');
  return h.session.state;
}

function homed(s: SessionState): SessionState {
  const hom = { value: { x: 1, y: 1, z: 1, a: 0, b: 0, c: 0 }, status: 0, at: 1 };
  return { ...s, live: { ...s.live, home: 1 }, values: { ...s.values, hom }, notices: { ...s.notices, homedAxes: ['x', 'y', 'z'] } };
}

function withValue(s: SessionState, token: string, value: unknown, status = 0): SessionState {
  return { ...s, values: { ...s.values, [token]: { value: value as never, status, at: 1 } } };
}

describe('typedCheck', () => {
  it('inside travel: clear', async () => {
    expect(typedCheck(await board(), 'G0 X10 Y10')).toEqual({ kind: 'clear' });
  });

  it('a line the grammar refuses is refused with its reason and what to do', async () => {
    expect(typedCheck(await board(), 'M3')).toEqual({ kind: 'refused', text: 'M words are not part of a typed move. Use the matching button instead.' });
  });

  it('no board identified: refused', async () => {
    expect(typedCheck({ ...(await board()), dialect: null }, 'G0 X1')).toEqual({ kind: 'refused', text: 'No board is identified.' });
  });

  it('a feed move with no feed in the line and none in effect: refused; with the feed in effect: clear', async () => {
    const s = await board();
    expect(typedCheck(withValue(s, 'feed', 0), 'G1 X5')).toEqual({ kind: 'refused', text: TYPED_NO_FEED });
    expect(typedCheck(withValue(s, 'feed', 600), 'G1 X5')).toEqual({ kind: 'clear' });
    expect(typedCheck(withValue(s, 'feed', 0), 'G0 X5')).toEqual({ kind: 'clear' });
    expect(typedCheck(withValue(s, 'feed', 0), 'G3 X5 Y5 I5 J0')).toEqual({ kind: 'refused', text: TYPED_NO_FEED });
    expect(typedCheck(withValue(s, 'feed', 0), 'G2 X5 Y5 I5 J0')).toEqual({ kind: 'refused', text: TYPED_NO_FEED });
  });

  it('a sanitiser block is refused in its words', async () => {
    const r = typedCheck(await board(), 'G2 X10 Y0 I1 J0 F300');
    expect(r.kind).toBe('refused');
    expect((r as { text: string }).text.startsWith('Not sent: ')).toBe(true);
  });

  it('longer than one queued move: refused', async () => {
    expect(typedCheck(await board(), 'G1 X100 F60')).toEqual({ kind: 'refused', text: TYPED_TOO_LONG });
  });

  it('past travel on an axis homed here: refused, before the ceiling', async () => {
    expect(typedCheck(homed(await board()), 'G0 X200')).toEqual({ kind: 'refused', text: 'Not sent: X would reach machine 200 mm, beyond its travel limit of 150 mm.' });
  });

  it('past travel on an axis not homed here: the C41 finding to confirm', async () => {
    const s = withValue(await board(), 'mpo', { x: 140, y: 0, z: 0, a: 0, b: 0, c: 0 });
    const r = typedCheck(s, 'G0 X160');
    expect(r).toEqual({ kind: 'confirm', finding: { kind: 'outside', line: 1, text: 'line 1: X would reach machine 160 mm, beyond its travel limit of 150 mm, and the X position was not set by a homing cycle in this connection', past: { axis: 'X', reach: 160, limit: 150, unit: 'mm', more: 0 } } });
    expect(findingWords((r as { finding: Parameters<typeof findingWords>[0] }).finding)).toBe('X would reach machine 160 mm, beyond its travel limit of 150 mm, and the X position was not set by a homing cycle in this connection');
  });

  it('a limit not read: the C40 finding to confirm', async () => {
    const s = await board();
    const { tn: _tn, tm: _tm, ...x } = s.values['x']?.value as Record<string, number>;
    expect(typedCheck(withValue(s, 'x', x), 'G0 X10')).toMatchObject({ kind: 'confirm', finding: { kind: 'unchecked', text: 'the travel limits of X were not read' } });
  });
});

describe('feedInEffect', () => {
  it('only a feed read with status 0, more than 0, in millimetres', async () => {
    const s = await board();
    expect(feedInEffect(withValue(s, 'feed', 600))).toBe(600);
    expect(feedInEffect(withValue(withValue(s, 'feed', 600), 'unit', 0))).toBeUndefined();
    expect(feedInEffect(withValue(withValue(s, 'feed', 600), 'unit', 1, 9))).toBeUndefined();
    expect(feedInEffect(withValue(s, 'feed', 600, 9))).toBeUndefined();
    expect(feedInEffect(withValue(s, 'feed', 'x'))).toBeUndefined();
    expect(feedInEffect(withValue(s, 'feed', -1))).toBeUndefined();
    expect(feedInEffect(withValue(s, 'feed', Number.POSITIVE_INFINITY))).toBeUndefined();
    const { feed: _f, ...noFeed } = s.values;
    expect(feedInEffect({ ...s, values: noFeed })).toBeUndefined();
    const { unit: _u, ...noUnit } = withValue(s, 'feed', 600).values;
    expect(feedInEffect({ ...s, values: noUnit })).toBeUndefined();
  });
});
