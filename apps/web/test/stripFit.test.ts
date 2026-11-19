/**
 * The machine strip's readouts give way to Pause and Stop job (first-time walk 2026-11-08, S1;
 * styles/strip-fit.css): each readout is named by its label, so the narrow widths can drop Coolant and the
 * Job line, and each value carries its whole text as a title for when it is shortened with an ellipsis.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { MachineStrip } from '../src/workspace/MachineStrip.ts';
import type { StripStatus } from '../src/workspace/status.ts';

const STATUS: StripStatus = {
  connected: true,
  title: 'Moving',
  name: 'My X-Carve · TinyG v8',
  tone: 'run',
  pill: null,
  text: null,
  spindleOn: true,
  readouts: [
    { label: 'Feed', value: '800 / 900', unit: 'mm/min', title: 'Actual / commanded feed reported by the controller.' },
    { label: 'Spindle', value: 'On · CW · 16 000 rpm commanded', title: 'Spindle' },
    { label: 'Coolant', value: 'Flood off', title: 'Coolant', quiet: true },
    { label: 'Job', value: 'line 6', title: 'The line the controller reports executing.' },
  ],
};

describe('strip readouts (S1)', () => {
  it('names each readout by its label and puts the whole value, unit included, in a title', () => {
    const html = renderToString(h(MachineStrip, { status: STATUS, stop: null, previousSession: false }));
    for (const name of ['feed', 'spindle', 'coolant', 'job']) expect(html).toContain(`readout ro-${name}`);
    expect(html).toContain('title="800 / 900 mm/min"');
    expect(html).toContain('title="On · CW · 16 000 rpm commanded"');
  });
});

describe('the Coolant readout (owner 2026-11-08)', () => {
  it('is marked off only when it is quiet (reported off, or the machine says nothing is wired)', () => {
    const off = renderToString(h(MachineStrip, { status: STATUS, stop: null, previousSession: false }));
    expect(off).toContain('readout ro-coolant is-off');
    const on = renderToString(h(MachineStrip, { status: { ...STATUS, readouts: STATUS.readouts.map((r) => (r.label === 'Coolant' ? { label: r.label, title: r.title, value: 'Flood on' } : r)) }, stop: null, previousSession: false }));
    expect(on).toContain('class="readout ro-coolant"');
  });
});

describe('the name line (review 2026-11-18, minor 8: like the owner 149, never cut mid-word)', () => {
  it('is one part per " · " piece, each whole or out of sight, with the full line as its title', () => {
    const html = renderToString(h(MachineStrip, { status: { ...STATUS, name: 'No machine profile · TinyG v8 · firmware 450.90 · SIM-EN-0001' }, stop: null, previousSession: false }));
    expect(html).toContain('data-strip="name" title="No machine profile · TinyG v8 · firmware 450.90 · SIM-EN-0001"');
    expect(html).toContain('<span class="name-part">No machine profile</span><span class="name-part">· TinyG v8</span><span class="name-part">· firmware 450.90</span><span class="name-part">· SIM-EN-0001</span>');
  });
});
