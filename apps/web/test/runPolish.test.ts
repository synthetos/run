import { describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { helpPosition } from '../src/shell/helpPosition.ts';
import { AnalysisWarning, ViewerOptions } from '../src/preview/ViewerOptions.ts';
import { IDLE_STATE } from '../src/preview/PreviewView.ts';
import type { PreviewParts } from '../src/preview/PreviewPanel.ts';
import { JOB_STEPS } from '../src/workspace/jobWorkflow.ts';
import { root, all } from './tree.ts';

describe('viewport help placement', () => {
  const viewport = { width: 800, height: 600 };
  it('flips below near the top, above near the bottom and clamps the sides', () => {
    expect(helpPosition({ left: 2, right: 26, top: 4, bottom: 28 }, 340, 150, viewport, false, true)).toEqual({ left: 8, top: 36 });
    expect(helpPosition({ left: 770, right: 794, top: 560, bottom: 584 }, 340, 150, viewport, true, false)).toEqual({ left: 452, top: 402 });
    expect(helpPosition({ left: 400, right: 424, top: 300, bottom: 324 }, 340, 150, viewport, false, true)).toEqual({ left: 84, top: 142 });
    expect(helpPosition({ left: 30, right: 54, top: 30, bottom: 54 }, 340, 580, viewport, true, false)).toEqual({ left: 30, top: 8 });
  });
});
it('uses one Fine/Coarse toggle, retains auto refinement and never offers full', () => {
  for (const mode of ['auto', 'lite', 'full'] as const) {
    const onMode = vi.fn();
    const parts = { state: { ...IDLE_STATE, mode }, actions: { onMode } } as unknown as PreviewParts;
    const button = all(root(ViewerOptions({ parts, disabled: false })), n => n.tag === 'button')[0]!;
    expect(button.props['aria-pressed']).toBe(mode === 'lite');
    (button.props['onClick'] as () => void)();
    expect(onMode).toHaveBeenCalledWith(mode === 'lite' ? 'auto' : 'lite');
    const html = renderToString(h(ViewerOptions, { parts, disabled: true }));
    expect(html).toContain('disabled');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('Checked for');
  }
  expect(JOB_STEPS[2].label).toBe('Open & place job');
});

it('keeps the connected unsupported firmware warning on Check, with no disconnected note', () => {
  expect(renderToString(h(AnalysisWarning, { connected: true, dialect: 'g2core-edge' }))).toContain("This board's firmware is not covered.");
  expect(renderToString(h(AnalysisWarning, { connected: true, dialect: 'tinyg-en' }))).toBe('');
  expect(renderToString(h(AnalysisWarning, { connected: false, dialect: undefined }))).toBe('');
});
