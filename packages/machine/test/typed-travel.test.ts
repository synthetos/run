/**
 * H91: the check of one typed move (typedTravel.ts): the job sanitiser and the travel check on a one-line program,
 * against the model board (X and Y 0..150 mm, Z 0..75 mm) as read by a job load.
 */
import { describe, expect, it } from 'vitest';
import { TYPED_NO_FEED, TYPED_TOO_LONG, feedInEffect, findingWords, typedCheck } from '../src/index.ts';
import { LOW_Z_TEXT, raiseLines, typedLowZ, typedSafeZ } from '../src/session/typedLowZ.ts';
import { TYPED_PIECE_SECONDS, typedPieces } from '../src/session/typedTravel.ts';
import { parseTypedLine, type TypedLine } from '@synthetos/safety';
import { afterHold, piecesLeft, raiseRestore } from '../src/session/typedPieces.ts';
import { typedLineWritableIn } from '../src/session/typedMove.ts';
import { initialState } from '../src/index.ts';
import type { MotionCtx } from '../src/session/types.ts';
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
    expect(typedCheck(await board(), 'G0 X5 Y5')).toEqual({ kind: 'clear', pieces: ['G0 X5 Y5'] });
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
    expect(typedCheck(withValue(s, 'feed', 600), 'G1 X2')).toEqual({ kind: 'clear', pieces: ['G1 X2'] });
    expect(typedCheck(withValue(s, 'feed', 0), 'G0 X5')).toEqual({ kind: 'clear', pieces: ['G0 X5'] });
    expect(typedCheck(withValue(s, 'feed', 0), 'G3 X5 Y5 I5 J0')).toEqual({ kind: 'refused', text: TYPED_NO_FEED });
    expect(typedCheck(withValue(s, 'feed', 0), 'G2 X5 Y5 I5 J0')).toEqual({ kind: 'refused', text: TYPED_NO_FEED });
  });

  it('a sanitiser block is refused in its words', async () => {
    const r = typedCheck(await board(), 'G2 X10 Y0 I1 J0 F300');
    expect(r.kind).toBe('refused');
    expect((r as { text: string }).text.startsWith('Not sent: ')).toBe(true);
    expect((r as { text: string }).text).not.toMatch(/\.\.|: [A-Z][a-z]|Fix:/);
  });

  it('OD-31: a long line is split into pieces of at most ceiling / lookahead each; too many pieces: refused', async () => {
    const s = await board();
    expect(TYPED_PIECE_SECONDS).toBe(1.25);
    expect(typedCheck(s, 'G1 X20 F600')).toEqual({ kind: 'clear', pieces: ['F600 G1 X5', 'G1 X10', 'G1 X15', 'G1 X20'] });
    expect(typedPieces(s, 'G0 X10')).toEqual(['G0 X5', 'G0 X10']);
    expect(typedCheck(s, 'G1 X140 F1')).toEqual({ kind: 'refused', text: TYPED_TOO_LONG });
  });

  it('past travel on an axis homed here: refused, before the ceiling', async () => {
    expect(typedCheck(homed(await board()), 'G0 X200')).toEqual({ kind: 'refused', text: 'Not sent: X would reach machine 200 mm, beyond its travel limit of 150 mm.' });
  });

  it('past travel on an axis not homed here: the C41 finding to confirm', async () => {
    const s = withValue(await board(), 'mpo', { x: 140, y: 0, z: 0, a: 0, b: 0, c: 0 });
    const r = typedCheck(s, 'G0 X160');
    expect(r).toEqual({ kind: 'confirm', pieces: ['G0 X146.6667', 'G0 X153.3333', 'G0 X160'], finding: { kind: 'outside', line: 1, text: 'line 1: X would reach machine 160 mm, beyond its travel limit of 150 mm, and the X position was not set by a homing cycle in this connection', past: { axis: 'X', reach: 160, limit: 150, unit: 'mm', more: 0 } } });
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

describe('OD-31: the low-Z question for a typed G0', () => {
  const t = (line: string): TypedLine => (parseTypedLine(line) as { readonly value: TypedLine }).value;
  const at = (s: SessionState, z: number): SessionState => withValue(s, 'mpo', { x: 0, y: 0, z, a: 0, b: 0, c: 0 });

  it('safe Z is go to zero\'s: ztm − 1, only when Z was homed here', async () => {
    const s = await board();
    expect(typedSafeZ(s)).toBeNull();
    expect(typedSafeZ(homed(s))).toBe(74);
    const { tm: _tm, ...z } = s.values['z']?.value as Record<string, number>;
    expect(typedSafeZ(withValue(homed(s), 'z', z))).toBeNull();
  });

  it('asked only for a G0 that moves X or Y with Z below safe Z', async () => {
    const s = homed(await board());
    expect(typedLowZ(at(s, 10), t('G1 X5 F100'), 1, 0)).toBeNull();
    expect(typedLowZ(at(s, 10), t('G0 Z5'), 1, 0)).toBeNull();
    expect(typedLowZ(at(s, 74), t('G0 X5'), 1, 0)).toBeNull();
    expect(typedLowZ(at(s, 10), t('G0 X5'), 1, 0)).toEqual({ raise: true, safeZ: 74, z: 10, why: null });
    expect(typedLowZ(at(s, 10), t('G0 Y5'), 1, 0)).toMatchObject({ raise: true });
  });

  it('Raise is not offered when Z was not homed here, Z is not known, the move sets Z, or the modes were not read', async () => {
    const s = await board();
    expect(typedLowZ(at(s, 10), t('G0 X5'), 1, 0)).toEqual({ raise: false, safeZ: null, z: 10, why: LOW_Z_TEXT.notHomed });
    const h = homed(s);
    expect(typedLowZ(withValue(h, 'mpo', null, 9), t('G0 X5'), 1, 0)).toEqual({ raise: false, safeZ: 74, z: null, why: LOW_Z_TEXT.noZ });
    expect(typedLowZ(withValue(h, 'mpo', { x: 0 }), t('G0 X5'), 1, 0)).toMatchObject({ why: LOW_Z_TEXT.noZ });
    expect(typedLowZ(withValue(h, 'mpo', [1]), t('G0 X5'), 1, 0)).toMatchObject({ why: LOW_Z_TEXT.noZ });
    expect(typedLowZ(at(h, 10), t('G0 X5 Z20'), 1, 0)).toMatchObject({ raise: false, why: LOW_Z_TEXT.ownZ });
    expect(typedLowZ(at(h, 10), t('G0 X5'), undefined, 0)).toMatchObject({ raise: false, why: LOW_Z_TEXT.modes });
    expect(typedLowZ(at(h, 10), t('G0 X5'), 1, undefined)).toMatchObject({ raise: false, why: LOW_Z_TEXT.modes });
  });

  it('Raise is go to zero\'s lines, never lower than Z is, then the modes put back', () => {
    expect(raiseLines({ raise: true, safeZ: 74, z: 10, why: null }, 1, 0)).toEqual(['G90 G21', 'G53 G0 Z74', 'G90']);
    expect(raiseLines({ raise: true, safeZ: 74, z: 74.005, why: null }, 0, 1)).toEqual(['G90 G21', 'G53 G0 Z74.005', 'G91 G20']);
  });
});

describe('OD-31: piece bookkeeping', () => {
  const ctx = (patch: Partial<NonNullable<MotionCtx['typed']>> = {}): MotionCtx =>
    ({ op: 'typed', units: 1, dist: 1, typed: { line: 'G1 X3 F60', travel: null, askedAt: 0, sent: true, pieces: ['G1 X1', 'G1 X2', 'G1 X3'], next: 3, lowZ: null, raise: [], raised: true, ...patch } }) as unknown as MotionCtx;

  it('a hold counts back the pieces still queued, never a raise line or another purpose', () => {
    const queue = [
      { token: 'gc', purpose: 'motion' as const, line: 'G1 X3' },
      { token: 'gc', purpose: 'motion' as const, line: 'G53 G0 Z74' },
      { token: 'stat', purpose: 'poll' as const },
    ];
    expect(afterHold(ctx(), queue).typed?.next).toBe(2);
    expect(piecesLeft(afterHold(ctx(), queue))).toBe(true);
    expect(piecesLeft(ctx({ raised: false, next: 0 }))).toBe(false);
  });

  it('an unfinished raise puts the modes read before it back', () => {
    expect(raiseRestore(ctx({ raise: ['G90 G21', 'G53 G0 Z74', 'G91'], raised: false }))).toEqual(['G91']);
    expect(raiseRestore(ctx({ raise: ['G90 G21', 'G53 G0 Z74', 'G91'], raised: true }))).toEqual([]);
  });

  it('the write gate check: nothing when no typed move is sending', () => {
    expect(typedLineWritableIn(initialState(), 'G1 X1')).toBe(false);
  });
});
