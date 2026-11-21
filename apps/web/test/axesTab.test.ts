/**
 * The Axes tab built from the settings file (Board settings spec §5.6, owner picture 157): an All axes card, one
 * card per axis, travel rules in words, units from the data, and no switch-mode, switch-contact or motor-idle
 * controls (their home is Inputs and Motors). Owner walk 2026-11-19 (picture 166): no scrolling, so the tab has its
 * own tabs: All axes, one per axis the machine uses, and Other axes; one view at a time.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { clearDraft } from '../src/workspace/boardFacts.ts';
import type { LiveView } from '../src/workspace/model.ts';
import { AxesTab } from '../src/workspace/views/board/axes.ts';
import { subTabChoice } from '../src/workspace/views/board/subTabs.ts';
import { all, byAttr, one, root, text, type El } from './tree.ts';
import { boardView, OWNER_449 } from './boardViews.ts';
import { OWNER_157 } from './axesModel.test.ts';

const APPROVED = boardView({ settings: OWNER_157 });
/** The Axes tab showing sub-tab `sub` (All axes when omitted). */
const render = (view: LiveView = APPROVED, sub: string | null = null): El => {
  subTabChoice.axes.value = sub;
  return root(h(AxesTab, { view }));
};
const controls = (el: El): string[] => all(el, byAttr('data-setting-control')).map((e) => e.props['data-setting-control'] as string);
/** The card of axis `a`, on its own sub-tab. */
const card = (a: string, view: LiveView = APPROVED): El => one(render(view, a), byAttr('data-axis-card', a));
const subtabs = (el: El): string[] => all(el, byAttr('data-subtab')).map((e) => e.props['data-subtab'] as string);

beforeEach(() => {
  clearDraft();
  subTabChoice.axes.value = null;
});

describe('AxesTab sub-tabs (owner walk 2026-11-19: no scroll bars)', () => {
  it('All axes, one tab per axis the machine uses, then Other axes; All axes first and alone', () => {
    const el = render();
    expect(subtabs(el)).toEqual(['all', 'x', 'y', 'z', 'a', 'other']);
    expect(all(el, byAttr('data-region', 'all-axes'))).toHaveLength(1);
    expect(all(el, byAttr('data-axis-card'))).toEqual([]);
  });

  it('an axis tab shows that axis alone, in three columns: Mode and Speed, Travel, Homing', () => {
    const el = render(APPROVED, 'x');
    expect(all(el, byAttr('data-axis-card')).map((c) => c.props['data-axis-card'])).toEqual(['x']);
    const x = card('x');
    const titles = (col: string): string[] => all(one(x, byAttr('data-axis-col', col)), (e) => e.tag === 'h4').map(text);
    expect(titles('left')).toEqual(['Mode', 'Speed']);
    expect(titles('middle')).toEqual(['Travel']);
    expect(titles('right')).toEqual(['Homing']);
  });

  it('Other axes lists the unused axes, each with its mode, and says they are not used', () => {
    const el = render(APPROVED, 'other');
    const off = one(el, byAttr('data-region', 'axes-off'));
    expect(all(off, byAttr('data-axis-off')).map((r) => r.props['data-axis-off'])).toEqual(['b', 'c']);
    expect(controls(off)).toEqual(['bam', 'cam']);
    expect(text(off)).toContain('Not used on this machine');
    expect(all(el, byAttr('data-axis-card'))).toEqual([]);
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
    const jm = one(card('x'), byAttr('data-setting-control', 'xjm'));
    expect(one(jm, (e) => e.tag === 'input').props['defaultValue']).toBe('20');
    expect(text(jm)).toContain('million mm/min³');
  });

  it('A rapid renders 230 400 °/min and 640 turns a minute', () => {
    const a = card('a', boardView({ ...OWNER_449, settings: OWNER_157 }));
    expect(text(one(a, byAttr('data-axis-row', 'avm')))).toContain('230 400 °/min');
    expect(text(one(a, byAttr('data-axis-row', 'avm')))).toContain('640 turns a minute');
  });

  it('the A radius shows in radius mode only', () => {
    expect(controls(card('a'))).toContain('ara');
    expect(controls(card('a', boardView({ settings: { ...OWNER_157, aam: 1 } })))).not.toContain('ara');
  });

  it('no switch-mode, switch-contact or motor-idle control on Axes', () => {
    const keys = ['all', 'x', 'y', 'z', 'a', 'other'].flatMap((s) => controls(render(APPROVED, s)));
    expect(keys.filter((k) => /^([xyzabc]s[nx]|st|mt)$/.test(k))).toEqual([]);
  });

  it('travel and homing lines in words; the homing section links to Inputs', () => {
    const x = card('x');
    expect(text(one(x, byAttr('data-travel-line')))).toBe('Soft limits are off, so these ends are not checked. Homing searches 155 mm.');
    const homing = one(x, byAttr('id', 'board-axis-x-homing'));
    expect(text(homing)).toContain('Homes towards min at the X min switch, J7.3.');
    expect(one(homing, byAttr('data-action', 'open-inputs')).props['href']).toBe('#board-pane-inputs');
  });

  it('one homing link per card, and none on a read-only board (review finding 10)', () => {
    const x = card('x', boardView({ settings: { ...OWNER_157, xsn: 0 } }));
    expect(all(x, byAttr('data-action', 'open-inputs'))).toHaveLength(1);
    expect(text(x)).not.toContain('Set one on Inputs');
    expect(all(card('x', boardView({ ...OWNER_449, settings: OWNER_157 })), byAttr('data-action', 'open-inputs'))).toEqual([]);
  });

  it('"This release never moves the machine" appears nowhere; the old axis-modes box is gone', () => {
    const el = render();
    expect(text(el)).not.toContain('This release never moves the machine');
    expect(text(el)).not.toContain('Axis modes (read only)');
  });

  it('a read-only board renders every value as text or locked, with no enabled control, and does not repeat why per row', () => {
    const ro = boardView({ ...OWNER_449, settings: OWNER_157 });
    expect(text(one(render(ro), byAttr('data-region', 'all-axes')))).not.toMatch(/Read only on this firmware|Run doesn't change this setting/);
    for (const sub of ['all', 'x', 'a', 'other']) {
      const el = render(ro, sub);
      expect(all(el, (e) => ['input', 'select'].includes(e.tag) && e.props['disabled'] !== true)).toEqual([]);
      expect(all(el, byAttr('data-control-kind')).every((e) => e.props['data-control-kind'] === 'text' || e.props['data-control-kind'] === 'locked')).toBe(true);
    }
  });

  it('a mode other than Standard reads as one line in the card', () => {
    const y = card('y', boardView({ settings: { ...OWNER_157, yam: 2 } }));
    expect(text(y)).toContain('Inhibited: the position follows the program, but the motor is held at step 0.');
  });
});
