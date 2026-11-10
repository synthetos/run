/**
 * The allow-matrix as a pinned table (ROADMAP P0-10, SAFETY §4.1): for every base state, with no overlay and with
 * each overlay on its own, classified and not, which intents each release allows. allowMatrix.test.ts proves rules
 * over the generated cells (every denial explained, Start only from ARMED, stop-class everywhere connected), but a
 * rule can hold while a row's states change: an emptied `states` for Clear alarm, or a state name blanked out of the
 * Jog row, kept every rule and survived mutation testing (local Stryker run, 2026-11-09). Here every row's reach is
 * written down, so any change to it is a reviewed change to this snapshot.
 *
 * Also pinned: the denial an unidentified read-only board gets (it says why: the board could not be identified, not
 * that its firmware is refused) and the release names the worker and the logs show.
 */
import { describe, expect, it } from 'vitest';
import {
  BASE_STATES,
  CURRENT_RELEASE,
  INTENTS,
  OVERLAYS,
  PHASE_1_RELEASE,
  PHASE_1_SETTINGS_RELEASE,
  PHASE_2_RELEASE,
  allowed,
  type Overlay,
  type Release,
} from '../src/index.ts';

const OPEN: Release = { name: 'all gates open', motion: true, write: true, port: true, settings: true, reports: true, jobs: true, flash: true };
const RELEASES: readonly Release[] = [CURRENT_RELEASE, PHASE_1_RELEASE, PHASE_2_RELEASE, PHASE_1_SETTINGS_RELEASE, OPEN];
const OVERLAY_CASES: readonly (readonly Overlay[])[] = [[], ...OVERLAYS.map((o) => [o])];

describe('the allow-matrix table', () => {
  it('pins which intents each release allows in every base state, with no overlay and with each overlay alone', () => {
    const table: Record<string, string> = {};
    for (const release of RELEASES) {
      for (const base of BASE_STATES) {
        for (const overlays of OVERLAY_CASES) {
          for (const classified of [true, false]) {
            const allowedIntents = INTENTS.filter((intent) => allowed({ base, overlays, classified, enqCapable: true }, intent, release).allowed);
            table[`${release.name} | ${base} | ${overlays.join('+') || '-'} | ${classified ? 'classified' : 'unclassified'}`] = allowedIntents.join(' ');
          }
        }
      }
    }
    expect(table).toMatchSnapshot();
  });

  it('an unidentified board under READ_ONLY is told it could not be identified; an identified one is told why it is read-only', () => {
    const unidentified = allowed({ base: 'IDLE_HOMED', overlays: ['READ_ONLY'], classified: false, enqCapable: true }, 'jog', OPEN);
    const identified = allowed({ base: 'IDLE_HOMED', overlays: ['READ_ONLY'], classified: true, enqCapable: true }, 'jog', OPEN);
    expect(unidentified).toMatchObject({ allowed: false, reason: expect.stringContaining('could not identify this board') as unknown as string, citation: 'SAFETY §3 READ_ONLY; §4.1 Anything else row' });
    expect(identified.allowed).toBe(false);
    expect(identified).not.toMatchObject({ reason: expect.stringContaining('could not identify') as unknown as string });
    // Any other overlay on an unidentified board keeps its own denial.
    const stale = allowed({ base: 'IDLE_HOMED', overlays: ['STALE'], classified: false, enqCapable: true }, 'jog', OPEN);
    expect(stale).not.toMatchObject({ reason: expect.stringContaining('could not identify') as unknown as string });
  });

  it('names its releases', () => {
    expect(RELEASES.map((r) => r.name)).toEqual(['Phase 0', 'Phase 1', 'Phase 2', 'Phase 1 + settings writes', 'all gates open']);
  });
});
