/**
 * From the scene to its settings (preview/sceneSettings.ts, SceneKey.ts, the SVG fallback): a part opens
 * the job step that edits it and focuses its heading; the key offers the same links for the keyboard and
 * carries the live placement's notes. Navigation only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { h } from 'preact';
import { all, byAttr, one, root, text } from './tree.ts';
import { newDraftJob, type JobClock } from '../src/workspace/jobModel.ts';
import { jobStep } from '../src/workspace/jobWorkflow.ts';
import { jobScene } from '../src/preview/sceneModel.ts';
import { previewNotes } from '../src/preview/previewNotes.ts';
import { SceneKey } from '../src/preview/SceneKey.ts';
import { PreviewSvg } from '../src/preview/PreviewSvg.ts';
import { openSceneSettings, pickLabel, scenePart } from '../src/preview/sceneSettings.ts';

const SCENE_COLORS = { bed: [0.7, 0.6, 0.5, 1], fixture: [0.5, 0.6, 0.7, 1], clamp: [0.4, 0.4, 0.4, 1], stock: [0.8, 0.8, 0.8, 1] } as const;
const clock = (): JobClock => ({ now: () => new Date('2026-11-03T09:00:00Z'), newId: () => 'j1' });
const draft = () => jobScene(newDraftJob(clock()), SCENE_COLORS, null);

afterEach(() => { vi.unstubAllGlobals(); });

describe('scene parts open their settings', () => {
  it('tags name parts; the hover label says what a click opens', () => {
    expect(['bed', 'fixture', 'stock', 'clamp', 'zero', undefined].map(scenePart)).toEqual(['bed', 'fixture', 'stock', 'clamp', null, null]);
    expect(pickLabel('fixture')).toBe('Fixture: open settings');
    expect(pickLabel('clamp')).toBe('Clamp: open stock & workholding');
  });

  it('a part opens the Job view at its step, then shows its section and focuses the heading', () => {
    const frames: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (f: () => void) => { frames.push(f); return frames.length; });
    const heading = { attrs: new Map<string, string>(), scrolled: false, focused: false, details: { open: false } };
    const el = {
      hasAttribute: (a: string) => heading.attrs.has(a),
      setAttribute: (a: string, v: string) => heading.attrs.set(a, v),
      closest: () => heading.details,
      scrollIntoView: () => { heading.scrolled = true; },
      focus: () => { heading.focused = true; },
    };
    const asked: string[] = [];
    const doc = { querySelector: (s: string) => { asked.push(s); return el; } } as unknown as Document;
    const views: string[] = [];
    jobStep.value = 'run';
    openSceneSettings('fixture', (v) => views.push(v), doc);
    expect(views).toEqual(['job']);
    expect(jobStep.value).toBe('stock');
    while (frames.length > 0) frames.shift()?.();
    expect(asked).toEqual(['[data-setup-section="fixture"] h2']);
    expect(heading).toMatchObject({ scrolled: true, focused: true, details: { open: true } });
    expect(heading.attrs.get('tabindex')).toBe('-1');
    openSceneSettings('bed', () => {}, doc);
    expect(jobStep.value).toBe('machine');
  });

  it('the key: the bed and links to the parts that exist; the placement notes are notes (Notes tab), not on the key', () => {
    const scene = { ...draft(), notes: ['Machine position not set.'] };
    const opened: string[] = [];
    const el = root(h(SceneKey, { scene, onOpen: (p) => opened.push(p) }));
    expect(text(one(el, byAttr('data-scene', 'bed')))).toBe(scene.bedLabel);
    expect(all(el, byAttr('data-scene', 'note'))).toHaveLength(0);
    expect(previewNotes({ scene }).map((n) => n.title)).toEqual(['Machine position not set.']);
    const links = all(el, (e) => e.props['data-scene-link'] !== undefined);
    const hasFixture = scene.layers.solids.some((s) => s.tag === 'fixture');
    expect(links.map((l) => text(l))).toEqual(hasFixture ? ['Bed settings', 'Fixture settings', 'Stock settings'] : ['Bed settings', 'Stock settings']);
    (links[0]?.props['onClick'] as () => void)();
    expect(opened).toEqual(['bed']);
    // While a job owns the machine: the key, no links.
    expect(all(root(h(SceneKey, { scene })), (e) => e.props['data-scene-link'] !== undefined)).toHaveLength(0);
  });

  it('the SVG top view: solids are clickable with a title when picking is on, plain otherwise', () => {
    const scene = draft();
    const picked: string[] = [];
    const props = { segments: null, showRapids: true, highlight: -1, envelope: null, scene: scene.layers, pathOffset: scene.pathOffset };
    const el = root(h(PreviewSvg, { ...props, onPick: (t: string) => picked.push(t), pickLabel: (t: string) => { const p = scenePart(t); return p === null ? null : pickLabel(p); } }));
    const stock = one(el, byAttr('data-preview', 'scene-stock'));
    expect(stock.props['class']).toBe('pv-solid pv-stock pv-pickable');
    expect(text(stock)).toBe('Stock: open settings');
    (stock.props['onClick'] as () => void)();
    expect(picked).toEqual(['stock']);
    const plain = one(root(h(PreviewSvg, props)), byAttr('data-preview', 'scene-stock'));
    expect(plain.props['onClick']).toBeUndefined();
    expect(plain.props['class']).toBe('pv-solid pv-stock');
  });
});
