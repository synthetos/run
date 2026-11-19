/**
 * Spindle and coolant, Communications and the stale copy (Board settings spec §5.6b, §2.1 finding 9), plus motor
 * idle time on Motors, and a dialect with no settings file (Review Focus 2).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { h, type ComponentChild } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { clearDraft } from '../src/workspace/boardFacts.ts';
import { CommsTab } from '../src/workspace/views/board/comms.ts';
import { BoardFacts } from '../src/workspace/views/board/identity.ts';
import { MotorsTab } from '../src/workspace/views/board/motors.ts';
import { OutputsTab } from '../src/workspace/views/board/outputs.ts';
import { all, byAttr, one, root, text } from './tree.ts';
import { boardView, OWNER_449 } from './boardViews.ts';

const IO = { spep: 1, spdp: 0, p1frq: 100, p1csl: 1000, p1csh: 2000, p1cpl: 0.125, p1cph: 1, p1wsl: 1000, p1wsh: 2000, p1wpl: 0.125, p1wph: 1, p1pof: 0, coph: 0, spph: 0 };
const COMMS = { baud: 5, ex: 1, ec: 0, ee: 0, ej: 1, jv: 4, js: 1, tv: 1, qv: 1, sv: 1, si: 250 };
const polarity = (node: ComponentChild, ref: string): string => text(one(root(node), byAttr('data-polarity', ref)));

beforeEach(() => clearDraft());

describe('Spindle and coolant', () => {
  it('449 J6.6 polarity reads "No setting on this firmware"; 450.02 reads "Reserved on this firmware"', () => {
    expect(polarity(h(OutputsTab, { view: boardView({ ...OWNER_449, settings: IO }) }), 'J6.6')).toBe('No setting on this firmware');
    expect(polarity(h(OutputsTab, { view: boardView({ fb: 450.02, settings: IO }) }), 'J6.6')).toBe('Reserved on this firmware');
    expect(polarity(h(OutputsTab, { view: boardView({ fb: 450.06, settings: IO }) }), 'J6.6')).toBe('No setting on this firmware');
  });

  it('the spindle enable polarity is a control on an approved board; the PWM values come from the data', () => {
    const el = root(h(OutputsTab, { view: boardView({ settings: IO }) }));
    expect(one(el, byAttr('data-setting-control', 'spep')).props['data-control-kind']).toBe('segmented');
    expect(text(el)).toContain('Spindle PWM frequency');
    expect(text(el)).toContain('100 Hz');
    expect(all(el, byAttr('data-action', 'toggle-edit'))).toEqual([]);
  });

  it('the coolant row shows what is wired to the output, from the machine record', () => {
    expect(text(one(root(h(OutputsTab, { view: boardView({ settings: IO }) })), byAttr('data-coolant-wired')))).toContain('Choose a machine on the Job page first.');
  });
});

describe('Communications', () => {
  it('values spelled out from the data, with one sentence for why they are read only', () => {
    const el = root(h(CommsTab, { view: boardView({ settings: COMMS }) }));
    expect(text(el)).toContain('115 200 baud');
    expect(text(el)).toContain('XON/XOFF');
    expect(text(el)).toContain('250 ms');
    expect(all(el, byAttr('data-comms-why'))).toHaveLength(1);
    expect(all(el, (e) => ['input', 'select', 'button'].includes(e.tag) && e.props['disabled'] !== true)).toEqual([]);
    expect(all(el, (e) => ['segmented', 'select', 'number'].includes(e.props['data-control-kind'] as string))).toEqual([]);
  });
});

describe('stale copy and motor idle time', () => {
  it('"Phase 1 connects every board" appears nowhere', () => {
    expect(renderToString(h(BoardFacts, { view: boardView({ ...OWNER_449, settings: COMMS }) }))).not.toContain('Phase 1 connects every board');
  });

  it('the mt control renders on Motors, in one line above the cards', () => {
    const el = root(h(MotorsTab, { view: boardView({ settings: { '1ma': 0, '1sa': 1.8, '1tr': 1.25, '1mi': 8, '1po': 0, '1pm': 2, mt: 2 } }) }));
    const line = one(el, byAttr('data-region', 'motor-idle'));
    expect(one(line, byAttr('data-setting-control', 'mt')).props['data-control-kind']).toBe('number');
    // A plain field label, not a sentence around the field (lead review, Motors 2).
    expect(text(one(line, (e) => e.tag === 'label'))).toBe('Idle motors power off after');
    expect(text(line)).not.toContain('Motors set to power off when idle turn off after');
  });
});

describe('a dialect with no settings file (Review Focus 2)', () => {
  it('renders values raw and no control on Spindle and coolant and Communications', () => {
    const view = boardView({ dialectId: 'g2core-edge', settings: { ...IO, ...COMMS } });
    for (const node of [h(OutputsTab, { view }), h(CommsTab, { view })]) {
      const el = root(node);
      expect(all(el, (e) => e.props['data-control-kind'] !== undefined && e.props['data-control-kind'] !== 'text')).toEqual([]);
    }
    expect(text(root(h(CommsTab, { view })))).toContain('No definition yet');
  });
});
