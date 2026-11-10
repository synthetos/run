/**
 * Place job and the file's own zero (owner, 2026-11-09, OD-28: CAM owns the toolpath and the file's zero; run owns
 * where that zero goes on the stock, and never rewrites coordinates): reading the zero from the cut and the header,
 * the pre-selection that never overrides a user's pick, the "hangs off the stock" suggestion, the zero depth, the
 * machine's work zero as a placement choice, and Run's zero check (C31) words for each.
 */
import { describe, expect, it } from 'vitest';
import { SEED_SETUP } from '../src/workspace/library.ts';
import { datumPickedByUser, datumPoint, effectiveZero, fixtureTop, isJob, jobFromSetup, plannedZero, reviseJob, withDatum, withMachineZero, withOffset, type Job, type JobClock } from '../src/workspace/jobModel.ts';
import { guessFileZero, headerHints, type CutBox } from '../src/workspace/fileZero.ts';
import { fitSuggestion } from '../src/workspace/placeFit.ts';
import { placeMargins } from '../src/workspace/placeMargins.ts';
import { mayPreselect } from '../src/workspace/useAutoZero.ts';
import { jobScene } from '../src/preview/sceneModel.ts';

const SCENE_COLORS = { bed: [0.7, 0.6, 0.5, 1], fixture: [0.5, 0.6, 0.7, 1], clamp: [0.4, 0.4, 0.4, 1], stock: [0.8, 0.8, 0.8, 1] } as const;
import { placeWords, runZeroCheck, setupPlan } from '../src/workspace/zeroPlan.ts';

const clock: JobClock = { now: () => new Date('2026-11-09T12:00:00Z'), newId: () => 'job-1' };
const base = (): Job => jobFromSetup(SEED_SETUP, 'place', clock);
const box = (minX: number, maxX: number, minY: number, maxY: number, minZ = -3, maxZ = 0): CutBox => ({ minX, maxX, minY, maxY, minZ, maxZ });
const file = (hash: string): NonNullable<Job['file']> => ({ projectId: null, fileId: null, name: `${hash}.nc`, hash: hash.padEnd(64, '0'), size: 10 });
const withFile = (j: Job, hash: string): Job => reviseJob(j, { file: file(hash) }, clock);

describe('the file’s zero, read from its cutting moves', () => {
  it('sees the centre of a docklight-like part (X −90…+90, Y −40…+40) at the stock top', () => {
    const g = guessFileZero(box(-90, 90, -40, 40));
    expect(g).toMatchObject({ corner: 'center', height: 'top', confidence: 'clear' });
    expect(g.note).toBe('Zero in this file looks like the centre of the part, at the stock top (X −90…+90, Y −40…+40).');
  });

  it('sees each corner by the signs of the cut', () => {
    expect(guessFileZero(box(0, 120, 0, 60)).corner).toBe('front-left');
    expect(guessFileZero(box(-120, 0, 0, 60)).corner).toBe('front-right');
    expect(guessFileZero(box(0, 120, -60, 0)).corner).toBe('back-left');
    expect(guessFileZero(box(-120, 0, -60, 0)).corner).toBe('back-right');
  });

  it('allows a tool radius of slack at the corner, and calls a roughly symmetric cut likely, not clear', () => {
    expect(guessFileZero(box(-1.5, 118, -1.5, 58))).toMatchObject({ corner: 'front-left', confidence: 'likely' });
    const lop = guessFileZero(box(-80, 92, -40, 40));
    expect(lop).toMatchObject({ corner: 'center', confidence: 'likely' });
    expect(lop.note).toContain('may be the centre');
  });

  it('reads Z: the top when the cuts go down from 0, the bottom when the job sits on 0 and above', () => {
    expect(guessFileZero(box(0, 50, 0, 50, -6, 0)).height).toBe('top');
    expect(guessFileZero(box(0, 50, 0, 50, 0, 12)).height).toBe('bottom');
    expect(guessFileZero(box(0, 50, 0, 50, 0, 12)).note).toContain('at the stock bottom');
    // A plunge from Z 5 counts as cutting: still the top.
    expect(guessFileZero(box(0, 50, 0, 50, -2, 5)).height).toBe('top');
    // Flat at 0: not known.
    expect(guessFileZero(box(0, 50, 0, 50, 0, 0)).height).toBeNull();
  });

  it('says when it is not clear, and the note keeps the user’s pick', () => {
    const odd = guessFileZero(box(30, 150, 20, 80));
    expect(odd).toMatchObject({ corner: null, confidence: 'unclear' });
    expect(odd.note).toBe('Zero in this file is not clear (X +30…+150, Y +20…+80). It is not at a corner or the centre. Keep your pick.');
    // X centred with Y at the front is not one of the five points.
    expect(guessFileZero(box(-50, 50, 0, 60)).corner).toBeNull();
  });

  it('reads plain CAM header notes, uses them to back a loose guess, and calls a disagreement unclear', () => {
    expect(headerHints('(Fusion 360)\n(WCS: G54, origin at stock top, centre of part)\nG21')).toEqual({ corner: 'center', height: 'top' });
    expect(headerHints('; zero = front left corner, bottom of stock')).toEqual({ corner: 'front-left', height: 'bottom' });
    expect(headerHints('(Made by a post)\nG21 G90')).toEqual({ corner: null, height: null });
    expect(guessFileZero(box(-80, 92, -40, 40), '(Zero: stock top, centre)').confidence).toBe('clear');
    const clash = guessFileZero(box(0, 100, 0, 50), '(Origin: centre of stock)');
    expect(clash).toMatchObject({ corner: null, confidence: 'unclear' });
    expect(clash.note).toContain('The file’s notes and its moves disagree.');
  });
});

