/**
 * The Inputs model (Board settings spec §5.4): rows from the data's inputs,
 * the homing summary, and the consequences of a change, with the owner's 449
 * switch modes (pictures 152-157).
 */
import { describe, expect, it } from 'vitest';
import { settingsDefsFor } from '@synthetos/schema';
import { homingSummary, inputConsequences, inputRows, pendingConsequences } from '../src/workspace/views/board/inputsModel.ts';

const d449 = settingsDefsFor('tinyg-449-stock')!;
const d450 = settingsDefsFor('tinyg-en')!;
const s = { xsn: 1, xsx: 0, ysn: 1, ysx: 0, zsn: 4, zsx: 1, asn: 1, asx: 0 };

describe('homingSummary', () => {
  it('says which end each axis homes towards, and at which pin', () => {
    expect(homingSummary(d449, s, ['x', 'y', 'z', 'a']).map((x) => x.text)).toEqual(['X homes towards min · J7.3', 'Y homes towards min · J7.5', 'Z homes towards max · J8.4', 'A homes towards min · J8.5']);
  });

  it('names an axis with no homing switch, and one set to home on both ends', () => {
    const out = homingSummary(d450, { ...s, asn: 0, zsn: 1 }, ['x', 'y', 'z', 'a']);
    expect(out.find((x) => x.axis === 'a')?.text).toBe('A no homing switch');
    expect(out.find((x) => x.axis === 'z')?.text).toBe('Z homes on both ends');
  });
});

describe('inputConsequences', () => {
  it('a limit turned off', () => {
    // The input's one name from the data file (review finding 10).
    expect(inputConsequences(d450, { ...s, xsx: 2 }, { ...s, xsx: 0 })).toContain('X max switch is no longer a limit. Only soft limits stop X at the far end.');
    expect(inputConsequences(d450, { ...s, ysn: 3 }, { ...s, ysn: 1 })).toContain('Y min switch is no longer a limit. Only soft limits stop Y at the near end.');
  });

  it('homing on both ends', () => {
    expect(inputConsequences(d450, s, { ...s, zsn: 1, zsx: 1 })).toContain("Z can't home on both ends. Choose one.");
  });

  it('a probe on A on 449, and a second probe', () => {
    expect(inputConsequences(d449, s, { ...s, asn: 4 })).toContain('A probe is allowed only on X, Y or Z on this firmware.');
    expect(inputConsequences(d450, s, { ...s, xsx: 4 })).toContain('Only one input can be the probe.');
  });

  it('an enabled axis left without a homing switch', () => {
    expect(inputConsequences(d450, { ...s, yam: 1 }, { ...s, yam: 1, ysn: 0 })).toContain('Y has no homing switch. Home all skips Y.');
    expect(inputConsequences(d450, { ...s, yam: 0 }, { ...s, yam: 0, ysn: 0 })).toEqual([]);
  });

  it('nothing to say when nothing changes for the worse', () => {
    expect(inputConsequences(d450, s, s)).toEqual([]);
  });
});

describe('pendingConsequences', () => {
  it('is empty for a steady board, even with an axis that has no homing switch', () => {
    const steady = { ...s, yam: 1, ysn: 0 };
    expect(inputConsequences(d450, steady, steady)).toHaveLength(1);
    expect(pendingConsequences(d450, steady, steady)).toEqual([]);
  });

  it('counts a consequence the pending change adds', () => {
    const board = { ...s, yam: 1 };
    expect(pendingConsequences(d450, board, { ...board, ysn: 0 })).toEqual(['Y has no homing switch. Home all skips Y.']);
  });
});

describe('inputRows', () => {
  it('one row per input in the data, board value, planned value and pending', () => {
    const rows = inputRows(d450, s, { xsn: 3 });
    expect(rows.map((r) => [r.id, r.label, r.pin, r.functionKey])).toEqual([
      ['xmin', 'X min switch', 'J7.3', 'xsn'], ['xmax', 'X max switch', 'J7.4', 'xsx'], ['ymin', 'Y min switch', 'J7.5', 'ysn'], ['ymax', 'Y max switch', 'J7.6', 'ysx'],
      ['zmin', 'Z min switch', 'J8.3', 'zsn'], ['zmax', 'Z max switch', 'J8.4', 'zsx'], ['amin', 'A min switch', 'J8.5', 'asn'], ['amax', 'A max switch', 'J8.6', 'asx'],
    ]);
    expect(rows[0]).toMatchObject({ board: 1, planned: 3, pending: true, state: null });
    expect(rows[1]).toMatchObject({ board: 0, planned: 0, pending: false });
  });

  it('live states map to pressed, released and off', () => {
    const rows = inputRows(d450, s, {}, { in6: 1, in2: -1, in1: 0 });
    expect(rows.find((r) => r.id === 'zmax')?.state).toBe('pressed');
    expect(rows.find((r) => r.id === 'xmax')?.state).toBe('off');
    expect(rows.find((r) => r.id === 'xmin')?.state).toBe('released');
    expect(rows.find((r) => r.id === 'ymin')?.state).toBeNull();
  });

  it('an unread switch has null values', () => {
    expect(inputRows(d450, {}, {})[0]).toMatchObject({ board: null, planned: null, pending: false });
  });
});
