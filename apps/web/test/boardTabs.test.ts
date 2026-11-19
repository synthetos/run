/**
 * Spindle and coolant, the status report fields and the stale copy (Board settings spec §5.6b, §2.1 finding 9), plus motor
 * idle time on Motors, and a dialect with no settings file (Review Focus 2).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { h, type ComponentChild } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { clearDraft } from '../src/workspace/boardFacts.ts';
import type { LiveView } from '../src/workspace/model.ts';
import { StatusFields } from '../src/workspace/settings/statusFields.ts';
import { BoardFacts } from '../src/workspace/views/board/identity.ts';
import { MotorsTab } from '../src/workspace/views/board/motors.ts';
import { OutputsTab } from '../src/workspace/views/board/outputs.ts';
import { all, byAttr, one, root, text, type El } from './tree.ts';
import { boardView, OWNER_449 } from './boardViews.ts';

const IO = { spep: 1, spdp: 0, p1frq: 100, p1csl: 1000, p1csh: 2000, p1cpl: 0.125, p1cph: 1, p1wsl: 1000, p1wsh: 2000, p1wpl: 0.125, p1wph: 1, p1pof: 0, coph: 0, spph: 0 };
/** An element's own text, without its children's (the hidden raw-key code). */
const ownText = (el: El): string => el.children.filter((c): c is string => typeof c === 'string').join('');
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

describe('status report fields (now under All settings → Status report)', () => {
  it('read in words from the data file, never a bare token', () => {
    const v = boardView({ settings: COMMS });
    const m = v.message as NonNullable<LiveView['message']>;
    const view = { ...v, message: { ...m, snapshot: { ...m.snapshot, live: { ...m.snapshot.live, srList: ['stat', 'posx', 'mpoa', 'spe', 'tool'] } } } } as LiveView;
    const words = all(root(h(StatusFields, { view })), (e) => e.tag === 'li').map(ownText);
    expect(words).toEqual(['Machine state', 'X position', 'A machine position', 'Spindle on', 'Tool']);
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
    // The setting's one name from the data, the same as in All settings.
    expect(text(one(line, (e) => e.tag === 'label'))).toBe('Motor idle timeout');
    expect(text(line)).not.toContain('Motors set to power off when idle turn off after');
  });
});

describe('a dialect with no settings file (Review Focus 2)', () => {
  it('renders values raw and no control on Spindle and coolant', () => {
    const view = boardView({ dialectId: 'g2core-edge', settings: { ...IO, ...COMMS } });
    const el = root(h(OutputsTab, { view }));
    expect(all(el, (e) => e.props['data-control-kind'] !== undefined && e.props['data-control-kind'] !== 'text')).toEqual([]);
  });
});
