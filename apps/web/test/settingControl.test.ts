/**
 * One control for every setting (Board settings spec §5.1): the allowed
 * values by meaning, the board value selected, pending changes kept only in
 * the browser's draft store, and locked controls where Run may not write.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { clearDraft, draftStore, setDraft } from '../src/workspace/boardFacts.ts';
import type { LiveView } from '../src/workspace/model.ts';
import { editBlocked } from '../src/workspace/settings/editGate.ts';
import { SettingControl } from '../src/workspace/settings/SettingControl.ts';
import { all, byAttr, one, root, text, type El } from './tree.ts';
import { boardView, OWNER_449 } from './boardViews.ts';

const render = (k: string, view = boardView(), locked?: boolean): El => root(h(SettingControl, { k, view, ...(locked === undefined ? {} : { locked }) }));
const segments = (el: El): El[] => all(el, byAttr('data-value'));
const enabled = (el: El): El[] => all(el, (e) => ['input', 'select', 'button'].includes(e.tag) && e.props['disabled'] !== true);

beforeEach(() => clearDraft());

describe('SettingControl', () => {
  it('xsn renders five segments labelled from the data, the board value selected', () => {
    const el = render('xsn');
    expect(el.props['data-control-kind']).toBe('segmented');
    expect(segments(el).map(text)).toEqual(['Off', 'Homing', 'Limit', 'Homing and limit', 'Probe']);
    expect(segments(el).filter((s) => s.props['aria-checked'] === 'true').map(text)).toEqual(['Homing']);
  });

  it('1mi renders a select with Full step (1) … Eighth step (8) and no "Keep" option', () => {
    const el = render('1mi');
    expect(el.props['data-control-kind']).toBe('select');
    const options = all(el, (e) => e.tag === 'option');
    expect(options.map(text)).toEqual(['Full step (1)', 'Half step (2)', 'Quarter step (4)', 'Eighth step (8)']);
    expect(one(el, (e) => e.tag === 'select').props['value']).toBe('8');
  });

  it('choosing a value makes it pending with "was", and choosing the board value again clears it', () => {
    const pick = (value: string): void => (segments(render('xsn')).find((s) => s.props['data-value'] === value)?.props['onClick'] as () => void)();
    pick('3');
    expect(draftStore.value.value).toEqual({ xsn: 3 });
    const pending = render('xsn');
    expect(pending.props['data-pending']).toBe('true');
    expect(text(one(pending, byAttr('data-was')))).toBe('was Homing');
    pick('1');
    expect(draftStore.value.value).toEqual({});
    expect(render('xsn').props['data-pending']).toBeUndefined();
  });

  it('a number renders a field sized to its content with its unit and range', () => {
    const el = render('xjd');
    expect(el.props['data-control-kind']).toBe('number');
    const input = one(el, (e) => e.tag === 'input');
    expect(input.props).toMatchObject({ type: 'number', min: 0, max: 5, defaultValue: '0.05' });
    expect(input.props['title']).toBe('Greater than 0 and at most 5 mm');
    expect(text(el)).toContain('mm');
    (input.props['onChange'] as (e: unknown) => void)({ currentTarget: { value: '0.02' } });
    expect(draftStore.value.value).toEqual({ xjd: 0.02 });
  });

  it('a board value outside values shows "Unknown value (3)" and no segment selected', () => {
    const view = boardView({ settings: { xsn: 7, '1mi': 3 } });
    const seg = render('xsn', view);
    expect(text(seg)).toContain('Unknown value (7)');
    expect(segments(seg).some((s) => s.props['aria-checked'] === 'true')).toBe(false);
    const sel = render('1mi', view);
    expect(one(sel, (e) => e.tag === 'select').props['value']).toBe('');
    expect(all(sel, (e) => e.tag === 'option' && e.props['selected'] === true).map(text)).toEqual(['Unknown value (3)']);
    (one(sel, (e) => e.tag === 'select').props['onChange'] as (e: unknown) => void)({ currentTarget: { value: '4' } });
    expect(draftStore.value.value).toEqual({ '1mi': 4 });
  });

  it('locked renders every option with the current marked and no enabled input', () => {
    const el = render('xsn', boardView(), true);
    expect(el.props['data-control-kind']).toBe('locked');
    expect(segments(el).map(text)).toEqual(['Off', 'Homing', 'Limit', 'Homing and limit', 'Probe']);
    expect(segments(el).filter((s) => s.props['aria-current'] === 'true').map(text)).toEqual(['Homing']);
    expect(enabled(el)).toEqual([]);
  });

  it('on the owner\'s 449 board every enumerated setting is locked and shows its options', () => {
    const view = boardView({ ...OWNER_449, settings: { xsn: 1, '1mi': 2, xvm: 800 } });
    const xsn = render('xsn', view);
    expect(xsn.props['data-control-kind']).toBe('locked');
    expect(enabled(xsn)).toEqual([]);
    const mi = render('1mi', view);
    expect(mi.props['data-control-kind']).toBe('locked');
    expect(text(mi)).toContain('Half step (2)');
    expect(text(mi)).toContain('Eighth step (8)');
    expect(render('xvm', view).props['data-control-kind']).toBe('text');
    expect(text(render('xvm', view))).toBe('800 mm/min');
  });

  it('a forbidden or never-written setting is text', () => {
    expect(render('ex').props['data-control-kind']).toBe('text');
    expect(text(render('ex'))).toBe('XON/XOFF');
  });

  it('a dialect without a file shows the raw value and no control', () => {
    const el = render('xsn', boardView({ dialectId: 'g2core-edge', settings: { xsn: 3 } }));
    expect(el.props['data-control-kind']).toBe('text');
    expect(text(el)).toBe('3');
  });

  it('a board reporting inches labels lengths in inches and locks them', () => {
    const el = render('xjd', boardView({ unit: 0 }));
    expect(el.props['data-control-kind']).toBe('locked');
    expect(text(el)).toBe('0.05 in');
  });
});

describe('SettingControl sizes', () => {
  it('a select is sized to its longest option, with room for the chevron (lead review, Motors 1)', () => {
    const width = (k: string): unknown => one(render(k), (e) => e.tag === 'select').props['style'];
    expect(width('1mi')).toBe(`width: calc(${'Quarter step (4)'.length}ch + 44px)`);
    const pm = all(render('1pm'), (e) => e.tag === 'option').map(text);
    expect(width('1pm')).toBe(`width: calc(${Math.max(...pm.map((t) => t.length))}ch + 44px)`);
  });
});

describe('SettingControl while Apply runs (review finding 9)', () => {
  it('every control is locked and still shows the change being written; edits and Restore wait for the write', () => {
    setDraft('xsn', 3);
    const writing = { ...boardView(), apply: { kind: 'writing', steps: [], backupName: 'b.json', mode: 'apply' } } as LiveView;
    const el = render('xsn', writing);
    expect(el.props['data-control-kind']).toBe('locked');
    expect(enabled(el)).toEqual([]);
    expect(el.props['data-pending']).toBe('true');
    expect(segments(el).filter((s) => s.props['aria-current'] === 'true').map(text)).toEqual(['Homing and limit']);
    expect(editBlocked(writing)).toBe('Wait for the settings write to finish.');
    expect(editBlocked({ ...writing, apply: { kind: 'backingUp', done: 1, of: 3 } } as LiveView)).toBe('Wait for the settings write to finish.');
  });
});

describe('SettingControl when a pending change can no longer be written', () => {
  it('a locked control on a read-only board shows the board\'s value, not a leftover pending change (review finding 4)', () => {
    setDraft('xsn', 3);
    const el = render('xsn', boardView({ ...OWNER_449, settings: { xsn: 1 } }));
    expect(segments(el).filter((s) => s.props['aria-current'] === 'true').map(text)).toEqual(['Homing']);
    expect(el.props['data-pending']).toBeUndefined();
    expect(all(el, byAttr('data-was'))).toEqual([]);
  });
});
