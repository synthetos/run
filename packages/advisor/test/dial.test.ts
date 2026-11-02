/** Dial routers: rpm to the nearest dial setting, from the machine profile's table. */
import { describe, expect, it } from 'vitest';
import { EXAMPLE_DIALS, dialAdvice, dialTableProblem, groupThousands, nearestDialSetting, type DialSetting } from '../src/index.ts';
import { MAKITA_DIAL } from './fixtures.ts';

describe('nearestDialSetting', () => {
  it('maps a speed to the nearest position', () => {
    expect(nearestDialSetting(13_300, MAKITA_DIAL)).toEqual({ setting: '2', rpm: 12_000, deltaRpm: -1300 });
    expect(nearestDialSetting(18_000, MAKITA_DIAL)).toMatchObject({ setting: '3' });
    expect(nearestDialSetting(5000, MAKITA_DIAL)).toMatchObject({ setting: '1', deltaRpm: 5000 });
    expect(nearestDialSetting(40_000, MAKITA_DIAL)).toMatchObject({ setting: '6' });
  });

  it('breaks a tie towards the slower position, whatever the table order', () => {
    expect(nearestDialSetting(14_500, MAKITA_DIAL)).toMatchObject({ setting: '2' });
    expect(nearestDialSetting(14_500, [...MAKITA_DIAL].reverse())).toMatchObject({ setting: '2' });
  });

  it('refuses a bad speed or table', () => {
    expect(nearestDialSetting(Number.NaN, MAKITA_DIAL)).toBeNull();
    expect(nearestDialSetting(0, MAKITA_DIAL)).toBeNull();
    expect(nearestDialSetting(10_000, [])).toBeNull();
    const bad: unknown[] = [
      'x',
      [null],
      [{ setting: '', rpm: 1 }],
      [{ setting: 3, rpm: 1 }],
      [{ setting: '1', rpm: 0 }],
      [{ setting: '1', rpm: Number.POSITIVE_INFINITY }],
      [
        { setting: '1', rpm: 1 },
        { setting: '1', rpm: 2 },
      ],
    ];
    for (const table of bad) {
      expect(dialTableProblem(table as DialSetting[])).not.toBeNull();
      expect(nearestDialSetting(10_000, table as DialSetting[])).toBeNull();
    }
    expect(dialTableProblem(MAKITA_DIAL)).toBeNull();
  });

  it('words the advice ("turn the dial to 3")', () => {
    expect(dialAdvice(17_200, MAKITA_DIAL)).toBe('Turn the dial to 3 (about 17,000 rpm).');
    expect(dialAdvice(Number.NaN, MAKITA_DIAL)).toBeNull();
    expect(groupThousands(1_234_567.4)).toBe('1,234,567');
    expect(groupThousands(999)).toBe('999');
  });

  it('the Makita example is a placeholder to verify (§5.1)', () => {
    const makita = EXAMPLE_DIALS[0];
    expect(makita?.router).toBe('Makita RT0701C');
    expect(makita?.dial).toMatchObject({ placeholder: true, note: expect.stringMatching(/verify/) });
    expect(makita?.dial.value.map((d) => d.rpm)).toEqual(MAKITA_DIAL.map((d) => d.rpm));
  });
});
