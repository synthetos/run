/**
 * What sits over the 3D drawing (owner, 2026-11-09): the prompt, one small bar (the viewer's settings menu, a "Not
 * homed" chip, an "N notes" pill) and the colour legend; the explanations are in the Notes tab; Expand toggles.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { liveChips, positionChip, ViewerOverlay } from '../src/preview/ViewerOverlay.ts';
import { UNSET_NOTE } from '../src/preview/livePlacement.ts';
import { previewNotes, splitNote } from '../src/preview/previewNotes.ts';
import { publishNotes, resetNotes } from '../src/workspace/notes/notes.ts';
import { ExpandButton, previewExpanded } from '../src/preview/expandPreview.ts';
import type { SceneKeyProps } from '../src/preview/SceneKey.ts';
import type { JobScene } from '../src/preview/sceneModel.ts';
import { byAttr, one, root } from './tree.ts';

const scene = { layers: { solids: [], rings: [] }, notes: ['Machine position not set.', 'Work zero Z is 46.6 mm above the planned zero.'], bedLabel: 'Bed', bedPlaceholder: true } as unknown as JobScene;
const key: SceneKeyProps = { scene, simple: true };
const unset: SceneKeyProps = { scene: { ...scene, notes: [UNSET_NOTE] }, simple: true };

describe('ViewerOverlay (owner, 2026-11-09: the viewer shows the picture)', () => {
  it('uses the firmware diagnosis in both the chip and its help; legacy chips keep their wording', () => {
    const html = renderToString(h('div', null, liveChips({ ...key, starved: true, feedDiagnosis: 'The machine limited the speed' }, false)));
    expect(html).toContain('title="The machine limited the speed"');
    expect(html).toContain('>The machine limited the speed</span>');
    expect(html).not.toContain('ran short');
    expect(renderToString(h('div', null, liveChips({ ...key, starved: true }, false)))).toContain('>Planner starved</span>');
  });
  it('the scene\'s notes become notes for the Notes tab: a title and a short body', () => {
    expect(previewNotes(key).map((n) => [n.topic, n.title, n.body])).toEqual([
      ['Preview', 'Machine position not set.', ''],
      // The Z note is folded into the Run step's work zero note (owner, 2026-11-09).
    ]);
    expect(previewNotes(null)).toEqual([]);
    expect(splitNote('Machine position not set: the job is shown as planned. Home first.')).toEqual({ title: 'Machine position not set.', body: 'The job is shown as planned. Home first.' });
  });

  it('one small bar (the settings menu, a position chip, the notes pill) and the legend; no notes, readout or Hide key over the drawing', () => {
    resetNotes();
    publishNotes('preview', previewNotes(unset));
    const html = renderToString(h(ViewerOverlay, { sceneKey: unset, prompt: h('div', { 'data-test': 'prompt' }, 'Open a file') }));
    expect(html.indexOf('data-test="prompt"')).toBeLessThan(html.indexOf('viewer-overlay-bar'));
    expect(html).toContain('data-preview="viewer-menu"');
    expect(html).toMatch(/data-preview="position-chip"[^>]*>Not homed</);
    expect(html).toMatch(/data-action="open-notes"[^>]*>1 note</);
    expect(html).not.toContain(UNSET_NOTE);
    expect(html).not.toContain('marker-readout');
    expect(html).not.toContain('key-toggle');
    expect(positionChip(key)).toBeNull();
    resetNotes();
  });

  it('nothing to show is nothing', () => {
    expect(renderToString(h(ViewerOverlay, { sceneKey: null }))).toBe('');
  });
});

describe('ExpandButton', () => {
  it('toggles the expanded state and says what it will do', () => {
    previewExpanded.value = false;
    const off = root(h(ExpandButton, null));
    expect(off.props['aria-pressed']).toBe('false');
    (one(off, byAttr('data-action', 'preview-expand')).props['onClick'] as () => void)();
    expect(previewExpanded.value).toBe(true);
    const on = root(h(ExpandButton, null));
    expect(on.props['aria-pressed']).toBe('true');
    previewExpanded.value = false;
  });
});
