/**
 * Probe Z's page logic (SAFETY §4.5c, H90): the probe view read off the snapshot, the Setup form against the limits,
 * the last thickness kept in this browser, the plain copy for every block and outcome, and the safety strings
 * word for word from SAFETY.md.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROBE_LIMITS, probeStopMm, type ProbeBlock, type ProbeOutcome } from '@synthetos/machine';
import { probeSnap } from './probeFixture.ts';
import { INITIAL_LIVE_VIEW, type LiveView } from '../src/workspace/model.ts';
import { probeSnapshotOf, probeView } from '../src/workspace/probe/probeView.ts';
import { checkForm, initialForm, parseNumber, probeSeconds } from '../src/workspace/probe/probeForm.ts';
import { lastThickness, rememberThickness } from '../src/workspace/probe/probeMemory.ts';
import { alarmMeaning, BLOCK_COPY, outcomeCopy, outcomeStatus } from '../src/workspace/probe/probeCopy.ts';
import { c39, mm, w51, w52 } from '../src/workspace/probe/probeStrings.ts';
import type { StorageLike } from '../src/workspace/storage.ts';

function view(snapshot: Record<string, unknown> | null, motion = true): LiveView {
  if (snapshot === null) return INITIAL_LIVE_VIEW;
  return { ...INITIAL_LIVE_VIEW, message: { snapshot: { base: 'IDLE_UNHOMED', identity: { id: 'SIM-1' }, probe: null, ...snapshot }, motion } as unknown as LiveView['message'] };
}

describe('probeView: the probe view off the snapshot', () => {
  it('not connected without a snapshot or with the port closed', () => {
    expect(probeView(null)).toMatchObject({ block: 'notConnected', probe: null, boardId: null });
    expect(probeView(view(null)).block).toBe('notConnected');
    expect(probeView(view({ base: 'NOT_CONNECTED' })).block).toBe('notConnected');
  });

  it('blocked as motionOff until the session publishes it, or without the motion release', () => {
    expect(probeView(view({}))).toMatchObject({ block: 'motionOff', probe: null, boardId: 'SIM-1' });
    // The identification progress shares the name `probe`; it is not a probe view.
    expect(probeView(view({ probe: { answered: 1, of: 4, banner: 'none', restarts: 0 } })).block).toBe('motionOff');
    expect(probeView(view({ probeZ: probeSnap() }, false)).block).toBe('motionOff');
    expect(probeView(view({ identity: null, probeZ: probeSnap() })).boardId).toBeNull();
  });

  it('the session’s own block, from probeZ or probe', () => {
    expect(probeView(view({ probeZ: probeSnap() }))).toMatchObject({ block: null, boardId: 'SIM-1' });
    expect(probeView(view({ probe: probeSnap({ block: 'alarm' }) })).block).toBe('alarm');
    expect(probeSnapshotOf(null)).toBeNull();
    expect(probeSnapshotOf({ probeZ: { step: 'closed', touch: null, plateOut: false } })).toBeNull();
  });
});

describe('probeForm: Setup against the limits', () => {
  it('starts empty, or from the last thickness, with the default depth and feed', () => {
    expect(initialForm(null)).toMatchObject({ thickness: '', depth: '5', feed: '25', depthCustom: false, feedCustom: false, spindleStopped: false });
    expect(initialForm(12.7).thickness).toBe('12.7');
  });

  it('reads plain decimals only', () => {
    expect(parseNumber(' 12.7 ')).toBe(12.7);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('3.')).toBe(3);
    for (const bad of ['', '1e3', '-2', '1,5', 'abc', '1.2.3']) expect(parseNumber(bad)).toBeNull();
  });

  it('accepts a valid plan with its calculated stop distance', () => {
    const r = checkForm({ ...initialForm(12.7), spindleStopped: true }, 40);
    expect(r).toEqual({ ok: true, thicknessMm: 12.7, depthMm: 5, feed: 25, stopMm: probeStopMm(25, 40) });
  });

  it('says what is wrong with each field', () => {
    const f = initialForm(null);
    expect(checkForm(f, 40)).toMatchObject({ ok: false, errors: { thickness: 'Enter the plate’s thickness.' } });
    expect(checkForm({ ...f, thickness: '60' }, 40)).toMatchObject({ ok: false, errors: { thickness: 'Plate thickness can be 0.1 to 50 mm.' } });
    expect(checkForm({ ...f, thickness: '10', depth: '16' }, 40)).toMatchObject({ ok: false, errors: { depth: 'Depth limit can be 1 to 15 mm.' } });
    expect(checkForm({ ...f, thickness: '10', feed: '5' }, 40)).toMatchObject({ ok: false, errors: { feed: 'Feed can be 10 to 100 mm/min.' } });
    expect(checkForm({ ...f, thickness: '10' }, null)).toMatchObject({ ok: false, stopMm: null, errors: { feed: expect.stringContaining('Z jerk isn’t read') } });
    // At a low jerk the stop distance passes its limit.
    const slow = checkForm({ ...f, thickness: '10', feed: '100' }, 5);
    expect(slow).toMatchObject({ ok: false, errors: { feed: 'At this feed Z would travel too far after contact. Choose a slower feed.' } });
    expect((slow as { stopMm: number }).stopMm).toBeGreaterThan(PROBE_LIMITS.maxStopMm);
  });

  it('seconds to the depth limit, rounded up', () => {
    expect(probeSeconds(5, 25)).toBe(12);
    expect(probeSeconds(10, 50)).toBe(12);
    expect(probeSeconds(1, 50)).toBe(2);
  });
});

describe('probeMemory: the last thickness per board, in this browser', () => {
  function memory(): StorageLike & { readonly data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  }

  it('remembers per board and ignores what is not valid', () => {
    const s = memory();
    expect(lastThickness('A', s)).toBeNull();
    rememberThickness('A', 12.7, s);
    rememberThickness('B', 3, s);
    expect(lastThickness('A', s)).toBe(12.7);
    expect(lastThickness('B', s)).toBe(3);
    expect(lastThickness('C', s)).toBeNull();
    expect(lastThickness(null, s)).toBeNull();
    rememberThickness(null, 5, s);
    s.data.set('run.ws.probe-thickness', JSON.stringify({ v: 1, value: { A: 99 } }));
    expect(lastThickness('A', s)).toBeNull();
    s.data.set('run.ws.probe-thickness', JSON.stringify({ v: 1, value: [1] }));
    expect(lastThickness('A', s)).toBeNull();
  });
});

const BLOCKS: readonly ProbeBlock[] = ['notConnected', 'lost', 'stale', 'otherTab', 'firmware', 'motionOff', 'settingsUnread', 'noInput', 'manyInputs', 'inputNotZ', 'jerkUnread', 'stopOverLimit', 'alarm', 'spindleOn', 'moving', 'homing', 'held', 'job', 'toolChange', 'unknown', 'needsReview', 'tempOffset', 'noWcs'];

const OUTCOMES: readonly ProbeOutcome[] = [
  { kind: 'contactZeroSet', zeroZ: 12.683, travelMm: 6.32, stopMm: 0.017 },
  { kind: 'noContact', travelMm: 5, status: 250 },
  { kind: 'noContact', travelMm: null, status: 250 },
  { kind: 'alreadyTripped', travelMm: 0, status: 250 },
  { kind: 'softLimit', status: 220 },
  { kind: 'limit', status: 203 },
  { kind: 'refused', status: 251, text: 'Probe travel is too small' },
  { kind: 'refused', status: 131, text: 'Input exceeds max value' },
  { kind: 'stopJob', status: 207 },
  { kind: 'paused' },
  { kind: 'lost', during: 'probe' },
  { kind: 'lost', during: 'zero' },
  { kind: 'noReport' },
  { kind: 'zeroRefused', status: 131, text: 'Bad number' },
  { kind: 'zeroUnconfirmed' },
  { kind: 'cancelled' },
];

describe('probeCopy: plain words', () => {
  it('every block has a reason, and never tells the owner to change a setting', () => {
    expect(Object.keys(BLOCK_COPY).sort()).toEqual([...BLOCKS].sort());
    for (const b of BLOCKS) {
      const c = BLOCK_COPY[b];
      expect(c.reason.length).toBeGreaterThan(5);
      expect(`${c.reason} ${c.next ?? ''}`).not.toMatch(/requested|prbp|jerk setting|zsn|rewire|change the (switch|setting)/i);
    }
  });

  it('every outcome says what happened, whether zero changed, and what is offered', () => {
    for (const o of OUTCOMES) {
      const c = outcomeCopy(o, 'G54');
      expect(c.headline.length).toBeGreaterThan(5);
      expect(`${c.headline} ${c.body}`).not.toMatch(/requested|sorry/i);
      // Only a contact the session reported says the zero is set.
      if (o.kind !== 'contactZeroSet') expect(`${c.headline} ${c.body}`).not.toMatch(/zero is set/);
    }
    expect(outcomeCopy(OUTCOMES[0] as ProbeOutcome, 'G55')).toMatchObject({ ok: true, action: 'lift', headline: 'Contact. Z zero is set.' });
    expect(outcomeCopy(OUTCOMES[0] as ProbeOutcome, 'G55').body).toContain('G55 Z at 12.683 mm after 6.32 mm');
    expect(outcomeCopy(OUTCOMES[1] as ProbeOutcome, 'G54').body).toContain('Z went down 5 mm');
    expect(outcomeCopy(OUTCOMES[2] as ProbeOutcome, 'G54').body).toMatch(/^Z went down and/);
    expect(outcomeCopy(OUTCOMES[5] as ProbeOutcome, 'G54').action).toBe('none');
    expect(outcomeCopy(OUTCOMES[6] as ProbeOutcome, 'G54').body).toContain('depth limit is too short');
    expect(outcomeCopy(OUTCOMES[7] as ProbeOutcome, 'G54').body).toContain('“Input exceeds max value”');
    expect(outcomeCopy({ kind: 'paused' }, 'G54').headline).toBe('Pause ended the probe. Z zero is unchanged.');
  });

  it('the status for Advanced, and the meaning C13 names', () => {
    expect(outcomeStatus({ kind: 'softLimit', status: 220 })).toBe(220);
    expect(outcomeStatus({ kind: 'paused' })).toBeNull();
    for (const o of OUTCOMES) expect(alarmMeaning(o, 2).length).toBeGreaterThan(10);
    expect(alarmMeaning(null, 2)).toContain('state 2');
    expect(alarmMeaning(null, undefined)).toContain('state unknown');
    expect(alarmMeaning({ kind: 'limit', status: 203 }, 2)).toContain('203');
  });
});

describe('probeStrings: word for word from SAFETY.md', () => {
  const safety = readFileSync(new URL('../../../SAFETY.md', import.meta.url), 'utf8');

  it('W51 and W52 as §5 has them', () => {
    expect(safety).toContain(`**W51 (Pause during a probe; Probe Z, H90):** "${w51()}"`);
    expect(safety).toContain(`**W52 (a dropped lead; Probe Z, H90):** "${w52()}"`);
  });

  it('C39 as §6 has it, with the values filled in', () => {
    const row = safety.split('\n').find((l) => l.startsWith('| C39 |')) ?? '';
    const template = /"(Probe Z\?[^"]+)"/.exec(row)?.[1] ?? '';
    const filled = template.replace('<feed>', '25').replace('<depth>', '5').replace('<system>', 'G54').replace('<thickness − L>', '12.683').replace('<thickness>', '12.7').replace('<L>', '0.017');
    expect(c39({ feed: 25, depthMm: 5, system: 'G54', thicknessMm: 12.7, stopMm: 0.017 })).toBe(filled);
    expect(mm(1 / 3)).toBe('0.333');
  });
});
