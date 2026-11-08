/**
 * The stack over the 3D drawing (first-time walk 2026-11-08, B4 and C18): the prompt, the key and the readout in
 * one column; the key hides (remembered), and hidden, a count of its notes stays in view; Expand toggles.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { keyNotes, keyOpen, notesCount, ViewerOverlay } from '../src/preview/ViewerOverlay.ts';
import { ExpandButton, previewExpanded } from '../src/preview/expandPreview.ts';
import type { SceneKeyProps } from '../src/preview/SceneKey.ts';
import type { JobScene } from '../src/preview/sceneModel.ts';
import { byAttr, one, root } from './tree.ts';

const scene = { layers: { solids: [], rings: [] }, notes: ['Machine position not set.', 'Work zero Z is 46.6 mm above the planned zero.'], bedLabel: 'Bed', bedPlaceholder: true } as unknown as JobScene;
const key: SceneKeyProps = { scene, simple: true };

describe('ViewerOverlay', () => {
  beforeEach(() => { keyOpen.value.value = true; });

  it('counts every note the key shows', () => {
    expect(keyNotes(key)).toBe(2);
    expect(keyNotes(null)).toBe(0);
    expect(notesCount(1)).toBe('1 note');
    expect(notesCount(2)).toBe('2 notes');
  });

  it('open: the notes, the key line and the readout in one stack, the prompt first', () => {
    const html = renderToString(h(ViewerOverlay, { sceneKey: key, readout: h('p', { 'data-preview': 'marker-readout' }, 'Tool at X 0'), prompt: h('div', { 'data-test': 'prompt' }, 'Open a file') }));
    expect(html).toContain('data-key-open="true"');
    expect(html.indexOf('data-test="prompt"')).toBeLessThan(html.indexOf('data-scene="notes"'));
    expect(html.indexOf('data-scene="notes"')).toBeLessThan(html.indexOf('data-preview="marker-readout"'));
    expect(html).toContain('Hide key');
  });

  it('hidden: no key, the readout stays, and the notes are counted in view', () => {
    keyOpen.value.value = false;
    const html = renderToString(h(ViewerOverlay, { sceneKey: key, readout: h('p', { 'data-preview': 'marker-readout' }, 'Tool at X 0') }));
    expect(html).toContain('data-key-open="false"');
    expect(html).not.toContain('data-scene="notes"');
    expect(html).toContain('data-preview="marker-readout"');
    expect(html).toContain('2 notes');
    expect(html).toContain('Show key');
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
