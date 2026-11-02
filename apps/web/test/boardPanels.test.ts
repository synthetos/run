/**
 * Board panels component (ROADMAP TB-05a acceptance): each generated
 * definition renders its own capability-driven panel set, and an unknown hv
 * renders the safe subset with a visible "unrecognised board revision" notice.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { BOARD_DEFINITIONS, UNRECOGNISED_BOARD_NOTICE, boardPanels, selectBoard, selectGeneratedBoard } from '@synthetos/schema';
import type { BoardDefinition } from '@synthetos/schema';
import { BoardPanels } from '../src/wiring/BoardPanels.ts';
import { all, byAttr, root, text } from './tree.ts';

const render = (set: ReturnType<typeof boardPanels>) => root(h(BoardPanels, { set }));
const panels = (set: ReturnType<typeof boardPanels>) => all(render(set), byAttr('data-panel')).map((e) => e.props['data-panel']);

describe('BoardPanels', () => {
  it.each(BOARD_DEFINITIONS.map((d) => [d.id, d] as const))('%s renders exactly the panels its definition lists', (_id, d) => {
    const set = boardPanels(selectGeneratedBoard({ family: 'tinyg', hp: d.match.hp, hv: d.match.hv[0] as number }));
    const tree = render(set);
    expect(tree.props['data-board']).toBe(d.id);
    expect(all(tree, byAttr('data-notice'))).toEqual([]);
    expect(panels(set)).toEqual(set.panels.map((p) => (p.kind === 'output' ? `output:${p.id}` : p.kind)));
    expect(panels(set).filter((p) => String(p).startsWith('output:'))).toEqual(d.outputs.map((o) => `output:${o.id}`));
  });

  it('TinyG v8 shows its connectors; v6 does not; a board without a direction output shows no direction panel', () => {
    const v8 = panels(boardPanels(selectGeneratedBoard({ family: 'tinyg', hp: 1, hv: 8 })));
    const v6 = panels(boardPanels(selectGeneratedBoard({ family: 'tinyg', hp: 1, hv: 6 })));
    expect(v8).toContain('connectors');
    expect(v6).not.toContain('connectors');
    const base = BOARD_DEFINITIONS.find((d) => d.id === 'tinyg-v8@8') as BoardDefinition;
    const noDir: BoardDefinition = { ...base, id: 'test-board@1', outputs: base.outputs.filter((o) => o.id !== 'spindleDirection') };
    const set = boardPanels(selectBoard({ family: 'tinyg', hp: 1, hv: 8 }, [noDir]));
    expect(panels(set)).not.toContain('output:spindleDirection');
    expect(panels(set)).toContain('output:spindleEnable');
  });

  it('the v8 spindle PWM panel shows the generated pin', () => {
    const tree = render(boardPanels(selectGeneratedBoard({ family: 'tinyg', hp: 1, hv: 8 })));
    expect(text(all(tree, byAttr('data-panel', 'output:spindlePwm'))[0] as never)).toContain('PD5');
  });

  it('an unknown hv renders no panels and an alert saying the revision is unrecognised', () => {
    const tree = render(boardPanels(selectGeneratedBoard({ family: 'tinyg', hp: 1, hv: 9 })));
    const alerts = all(tree, byAttr('role', 'alert'));
    expect(alerts).toHaveLength(1);
    expect(text(alerts[0] as never)).toContain(UNRECOGNISED_BOARD_NOTICE);
    expect(all(tree, byAttr('data-panel'))).toEqual([]);
  });
});
