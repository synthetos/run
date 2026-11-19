import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { boardMismatch } from '../src/wizard/homingStep.ts';
import { CONNECT_FOR_HOMING, COOLANT_NEEDS_MACHINE, COOLANT_QUESTION, HOME_LATER, Homing, HOMING_LEAD, HOMING_TITLE } from '../src/wizard/steps/Homing.ts';
import { all, root, text } from './tree.ts';
import { createWorkspaceModel, type LiveActions, type LiveView } from '../src/workspace/model.ts';
import type { MachineProfile } from '../src/workspace/library.ts';
import { snap, view } from './runMotionHarness.ts';

const HOMING = { xam: 1, xsn: 0, xsx: 1, xsv: 500, xtn: 0, xtm: 100, xlb: 2, yam: 1, ysn: 1, ysx: 0, ysv: 500, zam: 1, zsn: 0, zsx: 0, zsv: 0, aam: 0, asn: 0, asx: 0, asv: 0 };
const machine: MachineProfile = { id: 'm-1', name: 'Shapeoko on the bench', templateId: 'shapeoko', drive: 'belt', travel: { x: 425, y: 425, z: 75 }, spindle: '', createdAt: '2026-11-18T00:00:00.000Z', boardId: 'SIM-EN-0001' };

function connectedModel() {
  const v = view(snap(), true);
  const m = createWorkspaceModel();
  m.live.value = { ...v, readout: { dialectId: 'tinyg-en', phase: { kind: 'recorded', hash: 'x' }, settings: HOMING } } as LiveView;
  m.actions.value = { motion: () => Promise.resolve(null) } as unknown as LiveActions;
  return m;
}

describe('boardMismatch (Review Focus 3)', () => {
  it('is null when either side is unknown or they agree, one line when the connected board is another', () => {
    expect(boardMismatch(null, machine)).toBeNull();
    expect(boardMismatch('SIM-EN-0001', null)).toBeNull();
    expect(boardMismatch('SIM-EN-0001', machine)).toBeNull();
    const { boardId: _unbound, ...unbound } = machine;
    expect(boardMismatch('SIM-EN-0001', unbound)).toBeNull();
    expect(boardMismatch('OTHER-99', machine)).toBe('This is board OTHER-99, not the board Shapeoko on the bench was set up with (SIM-EN-0001). Connect that board to home it here.');
  });
});

describe('step 4 Homing (render)', () => {
  const base = { choice: null, onChoice: () => undefined, mismatch: null };
  it('two radio cards, the checked one following the choice, and the existing Home controls when connected', () => {
    expect(HOMING_TITLE).toBe('Homing and coolant');
    expect(HOMING_LEAD).toBe('How this machine finds its zero, and what its coolant output drives.');
    const html = renderToString(h(Homing, { ...base, model: connectedModel(), choice: 'none' }));
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).toMatch(/value="none"[^>]*checked/);
    expect(html).not.toMatch(/value="switches"[^>]*checked/);
    expect(html).toContain('Limit switches fitted');
    expect(html).toContain('No limit switches');
    expect(html).toContain('data-region="home-quick"');
    expect(html).toContain('class="wizard-homing" data-choice="none"');
    expect(html).not.toMatch(/E-stop|never need|Saved in this browser/);
  });
  it('with switches, homing waits for the Job page where Pause and Stop are in reach: no Home button in the frame', () => {
    const html = renderToString(h(Homing, { ...base, model: connectedModel(), choice: 'switches' }));
    expect(html).not.toContain('data-region="home-quick"');
    expect(html).toContain(HOME_LATER);
    const undecided = renderToString(h(Homing, { ...base, model: connectedModel(), choice: null }));
    expect(undecided).not.toContain('data-region="home-quick"');
    expect(undecided).not.toContain(HOME_LATER);
  });
  it('disconnected: the connect line and the Connect flow, no Home controls', () => {
    const html = renderToString(h(Homing, { ...base, model: null }));
    expect(html).toContain(CONNECT_FOR_HOMING);
    expect(html).toContain('data-region="connect"');
    expect(html).not.toContain('data-region="home-quick"');
  });
  it('owner 152: one compact question, what is wired to the coolant output, saved on the step-2 machine; no board needed', () => {
    const chosen: string[] = [];
    const el = root(h('div', null, h(Homing, { ...base, model: null, coolant: 'mist', onCoolant: (c) => chosen.push(c) })));
    expect(text(el)).toContain(COOLANT_QUESTION);
    expect(COOLANT_QUESTION).toBe('What is wired to the coolant output?');
    const radios = all(el, (e) => e.tag === 'input' && e.props['name'] === 'wizard-coolant');
    expect(radios.map((r) => r.props['value'])).toEqual(['none', 'flood', 'mist', 'air']);
    expect(radios.filter((r) => r.props['checked'] === true).map((r) => r.props['value'])).toEqual(['mist']);
    expect(radios.every((r) => r.props['class'] === 'wizard-choice-radio')).toBe(true);
    (radios[1]?.props['onChange'] as () => void)();
    expect(chosen).toEqual(['flood']);
    // Step 2 was skipped: no machine to save it on.
    const none = renderToString(h(Homing, { ...base, model: null, coolant: null, onCoolant: null }));
    expect(none).toContain(COOLANT_NEEDS_MACHINE);
    expect(none).not.toContain('name="wizard-coolant"');
  });
  it('a mismatched board: the reason as an alert and no Home controls', () => {
    const html = renderToString(h(Homing, { ...base, model: connectedModel(), mismatch: 'This is board OTHER-99, not the board.' }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('This is board OTHER-99');
    expect(html).not.toContain('data-region="home-quick"');
  });
});
