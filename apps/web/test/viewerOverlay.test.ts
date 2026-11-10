/**
 * The stack over the 3D drawing (first-time walk 2026-11-08, B4 and C18): the prompt, the key and the readout in
 * one column; the key hides (remembered); the drawing's notes are in the Notes tab (owner, 2026-11-09) and a
 * "N notes" pill in the bar opens it, key shown or hidden; Expand toggles.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { keyOpen, ViewerOverlay } from '../src/preview/ViewerOverlay.ts';
import { previewNotes, splitNote } from '../src/preview/previewNotes.ts';
import { publishNotes, resetNotes } from '../src/workspace/notes/notes.ts';
import { ExpandButton, previewExpanded } from '../src/preview/expandPreview.ts';
import type { SceneKeyProps } from '../src/preview/SceneKey.ts';
import type { JobScene } from '../src/preview/sceneModel.ts';
import { byAttr, one, root } from './tree.ts';

const scene = { layers: { solids: [], rings: [] }, notes: ['Machine position not set.', 'Work zero Z is 46.6 mm above the planned zero.'], bedLabel: 'Bed', bedPlaceholder: true } as unknown as JobScene;
const key: SceneKeyProps = { scene, simple: true };

describe('ViewerOverlay', () => {
  beforeEach(() => { keyOpen.value.value = true; });

  it('the scene\'s notes become notes for the Notes tab: a title and a short body', () => {
    expect(previewNotes(key).map((n) => [n.topic, n.title, n.body])).toEqual([
      ['Preview', 'Machine position not set.', ''],
      ['Preview', 'Work zero Z is 46.6 mm above the planned zero.', ''],
    ]);
    expect(previewNotes(null)).toEqual([]);
    expect(splitNote('Machine position not set: the job is shown as planned. Home first.')).toEqual({ title: 'Machine position not set.', body: 'The job is shown as planned. Home first.' });
  });

  it('open: the key line and the readout in one stack, the prompt first; no notes over the drawing, a pill that opens them', () => {
    resetNotes();
    publishNotes('preview', previewNotes(key));
    const html = renderToString(h(ViewerOverlay, { sceneKey: key, readout: h('p', { 'data-preview': 'marker-readout' }, 'Tool at X 0'), prompt: h('div', { 'data-test': 'prompt' }, 'Open a file') }));
    expect(html).toContain('data-key-open="true"');
    expect(html.indexOf('data-test="prompt"')).toBeLessThan(html.indexOf('scene-key-line'));
    expect(html.indexOf('scene-key-line')).toBeLessThan(html.indexOf('data-preview="marker-readout"'));
    expect(html).not.toContain('Machine position not set.');
    expect(html).toMatch(/data-action="open-notes"[^>]*>2 notes</);
    expect(html).toContain('Hide key');
    resetNotes();
  });

  it('hidden: no key, the readout stays, and the pill still counts the notes', () => {
    keyOpen.value.value = false;
    resetNotes();
    publishNotes('preview', previewNotes(key));
    const html = renderToString(h(ViewerOverlay, { sceneKey: key, readout: h('p', { 'data-preview': 'marker-readout' }, 'Tool at X 0') }));
    expect(html).toContain('data-key-open="false"');
    expect(html).not.toContain('scene-key-line');
    expect(html).toContain('data-preview="marker-readout"');
    expect(html).toContain('2 notes');
    expect(html).toContain('Show key');
    resetNotes();
  });

  it('nothing to show is nothing', () => {
    expect(renderToString(h(ViewerOverlay, { sceneKey: null, readout: null }))).toBe('');
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