describe('who picked the zero', () => {
  it('counts a click as the user’s pick for this file, and a new file as open to pre-selection', () => {
    const fresh = withFile(base(), 'aaa');
    expect(datumPickedByUser(fresh)).toBe(false);
    expect(mayPreselect(fresh)).toBe(true);
    const auto = withDatum(fresh, { corner: 'center', height: 'top' }, clock, 'file');
    expect(mayPreselect(auto)).toBe(false);
    const picked = withDatum(fresh, { corner: 'front-right', height: 'top' }, clock);
    expect(datumPickedByUser(picked)).toBe(true);
    expect(mayPreselect(picked)).toBe(false);
    // Another file on the same job: the old pick was for the old file.
    expect(mayPreselect(withFile(picked, 'bbb'))).toBe(true);
  });

  it('treats a job saved before this (no record of who picked) as the user’s pick', () => {
    const j = withFile(base(), 'aaa');
    const { datumFrom: _drop, ...placement } = j.placement;
    const old = { ...j, placement } as Job;
    expect(isJob(old)).toBe(true);
    expect(datumPickedByUser(old)).toBe(true);
    expect(mayPreselect(old)).toBe(false);
  });

  it('never pre-selects without a file', () => {
    expect(mayPreselect(base())).toBe(false);
  });

  it('refuses a bad record', () => {
    const j = base();
    expect(isJob({ ...j, placement: { ...j.placement, datumFrom: { kind: 'cam', hash: null } } })).toBe(false);
    expect(isJob({ ...j, placement: { ...j.placement, zeroFrom: 'board' } })).toBe(false);
    expect(isJob({ ...j, placement: { ...j.placement, offset: { x: 0, y: 0, z: 'deep' } } })).toBe(false);
  });
});

