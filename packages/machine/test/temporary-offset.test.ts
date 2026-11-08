/**
 * The G92 hint beside the live position (temporaryOffset.ts): the G92 the board applies now, from its reported
 * machine and work positions and the offsets last read. Display only; the reads it needs missing means "cannot
 * tell", never a guess.
 */
import { describe, expect, it } from 'vitest';
import { snapshotOf, type SessionSnapshot } from '../src/index.ts';
import { temporaryOffsetActive, temporaryOffsetNow } from '../src/temporaryOffset.ts';
import { Driver, EN_ANSWERS } from './sessionDriver.ts';

const BASE = ((): SessionSnapshot => {
  const d = new Driver();
  d.open();
  d.answer(EN_ANSWERS);
  return snapshotOf(d.state);
})();

const xyz = (x: number, y = 0, z = 0): { value: Record<string, number>; status: number; at: number } => ({ value: { x, y, z }, status: 0, at: 1 });

function at(live: Partial<SessionSnapshot['live']>, values: Record<string, unknown>): SessionSnapshot {
  const { coor: _c, unit: _u, ...rest } = BASE.live;
  return { ...BASE, live: { ...rest, ...live } as SessionSnapshot['live'], values: values as SessionSnapshot['values'] };
}

const READS = { ofs: xyz(0), g92: xyz(0), unit: { value: 1, status: 0, at: 1 }, coor: { value: 1, status: 0, at: 1 }, g54: xyz(0), g56: xyz(-30) };

describe('the G92 the board applies now', () => {
  it('a job’s own G92: the whole offset moved since ofs was read', () => {
    const s = at({ mpo: { x: 0, y: 0, z: 0 }, pos: { x: 5, y: -20, z: -1 } }, READS);
    expect(temporaryOffsetNow(s)).toEqual({ x: -5, y: 20, z: 1 });
    expect(temporaryOffsetActive(s)).toBe(true);
  });

  it('the units: from the reported unit, else the read one; the reads in the units read beside them', () => {
    expect(temporaryOffsetNow(at({ mpo: { x: 25.4, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 } }, { ...READS, unit: { value: 0, status: 0, at: 1 } }))?.x).toBeCloseTo(25.4, 9);
    expect(temporaryOffsetNow(at({ mpo: { x: 25.4, y: 0, z: 0 }, pos: { x: 1, y: 0, z: 0 }, unit: 0 }, { ...READS, unit: undefined }))?.x).toBeCloseTo(0, 9);
    // In inches a few hundredths of a millimetre are rounding.
    expect(temporaryOffsetActive(at({ mpo: { x: 25.42, y: 0, z: 0 }, pos: { x: 1, y: 0, z: 0 }, unit: 0 }, READS))).toBe(false);
  });

  it('a coordinate system selected since the read is not a G92; G53 or an unread system is left as it is', () => {
    expect(temporaryOffsetActive(at({ mpo: { x: -30, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 }, coor: 3 }, READS))).toBe(false);
    expect(temporaryOffsetNow(at({ mpo: { x: -30, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 }, coor: 0 }, READS))).toEqual({ x: -30, y: 0, z: 0 });
    expect(temporaryOffsetNow(at({ mpo: { x: -30, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 }, coor: 2 }, READS))).toEqual({ x: -30, y: 0, z: 0 });
    expect(temporaryOffsetNow(at({ mpo: { x: -30, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 }, coor: 3 }, { ...READS, coor: undefined }))).toEqual({ x: -30, y: 0, z: 0 });
  });

  it('cannot tell without both positions, ofs and g92 on X, Y and Z, or any units', () => {
    const live = { mpo: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 } };
    expect(temporaryOffsetActive(at({ ...live, pos: { x: 0, y: 0 } }, READS))).toBeNull();
    expect(temporaryOffsetNow(at({ ...live, pos: { x: 0, y: 0 } }, READS))).toBeNull();
    expect(temporaryOffsetActive(at({ ...live, mpo: { x: 0, y: 0, z: Number.NaN } }, READS))).toBeNull();
    expect(temporaryOffsetActive(at(live, { ...READS, ofs: { value: { x: 0, y: 0 }, status: 0, at: 1 } }))).toBeNull();
    expect(temporaryOffsetActive(at(live, { ...READS, ofs: { value: [0, 0, 0], status: 0, at: 1 } }))).toBeNull();
    expect(temporaryOffsetActive(at(live, { ...READS, g92: { ...xyz(1), status: 40 } }))).toBeNull();
    expect(temporaryOffsetActive(at(live, { ...READS, g92: undefined }))).toBeNull();
    expect(temporaryOffsetActive(at(live, { ...READS, unit: { value: 'mm', status: 0, at: 1 } }))).toBeNull();
    expect(temporaryOffsetActive(at(live, READS))).toBe(false);
  });
});
