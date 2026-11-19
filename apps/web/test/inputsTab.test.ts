/**
 * The Inputs tab built from the settings file (Board settings spec §5.4):
 * switch contact once, one row per input with every mode by meaning, the
 * homing summary with links to Axes, and locked controls on a read-only board.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { clearDraft, setDraft } from '../src/workspace/boardFacts.ts';
import { AxesTab } from '../src/workspace/views/board/axes.ts';
import { InputsTab } from '../src/workspace/views/board/inputs.ts';
import { all, byAttr, one, root, text, type El } from './tree.ts';
import { boardView, OWNER_449 } from './boardViews.ts';

const SWITCHES = { xsn: 1, xsx: 2, ysn: 1, ysx: 0, zsn: 4, zsx: 1, asn: 1, asx: 0, st: 0, prbp: 0, xam: 1, yam: 1, zam: 1, aam: 3 };
const render = (view = boardView({ settings: SWITCHES }), states?: Readonly<Record<string, number>>): El => root(h(InputsTab, { view, ...(states === undefined ? {} : { states }) }));
const controls = (el: El): string[] => all(el, byAttr('data-setting-control')).map((e) => e.props['data-setting-control'] as string);
/** Enabled setting inputs (the note's dismiss button is not a setting). */
const enabled = (el: El): El[] => all(el, (e) => ['input', 'select', 'button'].includes(e.tag) && e.props['disabled'] !== true && e.props['data-action'] !== 'dismiss-notice-x');

beforeEach(() => clearDraft());

describe('a read-only board with a pending change left from before (review finding 4)', () => {
  it('Inputs and Axes describe the board as it is: no pending marks, no high-risk tag, no planned homing', () => {
    setDraft('xsn', 0);
    const ro = boardView({ ...OWNER_449, settings: SWITCHES });
    const el = render(ro);
    expect(text(el)).not.toContain('High risk');
    expect(all(el, (e) => e.props['class'] === 'drafted')).toEqual([]);
    expect(text(el)).not.toContain('Homing, with the pending changes');
    expect(text(el)).toContain('X homes towards min');
    const x = one(root(h(AxesTab, { view: ro })), byAttr('data-axis-card', 'x'));
    expect(text(x)).toContain('homes towards min');
  });
});

describe('InputsTab', () => {
  it('450: the switch contact and the probe contact are controls; one five-way choice per input', () => {
    const el = render();
    expect(controls(el)).toEqual(['st', 'prbp', 'xsn', 'xsx', 'ysn', 'ysx', 'zsn', 'zsx', 'asn', 'asx']);
    expect(one(el, byAttr('data-setting-control', 'xsn')).props['data-control-kind']).toBe('segmented');
    expect(text(el)).toContain('X min switch');
    expect(text(el)).toContain('J7.3');
  });

  it('449: no probe line and no prbp control (owner walk: the notice already says it once); every control is locked', () => {
    const el = render(boardView({ ...OWNER_449, settings: SWITCHES }));
    expect(all(el, byAttr('data-probe-contact'))).toEqual([]);
    expect(text(el)).not.toMatch(/fixed on this firmware/i);
    expect(controls(el)).not.toContain('prbp');
    expect(all(el, byAttr('data-pending'))).toEqual([]);
    expect(enabled(el)).toEqual([]);
    expect(one(el, byAttr('data-setting-control', 'xsn')).props['data-control-kind']).toBe('locked');
  });

  it('each homing chip is a link to that axis\'s Homing section on Axes', () => {
    const chips = all(render(), byAttr('data-axis-link'));
    expect(chips.map((c) => [c.tag, c.props['href'], text(c)])).toEqual([
      ['a', '#board-axis-x-homing', 'X homes towards min · J7.3'],
      ['a', '#board-axis-y-homing', 'Y homes towards min · J7.5'],
      ['a', '#board-axis-z-homing', 'Z homes towards max · J8.4'],
      ['a', '#board-axis-a-homing', 'A homes towards min · J8.5'],
    ]);
  });

  it('no homing speed control renders on Inputs, and there is no Edit values toggle', () => {
    const el = render();
    expect(controls(el).filter((k) => /^[xyza](sv|lv|lb|zb|jh)$/.test(k))).toEqual([]);
    expect(all(el, byAttr('data-action', 'toggle-edit'))).toEqual([]);
  });

  it('a pending change shows its consequence under the homing summary', () => {
    setDraft('xsx', 0);
    const el = render();
    expect(text(one(el, byAttr('data-region', 'input-consequences')))).toContain('X max switch is no longer a limit. Only soft limits stop X at the far end.');
    expect(one(el, byAttr('data-setting-control', 'xsx')).props['data-pending']).toBe('true');
  });

  it('Test switches is not built yet: no button and no Now column unless states are given', () => {
    const el = render();
    expect(text(el)).not.toContain('Test switches');
    expect(all(el, byAttr('data-input-state'))).toEqual([]);
    const live = render(boardView({ settings: SWITCHES }), { in6: 1, in1: 0 });
    expect(text(one(live, byAttr('data-input-state', 'zmax')))).toBe('Pressed');
    expect(text(one(live, byAttr('data-input-state', 'xmin')))).toBe('Released');
  });

  it('a dialect without a file shows the raw values and no control', () => {
    const el = render(boardView({ dialectId: 'g2core-edge', settings: { xsn: 3 } }));
    expect(all(el, byAttr('data-control-kind')).every((e) => e.props['data-control-kind'] === 'text')).toBe(true);
    expect(text(el)).toContain('No definition yet');
  });
});