describe('the hangs-off-the-stock suggestion', () => {
  // A centre-zero cut 60 × 30 mm on the seed stock: at front-left half of it hangs off.
  const cut = { minX: -30, maxX: 30, minY: -15, maxY: 15, minZ: -2, maxZ: 0 };
  it('offers the file’s own zero when the pick puts the cut off the stock, and nothing when it fits', () => {
    const wrong = withDatum(base(), { corner: 'front-left', height: 'top' }, clock);
    const fit = fitSuggestion(wrong, cut, plannedZero(wrong), 'center');
    expect(fit).toEqual({ corner: 'center', text: 'The toolpath hangs off the stock. Zero in this file looks like the centre.', action: 'Use centre' });
    const right = withDatum(base(), { corner: 'center', height: 'top' }, clock);
    expect(fitSuggestion(right, cut, plannedZero(right), 'center')).toBeNull();
  });

  it('names another point that fits when the file’s zero is unclear, and nothing when no point fits', () => {
    const wrong = withDatum(base(), { corner: 'front-left', height: 'top' }, clock);
    expect(fitSuggestion(wrong, cut, plannedZero(wrong), null)?.text).toBe('The toolpath hangs off the stock. It fits with zero at the centre.');
    const huge = { minX: -900, maxX: 900, minY: -900, maxY: 900, minZ: -2, maxZ: 0 };
    expect(fitSuggestion(wrong, huge, plannedZero(wrong), 'center')).toBeNull();
  });

  it('stays quiet for a tool edge just past the stock, and when the pick is the file’s own zero', () => {
    const corner = withDatum(base(), { corner: 'front-left', height: 'top' }, clock);
    // The toolpath starts on the corner: only the tool's radius runs past the edge, which the margins report.
    expect(fitSuggestion(corner, { minX: 0, maxX: 20, minY: 0, maxY: 10, minZ: -1, maxZ: 0 }, plannedZero(corner), null)).toBeNull();
    // Picked the file's zero and still off: the stock size, not the zero, is the problem.
    expect(fitSuggestion(corner, { minX: 0, maxX: 900, minY: 0, maxY: 10, minZ: -1, maxZ: 0 }, plannedZero(corner), 'front-left')).toBeNull();
  });

  it('offers a point on the stock when the machine’s work zero puts the cut off it', () => {
    const j = withMachineZero(withDatum(base(), { corner: 'center', height: 'top' }, clock), true, clock);
    const far = { x: plannedZero(j).x + 500, y: plannedZero(j).y };
    expect(fitSuggestion(j, cut, far, 'center')?.action).toBe('Use centre');
  });
});

describe('the zero depth', () => {
  it('moves zero down from the top, or up from the bottom, and the planned zero follows', () => {
    const top = withDatum(base(), { corner: 'center', height: 'top' }, clock);
    expect(datumPoint(withOffset(top, { x: 0, y: 0, z: 2 }, clock)).z).toBeCloseTo(datumPoint(top).z - 2, 9);
    expect(plannedZero(withOffset(top, { x: 0, y: 0, z: 2 }, clock)).z).toBeCloseTo(plannedZero(top).z - 2, 9);
    const bottom = withDatum(base(), { corner: 'center', height: 'bottom' }, clock);
    expect(datumPoint(withOffset(bottom, { x: 0, y: 0, z: 1.5 }, clock)).z).toBeCloseTo(fixtureTop(bottom) + 1.5, 9);
  });

  it('is saved with the job only when set, and survives a round trip', () => {
    const j = withOffset(base(), { x: 0, y: 0, z: 2 }, clock);
    expect(j.placement.offset).toEqual({ x: 0, y: 0, z: 2 });
    const back = JSON.parse(JSON.stringify(j)) as unknown;
    expect(isJob(back)).toBe(true);
    expect('offset' in withOffset(j, { x: 0, y: 0, z: 0 }, clock).placement).toBe(false);
  });

  it('is in Run’s zero check words', () => {
    const j = withOffset(withDatum(base(), { corner: 'center', height: 'top' }, clock), { x: 0, y: 0, z: 2 }, clock);
    expect(placeWords(setupPlan(j))).toBe('the centre of the top of the stock, 2 mm below the top');
    const b = withOffset(withDatum(base(), { corner: 'front-left', height: 'bottom' }, clock), { x: 3, y: 0, z: 1 }, clock);
    expect(placeWords(setupPlan(b))).toBe('the front-left corner of the bottom of the stock, moved in 3 mm in X and 0 mm in Y, 1 mm above the bottom');
    const zero = plannedZero(j);
    expect(runZeroCheck(zero, null, setupPlan(j), true).state).toBe('match');
    expect(runZeroCheck({ ...zero, z: zero.z + 2 }, null, setupPlan(j), true).state).toBe('differs');
  });
});

