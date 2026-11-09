/** Set work zero's confirmation (C16; owner, 2026-11-09): one sentence; the machine numbers in Advanced only. */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { WorkZeroConfirm } from '../src/workspace/workZeroConfirm.ts';

const props = { system: 'G54', machine: (a: string) => (a === 'z' ? -12.5 : 100), onCancel: () => undefined, onConfirm: () => undefined };

describe('WorkZeroConfirm (C16)', () => {
  it('asks once for the axes set, in Simple without numbers', () => {
    const html = renderToString(h(WorkZeroConfirm, { ...props, axes: ['x', 'y', 'z'], advanced: false }));
    expect(html).toContain("Set X, Y and Z zero at the tool's current position? The board saves it (as G54), so it stays until you set zero again.");
    expect(html).not.toContain('work-zero-details');
    expect(html).not.toContain('100.000');
  });
  it('names one axis alone, and Advanced lists the machine position and the new offset', () => {
    const html = renderToString(h(WorkZeroConfirm, { ...props, axes: ['z'], advanced: true }));
    expect(html).toContain('Set Z zero at the tool');
    expect(html).toContain('Z: machine −12.500 mm; new G54 offset −12.500 mm');
  });
});
