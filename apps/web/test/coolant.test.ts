/**
 * What is wired to the coolant output (owner, 2026-11-18, pictures 151 and 152): a property of the machine, not of
 * TinyG. The words and the commands of the one Job-page toggle come from the machine's choice.
 */
import { describe, expect, it } from 'vitest';
import { COOLANT_WIRING, coolantHelp, coolantLabel, coolantOnCommand, coolantReadout } from '../src/workspace/coolant.ts';
import type { LiveView } from '../src/workspace/model.ts';
import { stripStatus } from '../src/workspace/status.ts';
import { snap, view } from './runMotionHarness.ts';

type Live = NonNullable<LiveView['message']>['snapshot']['live'];
const live = (extra: Record<string, unknown>): Live => ({ stat: 3, ...extra }) as unknown as Live;

describe('coolant words and commands', () => {
  it('the four wiring choices, in the Board panel and wizard order', () => {
    expect(COOLANT_WIRING).toEqual([['none', 'Not used'], ['flood', 'Flood coolant'], ['mist', 'Mist'], ['air', 'Air blast']]);
  });
  it('the toggle is named by the machine; unset reads "Coolant"', () => {
    expect([coolantLabel('flood'), coolantLabel('mist'), coolantLabel('air'), coolantLabel(null)]).toEqual(['Flood', 'Mist', 'Air', 'Coolant']);
  });
  it('flood and unset switch on with M8; mist and air with M7 (the off is always M9)', () => {
    expect(coolantOnCommand('flood')).toEqual({ op: 'coolantOn', which: 'flood' });
    expect(coolantOnCommand(null)).toEqual({ op: 'coolantOn', which: 'flood' });
    expect(coolantOnCommand('mist')).toEqual({ op: 'coolantOn', which: 'mist' });
    expect(coolantOnCommand('air')).toEqual({ op: 'coolantOn', which: 'mist' });
  });
  it('the readout: "<name> on/off" from cof or com, "Not used" for none, the unreported text otherwise', () => {
    expect(coolantReadout(live({ cof: 1, com: 0 }), 'flood')).toBe('Flood on');
    expect(coolantReadout(live({ cof: 0, com: 1 }), 'mist')).toBe('Mist on');
    expect(coolantReadout(live({ cof: 0, com: 0 }), 'air')).toBe('Air off');
    expect(coolantReadout(live({ cof: 1 }), null)).toBe('Coolant on');
    expect(coolantReadout(live({ cof: 0, com: 0 }), null)).toBe('Coolant off');
    expect(coolantReadout(live({ cof: 1 }), 'none')).toBe('Not used');
    expect(coolantReadout(live({}), 'flood')).toBe('Unknown');
    expect(coolantReadout(live({ srList: ['stat'] }), 'flood')).toBe('Not reported');
    expect(coolantReadout(undefined, 'flood')).toBe('Unknown');
  });
  it('the machine strip readout is named by the machine; quiet (dropped first) when off or nothing is wired', () => {
    const wired = (kind: 'flood' | 'mist' | 'air' | 'none' | null, extra: Record<string, unknown>) =>
      stripStatus(view(snap({ live: { stat: 3, pos: {}, mpo: {}, ...extra } }), false), null, kind).readouts.find((r) => r.label === 'Coolant');
    expect([wired('flood', { cof: 1, com: 0 })?.value, wired('mist', { cof: 0, com: 1 })?.value, wired('air', { cof: 0, com: 0 })?.value, wired(null, { cof: 1 })?.value]).toEqual(['Flood on', 'Mist on', 'Air off', 'Coolant on']);
    expect([wired('air', { cof: 0, com: 0 })?.quiet, wired('flood', { cof: 1 })?.quiet]).toEqual([true, undefined]);
    expect(wired('none', { cof: 1 })).toMatchObject({ value: 'Not used', quiet: true });
  });
  it('the help says what the button sends and that Run cannot tell what is wired', () => {
    expect(coolantHelp('flood')).toBe('Flood sends M8 to switch the coolant output on and M9 to switch it off. Run cannot tell what is wired to it: this machine says flood coolant.');
    expect(coolantHelp('air')).toBe('Air sends M7 to switch the coolant output on and M9 to switch it off. Run cannot tell what is wired to it: this machine says air blast.');
    expect(coolantHelp(null)).toBe('Coolant sends M8 to switch the coolant output on and M9 to switch it off. Run cannot tell what is wired to it: a pump, a mist valve or an air blast.');
  });
});
