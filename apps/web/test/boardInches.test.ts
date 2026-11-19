/**
 * Lengths follow the board's units in every view (review finding 1): a board reporting inches (G20, `unit` 0) shows
 * its own numbers in inches wherever a length appears, on read-only boards too (the length marker is the data's
 * `convert`, not the write object).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { settingsDefsFor } from '@synthetos/schema';
import { clearDraft } from '../src/workspace/boardFacts.ts';
import { AllSettings } from '../src/workspace/settings/AllSettings.ts';
import { valueWordsOf } from '../src/workspace/settings/meta.ts';
import { axisCards, travelLine } from '../src/workspace/views/board/axesModel.ts';
import { AxesTab } from '../src/workspace/views/board/axes.ts';
import { subTabChoice } from '../src/workspace/views/board/subTabs.ts';
import { MotorFacts } from '../src/workspace/views/board/motorCard.ts';
import { MotorsTab } from '../src/workspace/views/board/motors.ts';
import { one, byAttr, root, text } from './tree.ts';
import { boardView, OWNER_449 } from './boardViews.ts';
import { OWNER_157 } from './axesModel.test.ts';

const d449 = settingsDefsFor('tinyg-449-stock')!;
const INCHES = { ...OWNER_157, xtn: 0, xtm: 5.906, xlb: 0.197, xvm: 31.5, '1tr': 0.049 };
const inches449 = boardView({ ...OWNER_449, unit: 0, settings: INCHES });

beforeEach(() => clearDraft());

describe('a 449 board in G20 shows lengths in inches', () => {
  it('valueWordsOf spells a length in inches only when asked and only for a length', () => {
    expect(valueWordsOf(d449.tokens.get('xtm')!, 5.906, true)).toBe('5.906 in');
    expect(valueWordsOf(d449.tokens.get('xvm')!, 31.5, true)).toBe('31.5 in/min');
    expect(valueWordsOf(d449.tokens.get('xtm')!, 5.906)).toBe('5.906 mm');
    expect(valueWordsOf(d449.tokens.get('atm')!, 90, true)).toBe('90°');
    expect(valueWordsOf(d449.tokens.get('1sa')!, 1.8, true)).toBe('1.8° per step');
  });

  it('Axes: End reads 5.906 in, the summary and the homing search are in inches', () => {
    subTabChoice.axes.value = 'x';
    const x = one(root(h(AxesTab, { view: inches449 })), byAttr('data-axis-card', 'x'));
    subTabChoice.axes.value = null;
    expect(text(one(x, byAttr('data-axis-row', 'xtm')))).toContain('5.906 in');
    expect(text(one(x, byAttr('data-axis-row', 'xtm')))).not.toContain('mm');
    expect(text(x)).toContain('0 to 5.906 in');
    expect(text(x)).toContain('31.5 in/min');
    const cards = axisCards(d449, INCHES, ['x'], { dialectId: 'tinyg-449-stock', inches: true });
    expect(cards.cards[0]?.summary).toContain('0 to 5.906 in');
    expect(travelLine(d449, { ...INCHES, sl: 1 }, 'x', { dialectId: 'tinyg-449-stock', inches: true })).toBe('Homing searches 6.103 in.');
  });

  it('All settings: the value on the board is in inches', () => {
    const html = renderToString(h(AllSettings, { view: inches449 }));
    expect(html).toMatch(/data-key="xtm"[\s\S]*?5\.906 in/);
    expect(html).not.toMatch(/data-key="xtm"[^]*?5\.906 mm/);
  });

  it('Motors: travel per turn in inches, steps per inch, and the pin panel facts too', () => {
    const m1 = one(root(h(MotorsTab, { view: inches449 })), byAttr('data-motor-card', '1'));
    expect(text(m1)).toContain('0.049 in');
    expect(text(m1)).toContain('Steps per inch');
    expect(text(root(h(MotorFacts, { m: 1, view: inches449 })))).toContain('0.049 in');
  });
});
