/** Which axes the Position panel shows (first-time walk 2026-11-08, C24). */
import { describe, expect, it } from 'vitest';
import { machineAxes } from '../src/workspace/motion.ts';

describe('machineAxes (C24)', () => {
  it('with a profile, the profile decides: no A unless it has one, whatever the board’s default', () => {
    expect(machineAxes({ aam: 1 }, { axes: {} })).toEqual(['x', 'y', 'z']);
    expect(machineAxes({ aam: 1 }, {})).toEqual(['x', 'y', 'z']);
    expect(machineAxes({ aam: 0 }, { axes: { a: { travel: 360 } } })).toEqual(['x', 'y', 'z', 'a']);
  });
  it('with no profile, the board’s A axis mode decides', () => {
    expect(machineAxes({ aam: 1 }, null)).toEqual(['x', 'y', 'z', 'a']);
    expect(machineAxes({ aam: 0 }, null)).toEqual(['x', 'y', 'z']);
    expect(machineAxes({}, null)).toEqual(['x', 'y', 'z']);
  });
});
