/**
 * Board → J6 coolant pin, "Wired to" (owner, 2026-11-18, picture 152: "go to board and set this as flood or mist"):
 * the choice is saved with the chosen machine (the account record), never written to the board.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { MachineProfile } from '@synthetos/library';
import { all, root } from './tree.ts';
import { CoolantWiring, CoolantWiringPanel } from '../src/workspace/views/board/CoolantWiring.ts';
import { machineStore, selectedMachineStore } from '../src/workspace/library.ts';
import { coolantPinRef, pinByRef } from '../src/workspace/boardFacts.ts';
import { MachineCoolantField } from '../src/workspace/views/MachineCoolantField.ts';

const M: MachineProfile = { id: 'm-1', name: 'Bench', templateId: 'custom', drive: 'any', travel: { x: 300, y: 300, z: 80 }, spindle: '', createdAt: '2026-11-18T00:00:00.000Z' };
afterEach(() => { machineStore.set([]); selectedMachineStore.set(null); });

describe('Wired to (the coolant pin)', () => {
  it('the coolant pin is J6.6 and names the coolant keys', () => {
    expect(coolantPinRef()).toBe('J6.6');
    expect(pinByRef('J6.6')?.keys).toContain('cof');
  });
  it('without a chosen machine: one line, no choices', () => {
    const html = renderToString(h(CoolantWiring, { machine: null, onChoose: () => undefined }));
    expect(html).toContain('Choose a machine on the Job page first.');
    expect(html).not.toContain('type="radio"');
  });
  it('with a machine: four choices, the saved one checked, and where it is saved', () => {
    const el = root(h(CoolantWiring, { machine: { ...M, coolant: 'mist' }, onChoose: () => undefined }));
    const radios = all(el, (e) => e.tag === 'input' && e.props['type'] === 'radio');
    expect(radios.map((r) => r.props['value'])).toEqual(['none', 'flood', 'mist', 'air']);
    expect(radios.filter((r) => r.props['checked'] === true).map((r) => r.props['value'])).toEqual(['mist']);
    const html = renderToString(h(CoolantWiring, { machine: M, onChoose: () => undefined }));
    expect(html).toContain('Wired to');
    expect(html).toContain('Not used');
    expect(html).toContain('Flood coolant');
    expect(html).toContain('Air blast');
    expect(html).toContain('Saved with the machine Bench. TinyG does not know what is wired to its output.');
  });
  it('Library → Machines offers the same choice; "Not set" only while the machine has none', () => {
    const patches: unknown[] = [];
    const el = root(h(MachineCoolantField, { machine: M, update: (p) => patches.push(p) }));
    const options = all(el, (e) => e.tag === 'option').map((o) => o.props['value']);
    expect(options).toEqual(['', 'none', 'flood', 'mist', 'air']);
    const select = all(el, (e) => e.tag === 'select')[0];
    (select?.props['onChange'] as (e: unknown) => void)({ currentTarget: { value: 'air' } });
    (select?.props['onChange'] as (e: unknown) => void)({ currentTarget: { value: '' } });
    expect(patches).toEqual([{ coolant: 'air' }]);
    const set = root(h(MachineCoolantField, { machine: { ...M, coolant: 'flood' }, update: () => undefined }));
    expect(all(set, (e) => e.tag === 'option').map((o) => o.props['value'])).toEqual(['none', 'flood', 'mist', 'air']);
  });

  it('the panel saves the choice on the chosen machine record', () => {
    machineStore.set([M]);
    selectedMachineStore.set('m-1');
    const el = root(h(CoolantWiringPanel, null));
    const flood = all(el, (e) => e.tag === 'input' && e.props['value'] === 'flood')[0];
    (flood?.props['onChange'] as () => void)();
    expect(machineStore.value.value[0]?.coolant).toBe('flood');
    expect(machineStore.value.value[0]?.revision).toBe(2);
  });
});