describe('the machine’s work zero as the placement', () => {
  const live = { x: 140, y: 95, z: -20 };
  it('places the job at the board’s zero only while it is known, and keeps only the choice in the job', () => {
    const j = withMachineZero(base(), true, clock);
    expect(j.placement.zeroFrom).toBe('machine');
    expect(JSON.stringify(j)).not.toContain('140');
    expect(effectiveZero(j, live)).toEqual(live);
    expect(effectiveZero(j, null)).toEqual(plannedZero(j));
    expect(effectiveZero(base(), live)).toEqual(plannedZero(base()));
    expect(isJob(JSON.parse(JSON.stringify(j)))).toBe(true);
  });

  it('is turned off by picking a point, and counts as the user’s choice', () => {
    const j = withMachineZero(withFile(base(), 'aaa'), true, clock);
    expect(datumPickedByUser(j)).toBe(true);
    expect(withDatum(j, { corner: 'center', height: 'top' }, clock).placement.zeroFrom).toBeUndefined();
    expect(withMachineZero(j, false, clock).placement.zeroFrom).toBeUndefined();
  });

  it('draws the toolpath at the board’s zero, and at the planned zero (with the depth) otherwise', () => {
    const j = withMachineZero(base(), true, clock);
    expect(jobScene(j, SCENE_COLORS, null, effectiveZero(j, live)).pathOffset).toEqual([140, 95, -20]);
    const deep = withOffset(base(), { x: 0, y: 0, z: 2 }, clock);
    expect(jobScene(deep, SCENE_COLORS, null).pathOffset[2]).toBeCloseTo(plannedZero(base()).z - 2, 9);
  });

  it('computes the margins from the board’s zero', () => {
    const j = withMachineZero(base(), true, clock);
    const cut = { minX: 0, maxX: 10, minY: 0, maxY: 10 };
    const at = placeMargins(j, cut, 0, effectiveZero(j, live));
    const moved = placeMargins(j, cut, 0, effectiveZero(j, { ...live, x: live.x + 5 }));
    expect(moved.left - at.left).toBeCloseTo(5, 9);
    expect(moved.right - at.right).toBeCloseTo(-5, 9);
  });

  it('makes Run’s zero check compare the board with itself, in plain words', () => {
    const j = withMachineZero(base(), true, clock);
    const plan = setupPlan(j, live);
    expect(plan.machine).toBe(true);
    expect(placeWords(plan)).toBe('the machine’s work zero');
    const check = runZeroCheck(live, null, plan, true);
    expect(check.state).toBe('match');
    expect(check.text).toBe('The board’s work zero is where you planned it: the machine’s work zero (X 140.000 Y 95.000 Z −20.000 (machine)).');
    // Disconnected: the plan falls back to the point on the stock.
    expect(setupPlan(j, null).machine).toBeUndefined();
  });
});

describe('C30’s work zero in plain words (lead, 2026-11-10)', () => {
  it('says where the job cuts from; the numbers go under Details', async () => {
    const { c30ZeroNumbers, c30ZeroWords } = await import('../src/workspace/run/c30Zero.ts');
    const board = { x: 140, y: 95, z: -20 };
    const machine = { zero: board, corner: 'center', height: 'top', machine: true } as const;
    const centre = { zero: board, corner: 'center', height: 'top', offset: { x: 0, y: 0, z: 2 } } as const;
    const check = (state: 'match' | 'differs', source: 'setup' | 'saved' | 'none') => ({ state, source, text: '', planText: '', board, plan: board }) as never;
    expect(c30ZeroWords(board, check('match', 'setup'), machine, true)).toBe('the machine’s work zero');
    expect(c30ZeroWords(board, check('match', 'setup'), centre, true)).toBe('the centre of the top of the stock, 2 mm below the top');
    expect(c30ZeroWords(board, check('match', 'saved'), null, true)).toBe('the work zero you saved');
    expect(c30ZeroWords(board, check('differs', 'setup'), centre, true)).toBe('the board’s work zero, not your plan’s');
    expect(c30ZeroWords(board, check('differs', 'setup'), centre, false)).toBe('the board’s work zero');
    expect(c30ZeroWords(board, check('differs', 'none'), null, true)).toBe('the board’s work zero');
    expect(c30ZeroWords(null, check('differs', 'none'), null, true)).toBe('not read');
    expect(c30ZeroWords(board, check('match', 'setup'), machine, true)).not.toMatch(/\d/);
    expect(c30ZeroNumbers(board)).toBe('Work zero on the board: X 140.000 Y 95.000 Z −20.000 (machine).');
    expect(c30ZeroNumbers(null)).toBeNull();
  });
});
