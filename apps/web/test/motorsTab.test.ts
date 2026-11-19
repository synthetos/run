/**
 * Motors as cards built from the settings file (Board settings spec §5.5): one card per motor, every row from the
 * motor's group, values spelled out, steps per unit board → new when a change is pending. Owner 154: "1mi 2" reads
 * "Microsteps: Half step (1/2)". Owner walk 2026-11-19: no scrolling, so each motor is its own sub-tab.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { clearDraft, setDraft } from '../src/workspace/boardFacts.ts';
import { renderToString } from 'preact-render-to-string';
import type { LiveView } from '../src/workspace/model.ts';
import { AllSettings } from '../src/workspace/settings/AllSettings.ts';
import { MotorFacts } from '../src/workspace/views/board/motorCard.ts';
import { MotorsTab } from '../src/workspace/views/board/motors.ts';
import { subTabChoice } from '../src/workspace/views/board/subTabs.ts';
import { all, byAttr, one, root, text, type El } from './tree.ts';
import { boardView, OWNER_449 } from './boardViews.ts';

const OWNER_154 = { '1ma': 0, '1sa': 1.8, '1tr': 1.25, '1mi': 2, '1po': 1, '1pm': 2, '2ma': 1, '2sa': 1.8, '2tr': 1.25, '2mi': 2, '2po': 0, '2pm': 2, '3ma': 2, '3sa': 1.8, '3tr': 1.25, '3mi': 8, '3po': 1, '3pm': 1, '4ma': 3, '4sa': 1.8, '4tr': 360, '4mi': 8, '4po': 0, '4pm': 0, mt: 2 };
/** The Motors tab on motor `m`'s sub-tab. */
const tab = (view: LiveView, m: number): El => {
  subTabChoice.motors.value = String(m);
  return root(h(MotorsTab, { view }));
};
const card = (view: LiveView, m: number): El => one(tab(view, m), byAttr('data-motor-card', String(m)));
const row = (c: El, k: string): El => one(c, byAttr('data-motor-row', k));
const enabled = (el: El): El[] => all(el, (e) => ['input', 'select', 'button'].includes(e.tag) && e.props['disabled'] !== true);

beforeEach(() => {
  clearDraft();
  subTabChoice.motors.value = null;
});

describe('MotorsTab sub-tabs (owner walk 2026-11-19: no scroll bars)', () => {
  it('one sub-tab per motor, named with the axis it drives; one card at a time, Motor 1 first', () => {
    subTabChoice.motors.value = null;
    const el = root(h(MotorsTab, { view: boardView({ settings: OWNER_154 }) }));
    expect(all(el, byAttr('data-subtab')).map(text)).toEqual(['Motor 1 · X', 'Motor 2 · Y', 'Motor 3 · Z', 'Motor 4 · A']);
    expect(all(el, byAttr('data-motor-card')).map((c) => c.props['data-motor-card'])).toEqual(['1']);
    expect(all(el, byAttr('data-region', 'motor-idle'))).toHaveLength(1);
  });

  it('a pending change marks its motor\'s sub-tab with a badge', () => {
    setDraft('3mi', 4);
    const el = tab(boardView({ settings: OWNER_154 }), 1);
    expect(text(one(el, byAttr('data-subtab', '3')))).toBe('Motor 3 · Z1');
  });
});

describe('MotorsTab', () => {
  it('owner 154 on the 449 board: every motor value in words, nothing editable', () => {
    const view = boardView({ ...OWNER_449, settings: OWNER_154 });
    const m1 = card(view, 1);
    expect(text(m1)).toContain('Motor 1');
    expect(text(row(m1, '1ma'))).toContain('X axis');
    expect(text(row(m1, '1sa'))).toContain('1.8° per step');
    expect(text(row(m1, '1sa'))).toContain('200 steps per turn');
    expect(text(row(m1, '1tr'))).toContain('1.25 mm');
    expect(text(row(m1, '1mi'))).toContain('Half step (1/2)');
    expect(text(row(m1, '1po'))).toContain('Reversed');
    expect(text(row(m1, '1pm'))).toContain('On during a job, off after the idle time');
    expect(text(one(m1, byAttr('data-steps-per-unit')))).toBe('320');
    expect(all(tab(view, 1), (e) => ['input', 'select'].includes(e.tag) && e.props['disabled'] !== true)).toEqual([]);
  });

  it('a motor on a rotary axis reads its travel per turn in degrees, everywhere (lead review, Motors 3)', () => {
    for (const view of [boardView({ settings: OWNER_154 }), boardView({ ...OWNER_449, settings: OWNER_154 })]) {
      const m4 = card(view, 4);
      expect(text(row(m4, '4tr'))).toContain('°');
      expect(text(row(m4, '4tr'))).not.toContain('mm');
      expect(text(row(card(view, 1), '1tr'))).toContain('mm');
      expect(text(root(h(MotorFacts, { m: 4, view })))).toContain('360°');
      const all4 = /<tr[^>]*data-key="4tr"[\s\S]*?<\/tr>/.exec(renderToString(h(AllSettings, { view })))?.[0] ?? '';
      expect(all4).toContain('°');
      expect(all4).not.toContain('mm');
    }
  });

  it('rows come from the motor group, with the short names', () => {
    const m1 = card(boardView({ settings: OWNER_154 }), 1);
    expect(all(m1, byAttr('data-motor-row')).map((r) => r.props['data-motor-row'])).toEqual(['1ma', '1sa', '1tr', '1mi', '1po', '1pm']);
    expect(all(m1, (e) => e.tag === 'th' && e.props['scope'] === 'row').map(text)).toEqual(['Drives', 'Step angle', 'Travel per turn', 'Microsteps', 'Direction', 'Power', 'Steps per mm']);
  });

  it('a pending 2mi 8 shows "320 → 1 280" and the motor\'s controls are editable on an approved board', () => {
    setDraft('2mi', 8);
    const m2 = card(boardView({ settings: OWNER_154 }), 2);
    expect(text(one(m2, byAttr('data-steps-per-unit')))).toBe('320 → 1 280');
    expect(one(m2, byAttr('data-setting-control', '2mi')).props['data-pending']).toBe('true');
    expect(one(m2, byAttr('data-setting-control', '2po')).props['data-control-kind']).toBe('segmented');
  });

  it('a motor driving a rotary axis counts steps per degree', () => {
    const m4 = card(boardView({ settings: OWNER_154 }), 4);
    expect(text(m4)).toContain('Steps per degree');
    expect(text(one(m4, byAttr('data-steps-per-unit')))).toBe('4.444');
    expect(text(m4)).toContain('drives A');
  });

  it('no draft panel and no separate Draft column', () => {
    const el = tab(boardView({ settings: OWNER_154 }), 1);
    expect(text(el)).not.toContain('Draft');
    expect(enabled(card(boardView({ settings: OWNER_154 }), 1)).length).toBeGreaterThan(0);
  });
});
