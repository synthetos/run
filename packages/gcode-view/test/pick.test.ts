import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { attachPicking, createRenderer, fitOrbit, pickSolid, project, rayThrough, viewProjection, VIEW_ANGLES, type SceneSolid } from '../src/index.ts';
import { COLORS, fakeGl, frameQueue } from './helpers.ts';

const GREY = [0.5, 0.5, 0.5, 1] as const;
const bed: SceneSolid = { kind: 'box', min: [0, 0, -19], max: [800, 600, 0], color: GREY, tag: 'bed' };
const fixture: SceneSolid = { kind: 'prism', outline: [[100, 100], [400, 100], [400, 300], [100, 300]], z0: 0, z1: 12, color: GREY, tag: 'fixture' };
const stock: SceneSolid = { kind: 'box', min: [150, 150, 12], max: [300, 250, 18], color: GREY, tag: 'stock' };
const scene = [bed, fixture, stock];
const BOX = { min: [0, 0, -19], max: [800, 600, 18] } as const;

describe('picking scene solids', () => {
  it('the ray through a projected point passes through that point (property)', () => {
    const c = fc.double({ min: -0.9, max: 0.9, noNaN: true });
    fc.assert(fc.property(c, c, fc.double({ min: 0.5, max: 2.5, noNaN: true }), (nx, ny, aspect) => {
      const o = fitOrbit(BOX, undefined, aspect);
      const ray = rayThrough(o, aspect, nx, ny);
      const p = project(viewProjection(o, aspect), [ray.origin[0] + ray.dir[0] * 500, ray.origin[1] + ray.dir[1] * 500, ray.origin[2] + ray.dir[2] * 500]);
      expect(p[0]).toBeCloseTo(nx, 4);
      expect(p[1]).toBeCloseTo(ny, 4);
    }));
  });

  it('from above, the nearest solid wins: stock over fixture over bed', () => {
    const o = { ...fitOrbit(BOX, undefined, 1, 0.8, VIEW_ANGLES.top) };
    const down = (x: number, y: number) => ({ origin: [x, y, 1000] as const, dir: [0, 0, -1] as const });
    expect(pickSolid(down(200, 200), scene)).toEqual({ tag: 'stock', distance: 982 });
    expect(pickSolid(down(120, 120), scene)).toEqual({ tag: 'fixture', distance: 988 });
    expect(pickSolid(down(700, 500), scene)).toEqual({ tag: 'bed', distance: 1000 });
    expect(pickSolid(down(900, 500), scene)).toBeNull();
    // The centre of the top view looks at the box's centre: the bed there.
    expect(pickSolid(rayThrough(o, 1, 0, 0), scene)?.tag).toBe('bed');
  });

  it('a prism is hit on its side walls and only inside a concave outline', () => {
    const ell: SceneSolid = { kind: 'prism', outline: [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]], z0: 0, z1: 10, color: GREY, tag: 'fixture' };
    // From the front (−Y), level with its middle: the front wall at Y 0.
    expect(pickSolid({ origin: [20, -50, 5], dir: [0, 1, 0] }, [ell])).toEqual({ tag: 'fixture', distance: 50 });
    // Down through the notch of the L: a miss.
    expect(pickSolid({ origin: [70, 70, 50], dir: [0, 0, -1] }, [ell])).toBeNull();
    // Above the top, horizontally: a miss.
    expect(pickSolid({ origin: [20, -50, 15], dir: [0, 1, 0] }, [ell])).toBeNull();
  });

  it('untagged solids and solids behind the camera are never picked', () => {
    const plain: SceneSolid = { kind: 'box', min: [0, 0, 0], max: [10, 10, 10], color: GREY };
    expect(pickSolid({ origin: [5, 5, 50], dir: [0, 0, -1] }, [plain])).toBeNull();
    expect(pickSolid({ origin: [5, 5, 50], dir: [0, 0, 1] }, [{ ...plain, tag: 'stock' }])).toBeNull();
  });

  it('the renderer picks under a canvas point in its current view', () => {
    const { gl } = fakeGl();
    const r = createRenderer(gl, { colors: COLORS, requestFrame: frameQueue().request });
    r.resize(400, 300);
    expect(r.pick(200, 150)).toBeNull();
    r.setScene({ solids: scene, rings: [] });
    r.setView('top');
    // The top view, fitted: the canvas centre is the scene's centre (on the bed); the stock projects where it is.
    expect(r.pick(200, 150)).toBe('bed');
    const o = fitOrbit(BOX, undefined, 400 / 300, 0.8, VIEW_ANGLES.top);
    const p = project(viewProjection(o, 400 / 300), [225, 200, 18]);
    expect(r.pick(((p[0] + 1) / 2) * 400, ((1 - p[1]) / 2) * 300)).toBe('stock');
    expect(r.pick(0, 0)).toBeNull();
  });
});

