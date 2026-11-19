/**
 * The Axes model (Board settings spec §5.6) with the owner's 157 values: soft limits off; X, Y, Z standard; A in
 * radius mode with start and end both -1 and a 5° latch backoff; B and C off.
 */
import { describe, expect, it } from 'vitest';
import { settingsDefsFor } from '@synthetos/schema';
import { axisCards, travelLine } from '../src/workspace/views/board/axesModel.ts';

const d450 = settingsDefsFor('tinyg-en')!;
const EN = { dialectId: 'tinyg-en' } as const;
const S449 = { dialectId: 'tinyg-449-stock' } as const;
const d449 = settingsDefsFor('tinyg-449-stock')!;
export const OWNER_157 = {
  sl: 0, ja: 2_000_000, ct: 0.01,
  xam: 1, xvm: 800, xfr: 800, xtn: 0, xtm: 150, xjm: 20, xjd: 0.05, xsv: 500, xlv: 100, xlb: 5, xzb: 2, xjh: 40, xsn: 1, xsx: 0,
  yam: 1, yvm: 800, yfr: 800, ytn: 0, ytm: 150, yjm: 20, yjd: 0.05, ysv: 500, ylv: 100, ylb: 5, yzb: 2, yjh: 40, ysn: 1, ysx: 0,
  zam: 1, zvm: 800, zfr: 800, ztn: -75, ztm: 0, zjm: 20, zjd: 0.05, zsv: 400, zlv: 100, zlb: 5, zzb: 2, zjh: 40, zsn: 4, zsx: 1,
  aam: 3, avm: 230_400, afr: 230_400, atn: -1, atm: -1, ajm: 5760, ajd: 0.05, ara: 10, asv: 600, alv: 100, alb: 5, azb: 2, ajh: 5760, asn: 1, asx: 0,
  bam: 0, bvm: 3600, bfr: 3600, btn: -1, btm: -1, bjm: 20, bjd: 0.05, bra: 1,
  cam: 0, cvm: 3600, cfr: 3600, ctn: -1, ctm: -1, cjm: 20, cjd: 0.05, cra: 1,
  '1ma': 0, '2ma': 1, '3ma': 2, '4ma': 3,
};
const s = OWNER_157;
const cards = axisCards(d450, s, ['x', 'y', 'z', 'a'], EN);
const cardOf = (a: string) => cards.cards.find((c) => c.axis === a);

describe('axisCards', () => {
  it('B and C, off and not used, collapse into one line', () => {
    expect(cards.collapsedOff).toEqual(['b', 'c']);
    expect(cards.cards.map((c) => c.axis)).toEqual(['x', 'y', 'z', 'a']);
  });

  it('the machine\'s axes start open; an unused axis whose mode is not Off is still listed, closed', () => {
    expect(cards.cards.every((c) => c.open)).toBe(true);
    const xyz = axisCards(d450, s, ['x', 'y', 'z'], EN);
    expect(xyz.cards.find((c) => c.axis === 'a')?.open).toBe(true);
    expect(axisCards(d450, { ...s, aam: 0 }, ['x', 'y', 'z'], EN).collapsedOff).toEqual(['a', 'b', 'c']);
  });

  it('summaries come from the data', () => {
    expect(cardOf('a')?.summary).toContain('Rotary, radius mode');
    expect(cardOf('x')?.summary).toBe('X axis · Standard · 0 to 150 mm · 800 mm/min · homes towards min');
    expect(cardOf('a')?.rotary).toBe(true);
    expect(cardOf('a')?.motor).toBe(4);
  });

  it('the homing line names the switch and its pin, from Inputs', () => {
    expect(cardOf('x')?.homingLine).toBe('Homes towards min at the X min switch, J7.3.');
    expect(cardOf('z')?.homingLine).toBe('Homes towards max at the Z max switch, J8.4.');
    // The one link to Inputs is the card's own (review finding 10): the line states the fact only.
    expect(axisCards(d450, { ...s, xsn: 0 }, ['x'], EN).cards[0]?.homingLine).toBe('No homing switch.');
    expect(axisCards(d450, { ...s, xsx: 1 }, ['x'], EN).cards[0]?.homingLine).toBe('Homes on both ends.');
  });

  it('a mode other than Standard gets one line in words from the data', () => {
    expect(cardOf('x')?.modeLine).toBeNull();
    expect(axisCards(d450, { ...s, yam: 0 }, ['x', 'y'], EN).cards.find((c) => c.axis === 'y')?.modeLine).toBe('Mode Off: the board ignores moves on this axis.');
  });
});

describe('travelLine', () => {
  it('soft limits off, then the homing search', () => {
    expect(travelLine(d450, s, 'x', EN)).toBe('Soft limits are off, so these ends are not checked. Homing searches 155 mm.');
  });

  it('equal ends on 450 in radius mode: turns freely, searches one full turn', () => {
    expect(travelLine(d450, { ...s, sl: 1 }, 'a', EN)).toBe('No travel limit: the axis turns freely. Start and end are the same, so the board never checks this axis. Homing searches one full turn.');
  });

  it('equal ends on 449: searches only the latch backoff', () => {
    expect(travelLine(d449, { ...s, sl: 1 }, 'a', S449)).toContain('Homing searches only 5°: start and end are the same on this firmware. Set a travel range before homing A.');
  });

  it('equal ends and no backoff: homing stops with an error', () => {
    expect(travelLine(d449, { ...s, sl: 1, alb: 0 }, 'a', S449)).toContain('Homing will stop with an error: the search distance is 0.');
  });

  it('an end at or below -1 000 000 has no limit', () => {
    expect(travelLine(d450, { ...s, sl: 1, xtn: -1_000_000 }, 'x', EN)).toContain('No limit at this end.');
  });

  it('a normal range with soft limits on says only the homing search; no homing switch says nothing about it', () => {
    expect(travelLine(d450, { ...s, sl: 1 }, 'x', EN)).toBe('Homing searches 155 mm.');
    expect(travelLine(d450, { ...s, sl: 1, xsn: 0 }, 'x', EN)).toBe('');
  });
});
