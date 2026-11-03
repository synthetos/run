/**
 * Scene solids under the path: boxes and prisms become flat-shaded
 * triangles, rings become line circles, the renderer uploads them once and
 * draws them before the path, the path moves by a uniform offset (no
 * re-upload), the named views turn the camera, and the top-view fallback
 * gets the same solids as outlines.
 */
import { describe, expect, it } from 'vitest';
import { FACE_SHADE, SEGMENT, VIEW_ANGLES, createRenderer, fitOrbit, offsetBox, project, ringSegments, sceneBounds, solidTriangles, svgGrid, svgPaths, svgScene, triangulate, unionBox, viewProjection, type SceneLayers } from '../src/index.ts';
import { COLORS, fakeGl, frameQueue, listOf } from './helpers.ts';

const instant = { yieldToHost: async () => {} };
const GREY = [0.5, 0.5, 0.5, 1] as const;

const SCENE: SceneLayers = {
  solids: [
    { kind: 'box', min: [0, 0, -19], max: [300, 200, 0], color: GREY, tag: 'bed' },
    { kind: 'prism', outline: [[10, 10], [110, 10], [110, 60], [60, 90], [10, 60]], z0: 0, z1: 12, color: [0.4, 0.5, 0.6, 1], tag: 'fixture' },
  ],
  rings: [{ center: [20, 20, 12], radius: 3, color: GREY }],
};

describe('scene geometry', () => {
  it('a box is 12 flat-shaded triangles; its top face keeps the full tone and the X faces the darkest', () => {
    const t = solidTriangles(SCENE.solids[0] as never);
    expect(t.positions.length).toBe(12 * 3 * 3);
    expect(t.colors.length).toBe(12 * 3 * 4);
    const tones = new Set<number>();
    for (let i = 0; i < t.colors.length; i += 4) tones.add(Math.round((t.colors[i] as number) / 0.5 * 100) / 100);
    expect([...tones].sort()).toEqual([FACE_SHADE.bottom, FACE_SHADE.x, FACE_SHADE.y, FACE_SHADE.top].sort());
  });

  it('ear clipping triangulates a concave outline into n-2 triangles, whichever way it winds', () => {
    const concave = [[0, 0], [10, 0], [10, 10], [5, 3], [0, 10]] as const;
    expect(triangulate(concave).length).toBe(3 * 3);
    expect(triangulate([...concave].reverse()).length).toBe(3 * 3);
    expect(triangulate([[0, 0], [1, 1]])).toEqual([]);
  });

  it('a prism has a quad per edge and two caps; rings are closed line loops; bounds cover everything', () => {
    const prism = solidTriangles(SCENE.solids[1] as never);
    const edges = 5;
    expect(prism.positions.length / 9).toBe(edges * 2 + (edges - 2) * 2);
    const ring = ringSegments(SCENE.rings[0] as never, 8);
    expect(ring.length).toBe(16);
    expect(ring[15]).toEqual(ring[0]);
    expect(sceneBounds(SCENE)).toEqual({ min: [0, 0, -19], max: [300, 200, 12] });
    expect(sceneBounds({ solids: [], rings: [] })).toBeNull();
    expect(unionBox(null, { min: [0, 0, 0], max: [1, 1, 1] }, { min: [-5, 0, 0], max: [0, 2, 0] })).toEqual({ min: [-5, 0, 0], max: [1, 2, 1] });
    expect(offsetBox({ min: [0, 0, 0], max: [1, 1, 1] }, [10, -20, 5])).toEqual({ min: [10, -20, 5], max: [11, -19, 6] });
  });
});

describe('the renderer with a scene', () => {
  it('uploads the solids once, draws them as triangles before the path, and frees them on dispose', async () => {
    const { gl, calls, live } = fakeGl();
    const frames = frameQueue();
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request });
    await r.load(listOf([[[SEGMENT.FEED, 1, 0, 0]]]), instant);
    frames.flush();
    const before = calls.get('drawArrays') ?? 0;
    r.setScene(SCENE);
    expect(r.solidCount).toBe(2);
    expect(frames.flush()).toBe(1);
    // Two solids, the ring overlay and the path chunk: four draws in this frame.
    expect((calls.get('drawArrays') ?? 0) - before).toBe(4);
    r.setScene(null);
    expect(r.solidCount).toBe(0);
    r.dispose();
    expect(live()).toBe(0);
  });

  it('the path offset moves the path by a uniform (no re-upload) and refits the view around the moved path and the scene', async () => {
    const { gl, uploads } = fakeGl();
    const frames = frameQueue();
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request });
    await r.load(listOf([[[SEGMENT.FEED, 10, 0, 0]]]), instant);
    const n = uploads.length;
    r.setPathOffset([100, 200, -30]);
    expect(uploads.length).toBe(n);
    expect(frames.flush()).toBe(1);
    r.setPathOffset([100, 200, -30]);
    expect(frames.flush()).toBe(0);
  });

  it('the named views turn the camera: top looks straight down with X right and Y up, iso is the default', () => {
    const box = { min: [0, 0, 0], max: [100, 50, 10] } as const;
    const top = fitOrbit(box, undefined, 1.5, 0.8, VIEW_ANGLES.top);
    const m = viewProjection(top, 1.5);
    const px = project(m, [100, 25, 5]);
    const py = project(m, [50, 50, 5]);
    const centre = project(m, [50, 25, 5]);
    expect(px[0]).toBeGreaterThan(centre[0]);
    expect(py[1]).toBeGreaterThan(centre[1]);
    expect(Math.abs(px[1] - centre[1])).toBeLessThan(0.01);
    expect(fitOrbit(box).azimuth).toBe(VIEW_ANGLES.iso.azimuth);
    const { gl } = fakeGl();
    const frames = frameQueue();
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request });
    r.setView('top');
    expect(frames.flush()).toBe(1);
  });
});

describe('the top-view fallback with a scene', () => {
  it('solids become top-face outlines with their tags, rings become circles, and the view box covers the moved path and the scene', () => {
    const s = svgScene(SCENE);
    expect(s.solids.map((x) => x.tag)).toEqual(['bed', 'fixture']);
    expect(s.solids[0]?.d).toBe('M0 0L300 0L300 -200L0 -200Z');
    expect(s.solids[1]?.d.startsWith('M10 -10L110 -10')).toBe(true);
    expect(s.rings).toEqual([{ cx: 20, cy: -20, r: 3 }]);
    expect(svgScene(null)).toEqual({ solids: [], rings: [], bounds: null });
    const list = listOf([[[SEGMENT.FEED, 10, 10, 0]]]);
    const p = svgPaths(list, { offset: [1000, 0, 0], extent: s.bounds });
    const parts = (p.viewBox ?? '').split(' ').map(Number);
    expect(parts[0]).toBeLessThanOrEqual(0);
    expect((parts[0] as number) + (parts[2] as number)).toBeGreaterThanOrEqual(1010);
    // The path data itself stays in the path's frame: the caller translates the group.
    expect(p.feed).toBe('M0 0L10 -10');
    const g = svgGrid(list, { offset: [1000, 0, 0], extent: s.bounds });
    expect(g.major).toMatch(/M/);
  });
});