describe('pointer picking', () => {
  /** A canvas stand-in: listeners by type, at the page's top-left. */
  function canvas(): { el: HTMLCanvasElement; fire: (type: string, e: Partial<PointerEvent>) => void } {
    const on = new Map<string, (e: PointerEvent) => void>();
    const el = { addEventListener: (t: string, f: (e: PointerEvent) => void) => on.set(t, f), removeEventListener: (t: string) => on.delete(t), getBoundingClientRect: () => ({ left: 10, top: 20 }) } as unknown as HTMLCanvasElement;
    return { el, fire: (type, e) => on.get(type)?.({ pointerId: 1, button: 0, buttons: 0, shiftKey: false, clientX: 0, clientY: 0, ...e } as PointerEvent) };
  }

  it('a press and release with under 4 px of travel is a click; an orbit drag is not, even one that comes back', () => {
    const { el, fire } = canvas();
    const picks: string[] = [];
    const at: Array<readonly [number, number]> = [];
    const detach = attachPicking(el, { pick: (x, y) => { at.push([x, y]); return 'stock'; } }, { onPick: (t) => picks.push(t), onHover: () => {} });
    fire('pointerdown', { clientX: 110, clientY: 120 });
    fire('pointermove', { clientX: 112, clientY: 121, buttons: 1 });
    fire('pointerup', { clientX: 112, clientY: 121 });
    expect(picks).toEqual(['stock']);
    expect(at).toEqual([[102, 101]]);
    fire('pointerdown', { clientX: 110, clientY: 120 });
    fire('pointermove', { clientX: 150, clientY: 120, buttons: 1 });
    fire('pointerup', { clientX: 110, clientY: 120 });
    // Shift (pan) and other buttons never click.
    fire('pointerdown', { clientX: 110, clientY: 120, shiftKey: true });
    fire('pointerup', { clientX: 110, clientY: 120 });
    fire('pointerdown', { clientX: 110, clientY: 120, button: 2 });
    fire('pointerup', { clientX: 110, clientY: 120 });
    expect(picks).toEqual(['stock']);
    detach();
    fire('pointerdown', { clientX: 110, clientY: 120 });
    fire('pointerup', { clientX: 110, clientY: 120 });
    expect(picks).toEqual(['stock']);
  });

  it('hovering names the solid under a resting pointer, and nothing once it leaves or presses', () => {
    const { el, fire } = canvas();
    const hovers: unknown[] = [];
    attachPicking(el, { pick: (x) => (x < 50 ? 'bed' : null) }, { onPick: () => {}, onHover: (h) => hovers.push(h) });
    fire('pointermove', { clientX: 30, clientY: 40 });
    fire('pointermove', { clientX: 90, clientY: 40 });
    fire('pointermove', { clientX: 30, clientY: 40, buttons: 1 });
    fire('pointerleave', {});
    expect(hovers).toEqual([{ tag: 'bed', x: 20, y: 20 }, null, null]);
  });
});
