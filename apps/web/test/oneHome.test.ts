/**
 * One home for each setting (Board settings spec §5.6, §4.4 item 7): on an approved 450 board, every setting
 * control on a Board tab belongs to that tab by its definition's `tab`. All settings is the index and is excepted.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { settingsDefsFor } from '@synthetos/schema';
import { AxesTab } from '../src/workspace/views/board/axes.ts';
import { CommsTab } from '../src/workspace/views/board/comms.ts';
import { InputsTab } from '../src/workspace/views/board/inputs.ts';
import { MotorsTab } from '../src/workspace/views/board/motors.ts';
import { OutputsTab } from '../src/workspace/views/board/outputs.ts';
import { boardView } from './boardViews.ts';
import { OWNER_157 } from './axesModel.test.ts';

const view = boardView({ settings: { ...OWNER_157, st: 0, prbp: 0, spep: 1, spdp: 0, mt: 2, '1sa': 1.8, '1tr': 1.25, '1mi': 8, '1po': 0, '1pm': 2, ex: 1, baud: 5 } });
const defs = settingsDefsFor('tinyg-en', 450.06)!;
const TABS: readonly [string, () => string][] = [
  ['axes', () => renderToString(h(AxesTab, { view }))],
  ['inputs', () => renderToString(h(InputsTab, { view }))],
  ['motors', () => renderToString(h(MotorsTab, { view }))],
  ['io', () => renderToString(h(OutputsTab, { view }))],
  ['comms', () => renderToString(h(CommsTab, { view }))],
];

describe('one home per setting', () => {
  it.each(TABS)('every control on %s belongs to it', (tab, html) => {
    const keys = [...html().matchAll(/data-setting-control="([^"]+)"/g)].map((m) => m[1] as string);
    expect(keys.filter((k) => defs.tokens.get(k)?.tab !== tab)).toEqual([]);
  });

  it('Axes, Inputs and Motors render controls at all', () => {
    for (const [tab, html] of TABS.slice(0, 3)) expect({ tab, any: /data-setting-control=/.test(html()) }).toEqual({ tab, any: true });
  });
});
