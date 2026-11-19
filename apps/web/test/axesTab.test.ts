/**
 * The Axes tab built from the settings file (Board settings spec §5.6, owner picture 157): an All axes card, one
 * card per axis, travel rules in words, units from the data, and no switch-mode, switch-contact or motor-idle
 * controls (their home is Inputs and Motors).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { clearDraft } from '../src/workspace/boardFacts.ts';
import { AxesTab } from '../src/workspace/views/board/axes.ts';
import { all, byAttr, one, root, text, type El } from './tree.ts';
import { boardView, OWNER_449 } from './boardViews.ts';
import { OWNER_157 } from './axesModel.test.ts';

const render = (view = boardView({ settings: OWNER_157 })): El => root(h(AxesTab, { view }));
const controls = (el: El): string[] => all(el, byAttr('data-setting-control')).map((e) => e.props['data-setting-control'] as string);
const card = (el: El, a: string): El => one(el, byAttr('data-axis-card', a));

beforeEach(() => clearDraft());

describe('AxesTab layout', () => {
  it('two independent columns: Speed follows Mode, Homing follows Travel (lead review, Axes)', () => {
    const x = card(render(), 'x');
    const titles = (col: string): string[] => all(one(x, byAttr('data-axis-col', col)), (e) => e.tag === 'h4').map(text);
    expect(titles('left')).toEqual(['Mode', 'Speed']);
    expect(titles('right')).toEqual(['Travel', 'Homing']);
  });
});

describe('AxesTab', () => {
  it('the All axes card holds soft limits, junction acceleration and chordal tolerance', () => {
    const all3 = one(render(), byAttr('data-region', 'all-axes'));
    expect(controls(all3)).toEqual(['sl', 'ja', 'ct']);
    expect(text(all3)).toContain("Run doesn't change this setting.");
    expect(text(all3)).not.toContain('yet');
  });

  it('jerk renders 20 with unit million mm/min³', () => {
    const jm = one(card(render(), 'x'), byAttr('data-setting-control', 'xjm'));
    expect(one(jm, (e) => e.tag === 'input').props['defaultValue']).toBe('20');
    expect(text(jm)).toContain('million mm/min³');
  });

  it('A rapid renders 230 400 °/min and 640 turns a minute', () => {
    const a = card(render(boardView({ ...OWNER_449, settings: OWNER_157 })), 'a');
    expect(text(one(a, byAttr('data-axis-row', 'avm')))).toContain('230 400 °/min');
    expect(text(one(a, byAttr('data-axis-row', 'avm')))).toContain('640 turns a minute');
  });

  it('the A radius shows in radius mode only', () => {
    expect(controls(card(render(), 'a'))).toContain('ara');
    expect(controls(card(render(boardView({ settings: { ...OWNER_157, aam: 1 } })), 'a'))).not.toContain('ara');
  });

  it('no switch-mode, switch-contact or motor-idle control on Axes', () => {
    const keys = controls(render());
    expect(keys.filter((k) => /^([xyzabc]s[nx]|st|mt)$/.test(k))).toEqual([]);
  });

  it('travel and homing lines in words; the homing section links to Inputs', () => {
    const x = card(render(), 'x');
    expect(text(one(x, byAttr('data-travel-line')))).toBe('Soft limits are off, so these ends are not checked. Homing searches 155 mm.');
    const homing = one(x, byAttr('id', 'board-axis-x-homing'));
    expect(text(homing)).toContain('Homes towards min at the X min switch, J7.3.');
    expect(one(homing, byAttr('data-action', 'open-inputs')).props['href']).toBe('#board-pane-inputs');
  });

  it('one homing link per card, and none on a read-only board (review finding 10)', () => {
    const x = card(render(boardView({ settings: { ...OWNER_157, xsn: 0 } })), 'x');
    expect(all(x, byAttr('data-action', 'open-inputs'))).toHaveLength(1);
    expect(text(x)).not.toContain('Set one on Inputs');
    const ro = render(boardView({ ...OWNER_449, settings: OWNER_157 }));
    expect(all(ro, byAttr('data-action', 'open-inputs'))).toEqual([]);
  });

  it('B and C collapse into one line', () => {
    const off = one(render(), byAttr('data-region', 'axes-off'));
    const own = off.children.find((c): c is El => typeof c !== 'string' && c.tag === 'summary');
    expect(text(own as El)).toBe('B and C · Off · Not used on this machine · Show');
    expect(all(off, byAttr('data-axis-card')).map((c) => c.props['data-axis-card'])).toEqual(['b', 'c']);
  });

  it('"This release never moves the machine" appears nowhere; the old axis-modes box is gone', () => {
    const el = render();
    expect(text(el)).not.toContain('This release never moves the machine');
    expect(text(el)).not.toContain('Axis modes (read only)');
  });

  it('a read-only board renders every value as text or locked, with no enabled control, and does not repeat why per row', () => {
    const el = render(boardView({ ...OWNER_449, settings: OWNER_157 }));
    expect(text(one(el, byAttr('data-region', 'all-axes')))).not.toMatch(/Read only on this firmware|Run doesn't change this setting/);
    expect(all(el, (e) => ['input', 'select', 'button'].includes(e.tag) && e.props['disabled'] !== true)).toEqual([]);
    expect(all(el, byAttr('data-control-kind')).every((e) => e.props['data-control-kind'] === 'text' || e.props['data-control-kind'] === 'locked')).toBe(true);
  });

  it('a mode other than Standard reads as one line in the card', () => {
    const y = card(render(boardView({ settings: { ...OWNER_157, yam: 2 } })), 'y');
    expect(text(y)).toContain('Mode Inhibited: the position follows the program, but the motor is held at step 0.');
  });
});
