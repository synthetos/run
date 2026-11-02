/**
 * Dial routers (MACHINING_ASSISTANT §5.1, §6.3 "turn the dial to 3", §6.5 C).
 *
 * A trim router's speed is set by hand on a dial, so the only actuator is
 * the operator. The dial-to-rpm table comes from the machine profile;
 * `nearestDialSetting` maps a speed to the nearest position (on a tie, the
 * slower one).
 */
import { deepFreeze, type Sourced } from '@synthetos/library';
import type { DialSetting } from './types.ts';

export interface DialChoice {
  readonly setting: string;
  readonly rpm: number;
  /** The chosen position's speed minus the wanted speed. */
  readonly deltaRpm: number;
}

/** Why a dial table cannot be used, or null when it can. */
export function dialTableProblem(dial: readonly DialSetting[]): string | null {
  if (!Array.isArray(dial) || dial.length === 0) return 'The dial table is empty.';
  const seen = new Set<string>();
  for (const d of dial) {
    if (typeof d !== 'object' || d === null || typeof d.setting !== 'string' || d.setting === '') return 'Every dial position needs a label.';
    if (!(typeof d.rpm === 'number' && Number.isFinite(d.rpm) && d.rpm > 0)) return `Dial position ${d.setting} needs a positive speed.`;
    if (seen.has(d.setting)) return `Dial position ${d.setting} is listed twice.`;
    seen.add(d.setting);
  }
  return null;
}

/** The dial position nearest to `rpm` (ties go to the slower one), or null for a bad speed or table. */
export function nearestDialSetting(rpm: number, dial: readonly DialSetting[]): DialChoice | null {
  if (!(Number.isFinite(rpm) && rpm > 0) || dialTableProblem(dial) !== null) return null;
  let best = dial[0] as DialSetting;
  for (const d of dial) {
    const better = Math.abs(d.rpm - rpm) < Math.abs(best.rpm - rpm);
    const tieSlower = Math.abs(d.rpm - rpm) === Math.abs(best.rpm - rpm) && d.rpm < best.rpm;
    if (better || tieSlower) best = d;
  }
  return Object.freeze({ setting: best.setting, rpm: best.rpm, deltaRpm: best.rpm - rpm });
}

/** 17000 -> "17,000" (locale-independent, so the text is deterministic). */
export function groupThousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "Turn the dial to 3 (about 17,000 rpm)." or null. */
export function dialAdvice(rpm: number, dial: readonly DialSetting[]): string | null {
  const choice = nearestDialSetting(rpm, dial);
  if (choice === null) return null;
  return `Turn the dial to ${choice.setting} (about ${groupThousands(choice.rpm)} rpm).`;
}

/**
 * Example dial tables. §5.1 gives the Makita RT0701C as "dial 1-6 is about
 * 10k-30k rpm, to verify": the positions below are the commonly quoted
 * figures and stay placeholders until checked on a router.
 */
export const EXAMPLE_DIALS: readonly { readonly router: string; readonly dial: Sourced<readonly DialSetting[]> }[] = deepFreeze([
  {
    router: 'Makita RT0701C',
    dial: {
      value: [
        { setting: '1', rpm: 10_000 },
        { setting: '2', rpm: 12_000 },
        { setting: '3', rpm: 17_000 },
        { setting: '4', rpm: 22_000 },
        { setting: '5', rpm: 27_000 },
        { setting: '6', rpm: 30_000 },
      ],
      placeholder: true,
      note: 'Example to verify (MACHINING_ASSISTANT §5.1).',
    },
  },
]);
