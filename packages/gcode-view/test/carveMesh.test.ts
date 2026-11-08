/** The carved stock's WebGL layer (carve/mesh.ts) and its hook in the renderer, on a recording context. */
import { describe, expect, it } from 'vitest';
import { MESH_MAX, PATH_OVER_CARVE_ALPHA, SOFTWARE_MESH_MAX, createCarveLayer, createHeightmap, createRenderer, defaultMeshMax, meshLayout, wallVertices, type CarveSurface, type GridSpec, type SceneLayers } from '../src/index.ts';
import { COLORS, fakeGl, frameQueue } from './helpers.ts';

const SPEC: GridSpec = { x0: 0, y0: 0, cell: 0.5, nx: 40, ny: 20, top: 0, bottom: -6, outline: null };
const surface = (spec: GridSpec = SPEC): CarveSurface => ({ session: 1, spec, z: createHeightmap(spec).z });
const MVP = new Float32Array(16);

describe('meshLayout', () => {
  it('puts a vertex at each cell centre plus the edges', () => {
    expect(meshLayout({ nx: 40, ny: 20 })).toEqual({ mx: 42, my: 22, stride: 1 });
  });
  it('keeps a vertex per cell up to 2048 a side, and thins a larger grid', () => {
    expect(MESH_MAX).toBe(2048);
    expect(meshLayout({ nx: 2048, ny: 500 })).toEqual({ mx: 2050, my: 502, stride: 1 });
    expect(meshLayout({ nx: 4000, ny: 500 })).toEqual({ mx: 2 + 2000, my: 2 + 250, stride: 2 });
  });
  it('thins to the software renderer cap when asked, never below 256 a side', () => {
    expect(meshLayout({ nx: 720, ny: 480 }, SOFTWARE_MESH_MAX)).toEqual({ mx: 2 + 360, my: 2 + 240, stride: 2 });
    expect(meshLayout({ nx: 4096, ny: 10 }, 16)).toMatchObject({ stride: 16 });
  });
});

describe('wallVertices', () => {
  it('runs walls around the rectangle, a piece per cell, six vertices of four numbers each', () => {
    const v = wallVertices(SPEC);
    // Perimeter 2 · (20 + 10) mm = 60 mm at 0.5 mm: 120 pieces.
    expect(v.length).toBe(120 * 6 * 4);
    // A bottom and a top vertex: the third number says which.
    expect([v[2], v[10]]).toEqual([0, 1]);
  });
  it('follows an outline', () => {
    const v = wallVertices({ ...SPEC, outline: [[0, 0], [10, 0], [0, 10]] });
    expect(v.length).toBe((20 + 20 + Math.ceil(Math.hypot(10, 10) / 0.5)) * 24);
  });
});

describe('createCarveLayer', () => {
  it('uploads the surface whole, then each changed rectangle before the next frame', () => {
    const { gl, calls } = fakeGl();
    const layer = createCarveLayer(gl);
    expect(layer.active).toBe(false);
    layer.draw(MVP, [0, 0, 0]);
    expect(calls.get('drawArrays') ?? 0).toBe(0);
    layer.set(surface());
    expect(layer.active).toBe(true);
    expect(calls.get('texStorage2D')).toBe(1);
    layer.draw(MVP, [0, 0, 0]);
    expect(calls.get('texSubImage2D')).toBe(1);
    // The top, a strip per row; the walls.
    expect(calls.get('drawArraysInstanced')).toBe(1);
    expect(calls.get('drawArrays')).toBe(1);
    // The top is pulled toward the eye, so a cut to the bottom shows over the fixture's top face.
    expect(calls.get('polygonOffset')).toBe(1);
    layer.update({ x: 1, y: 1, w: 2, h: 2 });
    layer.update({ x: 5, y: 1, w: 2, h: 2 });
    layer.draw(MVP, [0, 0, 0]);
    expect(calls.get('texSubImage2D')).toBe(3);
    // Many rectangles in one frame go up as one.
    for (let i = 0; i < 40; i++) layer.update({ x: i % 30, y: 0, w: 1, h: 1 });
    layer.draw(MVP, [0, 0, 0]);
    expect(calls.get('texSubImage2D')).toBe(4);
    layer.set(null);
    expect(layer.active).toBe(false);
    expect(calls.get('deleteTexture')).toBe(1);
    layer.dispose();
  });
});

describe('the renderer with a carved surface', () => {
  const scene: SceneLayers = {
    solids: [
      { kind: 'box', min: [0, 0, -20], max: [100, 100, -6], color: [0.5, 0.5, 0.5, 1], tag: 'bed' },
      { kind: 'box', min: [0, 0, -6], max: [20, 10, 0], color: [0.8, 0.6, 0.4, 1], tag: 'stock' },
    ],
    rings: [],
  };

  it('draws the carved surface in place of the flat stock', () => {
    const { gl, calls } = fakeGl();
    const frames = frameQueue();
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request });
    r.setScene(scene);
    frames.flush();
    const flat = calls.get('drawArrays') ?? 0;
    expect(flat).toBe(2);
    r.setCarve(surface());
    frames.flush();
    // Bed, then the carved top (instanced strips) and its walls; the stock solid is skipped.
    expect((calls.get('drawArrays') ?? 0) - flat).toBe(2);
    expect(calls.get('drawArraysInstanced')).toBe(1);
    r.updateCarve({ x: 0, y: 0, w: 1, h: 1 });
    expect(frames.pending).toBe(1);
    frames.flush();
    r.setCarve(null);
    frames.flush();
    r.dispose();
  });
});

describe('defaultMeshMax', () => {
  const named = (name: string | null, info = true): WebGL2RenderingContext => ({
    RENDERER: 0x1f01,
    getExtension: () => (info ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null),
    getParameter: (p: number) => (p === 0x9246 || p === 0x1f01 ? name : null),
  }) as unknown as WebGL2RenderingContext;
  it('caps the mesh on a software renderer only', () => {
    expect(defaultMeshMax(named('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)'))).toBe(SOFTWARE_MESH_MAX);
    expect(defaultMeshMax(named('llvmpipe (LLVM 15.0.7, 256 bits)', false))).toBe(SOFTWARE_MESH_MAX);
    expect(defaultMeshMax(named('ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'))).toBe(MESH_MAX);
    expect(defaultMeshMax(named(null))).toBe(MESH_MAX);
  });
});

describe('the path over a carved stock', () => {
  it('is drawn faint and blended while a carved surface is drawn', () => {
    const { gl, calls } = fakeGl();
    const frames = frameQueue();
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frames.request, carveMeshMax: 512 });
    r.setCarve(surface());
    frames.flush();
    expect(PATH_OVER_CARVE_ALPHA).toBeCloseTo(0.35, 5);
    expect(calls.get('blendFuncSeparate')).toBe(1);
    r.setCarve(null);
    frames.flush();
    expect(calls.get('blendFuncSeparate')).toBe(1);
    r.dispose();
  });
});

