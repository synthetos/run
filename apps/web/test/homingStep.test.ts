import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { boardMismatch } from '../src/wizard/homingStep.ts';
import { CONNECT_FOR_HOMING, Homing, HOMING_LEAD, HOMING_TITLE } from '../src/wizard/steps/Homing.ts';
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
    expect(HOMING_TITLE).toBe('Homing');
    expect(HOMING_LEAD).toBe('How this machine finds its zero.');
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
  it('disconnected: the connect line and the Connect flow, no Home controls', () => {
    const html = renderToString(h(Homing, { ...base, model: null }));
    expect(html).toContain(CONNECT_FOR_HOMING);
    expect(html).toContain('data-region="connect"');
    expect(html).not.toContain('data-region="home-quick"');
  });
  it('a mismatched board: the reason as an alert and no Home controls', () => {
    const html = renderToString(h(Homing, { ...base, model: connectedModel(), mismatch: 'This is board OTHER-99, not the board.' }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('This is board OTHER-99');
    expect(html).not.toContain('data-region="home-quick"');
  });
});
