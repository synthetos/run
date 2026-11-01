/**
 * The preview sheet (ROADMAP TB-03): W13 pinned, no Play or Simulate control
 * in any state (T-S41), the scrubber, lite mode, the 2D fallback and the
 * virtualised list with a verdict per line.
 */
import { describe, expect, it } from 'vitest';
import { Fragment, h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { w13 } from '@synthetos/safety';
import { listWindow } from '@synthetos/gcode-view';
import { analyseBytes } from '../src/gcode-worker/pipeline.ts';
import { IDLE_STATE, PreviewView, type PreviewViewState } from '../src/preview/PreviewView.ts';
import { PreviewPanel } from '../src/preview/PreviewPanel.ts';
import { PreviewSvg } from '../src/preview/PreviewSvg.ts';
import { listRows, worstByLine } from '../src/preview/LineList.ts';
import { parseColor, previewColors } from '../src/preview/colors.ts';
import { all, byAttr, one, root, text, type El } from './tree.ts';

const bytesOf = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const FILE = 'G21 G90\nG0 X10 Y10\nG1 X20 F600\nG2 X22 Y10 I1 J0\nG28.3 X0\nM30\n';
const full = analyseBytes(bytesOf(FILE), { dialect: 'tinyg-en', mode: 'full' }).result;
const lite = analyseBytes(bytesOf(FILE), { dialect: 'tinyg-en', mode: 'lite' }).result;

const STATES: Readonly<Record<string, PreviewViewState>> = {
  prerendered: IDLE_STATE,
  idle: { ...IDLE_STATE, ready: true },
  loading: { ...IDLE_STATE, ready: true, status: 'loading', fileName: 'a.nc', progress: { phase: 'read', fraction: 0.5 } },
  'ready 3D': { ...IDLE_STATE, ready: true, status: 'ready', fileName: 'a.nc', result: full, scrub: 3 },
  'ready 2D': { ...IDLE_STATE, ready: true, status: 'ready', fileName: 'a.nc', result: full, drawing: 'svg' },
  'ready lite': { ...IDLE_STATE, ready: true, status: 'ready', fileName: 'a.nc', result: lite },
  error: { ...IDLE_STATE, ready: true, status: 'error', error: 'the file is too big' },
};

const noop = (): void => {};
const ACTIONS = { onFile: noop, onDialect: noop, onMode: noop, onCancel: noop, onRapids: noop, onScrub: noop, onFit: noop };

function view(state: PreviewViewState): El {
  const slots = state.result?.segments
    ? { drawing: h(PreviewSvg, { segments: state.result.segments, showRapids: true, highlight: state.scrub - 1, envelope: null }) }
    : {};
  return root(h(PreviewView, { state, actions: ACTIONS, slots }));
}

describe('T-S41: no element offers Play or Simulate', () => {
  it.each(Object.keys(STATES))('%s', (name) => {
    const state = STATES[name] as PreviewViewState;
    const el = view(state);
    const html = renderToString(h(Fragment, null, h(PreviewView, { state, actions: ACTIONS })));
    expect(html).not.toMatch(/\b(play|simulat|animat)/i);
    for (const e of all(el, () => true)) {
      for (const key of ['aria-label', 'title', 'value', 'aria-valuetext']) expect(String(e.props[key] ?? '')).not.toMatch(/\b(play|simulat|animat)/i);
    }
    // The only buttons are Cancel (while loading) and Fit view (3D).
    const buttons = all(el, (e) => e.tag === 'button').map((b) => text(b));
    for (const b of buttons) expect(['Cancel', 'Fit view']).toContain(b);
  });
});

describe('W13 and the prerendered sheet', () => {
  it.each(Object.keys(STATES))('W13 is pinned to the preview in state %s', (name) => {
    const note = one(view(STATES[name] as PreviewViewState), byAttr('data-safety', 'W13'));
    expect(text(note)).toBe(w13());
    expect(note.props['role']).toBe('note');
  });

  it('prerendered, every control is disabled and carries no handler', () => {
    const el = root(h(PreviewView, { state: IDLE_STATE }));
    for (const input of all(el, (e) => e.tag === 'input' || e.tag === 'select')) expect(input.props['disabled'], String(input.props['type'])).toBe(true);
    for (const e of all(el, () => true)) expect(Object.keys(e.props).filter((k) => /^on[A-Z]/.test(k))).toEqual([]);
  });

  it('the live panel first renders exactly the prerendered markup (hydration matches)', () => {
    const prerendered = renderToString(h(Fragment, null, h(PreviewView, { state: IDLE_STATE })));
    expect(renderToString(h(Fragment, null, h(PreviewPanel, { spawn: null })))).toBe(prerendered);
  });
});

describe('scrubber, lite mode and drawing', () => {
  it('the scrubber steps over the sent lines and names the file line it reaches', () => {
    const el = view(STATES['ready 3D'] as PreviewViewState);
    const range = one(el, byAttr('data-preview', 'scrubber'));
    expect(range.props['type']).toBe('range');
    expect(range.props['max']).toBe(full.sourceLines.length);
    expect(text(one(el, byAttr('data-preview', 'scrub-line')))).toBe(`file line ${String(full.sourceLines[2])}`);
  });

  it('lite mode shows no drawing, only the list and summary', () => {
    const el = view(STATES['ready lite'] as PreviewViewState);
    expect(all(el, byAttr('data-preview', 'drawing'))).toEqual([]);
    expect(all(el, byAttr('data-preview', 'lite'))).toHaveLength(1);
    expect(all(el, byAttr('data-preview', 'summary'))).toHaveLength(1);
  });

  it('a blocked file says so in the summary', () => {
    const el = view(STATES['ready 3D'] as PreviewViewState);
    expect(one(one(el, byAttr('data-preview', 'summary')), byAttr('data-verdict')).props['data-verdict']).toBe('block');
  });

  it('the 2D fallback draws the same segments as a top view, with the scrubbed lines highlighted', () => {
    const segments = full.segments;
    if (segments === null) throw new Error('expected segments');
    const svg = root(h(PreviewSvg, { segments, showRapids: true, highlight: 1, envelope: null }));
    const d = (cls: string): string => String(one(svg, (e) => e.props['class'] === cls).props['d']);
    expect(d('pv-feed')).toContain('L20 -10');
    expect(d('pv-rapid')).toContain('L10 -10');
    expect(d('pv-highlight')).not.toBe('');
  });
});

describe('virtualised list', () => {
  it('rows carry the file text, the per-line verdict and the highlight', () => {
    const data = { bytes: full.bytes, spans: full.spans, verdicts: full.verdicts };
    const win = listWindow({ count: full.fileLines, rowHeight: 22, scrollTop: 0, viewportHeight: 330 });
    const worst = worstByLine([{ line: 5, n: null, severity: 'block', rule: 'x', message: 'refused', source: 'sanitizer' }]);
    const rows = listRows(data, win, 2, worst).map((r) => root(r));
    expect(rows.map((r) => r.props['data-line'])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(text(one(rows[1] as El, (e) => e.tag === 'code'))).toBe('G0 X10 Y10');
    expect(rows.map((r) => r.props['data-highlight'])).toEqual(['true', 'true', undefined, undefined, undefined, undefined]);
    expect((rows[4] as El).props['data-verdict']).toBe('block');
    expect(text(rows[4] as El)).toContain('refused');
  });

  it('keeps the worst finding per line', () => {
    const w = worstByLine([
      { line: 1, n: null, severity: 'info', rule: 'a', message: 'a', source: 'analyser' },
      { line: 1, n: null, severity: 'warn', rule: 'b', message: 'b', source: 'analyser' },
      { line: 1, n: null, severity: 'change', rule: 'c', message: 'c', source: 'analyser' },
    ]);
    expect(w.get(1)?.rule).toBe('b');
  });
});

describe('colours from the design tokens', () => {
  it('parses hex and rgb forms and falls back otherwise', () => {
    expect(parseColor('#fff')).toEqual([1, 1, 1, 1]);
    expect(parseColor(' #ff0000 ')).toEqual([1, 0, 0, 1]);
    expect(parseColor('rgb(0, 0, 255)')).toEqual([0, 0, 1, 1]);
    expect(parseColor('rgba(0 0 0 / 50%)')).toEqual([0, 0, 0, 0.5]);
    expect(parseColor('oklch(0.5 0.1 200)')).toBeNull();
    const c = previewColors((t) => (t === '--danger' ? '#cc0000' : ''));
    expect(c.outOfBounds).toEqual([0.8, 0, 0, 1]);
    expect(c.feed).toHaveLength(4);
  });
});
