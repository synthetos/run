import { VIEW_ANGLES, fitOrbit, pan, rotate, zoom, zoomToward, type Orbit } from '../camera.ts';
import { framedBox } from '../framing.ts';
import { pickSolid, rayThrough } from '../pick.ts';
import { offsetBox, unionBox } from '../scene.ts';
import { type Box3 } from '../segments.ts';
import { type RendererContext } from './context.ts';
import { type PreviewRenderer } from './contract.ts';

/** Dash period of traverses, in drawing units: about 1/120 of the framed extent (0, solid, with nothing framed). */
export function dashPeriod(ctx: RendererContext): number {
  const box = ctx.fitBox();
  if (box === null) return 0;
  const span = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  return Number.isFinite(span) && span > 0 ? span / 120 : 0;
}

/** The job (the path with the stock, fixture and clamps; framing.ts) framed to fill about 80% of the canvas. */
export function fitView(ctx: RendererContext): Orbit {
  return fitOrbit(framedBox(offsetBox(ctx.bounds, ctx.pathOffset), ctx.scene, ctx.fitBox()), undefined, ctx.width / ctx.height, 0.8, ctx.angles);
}

/** The box of everything drawn: the path moved by its offset, the envelope and the scene. */
export function fitBox(ctx: RendererContext): Box3 | null {
  return unionBox(offsetBox(ctx.bounds, ctx.pathOffset), ctx.envelope, ctx.sceneBox);
}

export function cameraApi(ctx: RendererContext): Pick<PreviewRenderer, "setView" | "resize" | "fit" | "orbit" | "zoomBy" | "zoomAt" | "panBy" | "pick"> {
  return {
    setView(preset) {
      ctx.angles = VIEW_ANGLES[preset];
      ctx.autoFit = true;
      ctx.view = ctx.fitView();
      ctx.requestRender();
    },
    resize(w, h, pixelRatio = 1) {
      ctx.width = Math.max(1, w);
      ctx.height = Math.max(1, h);
      const canvas = ctx.gl.canvas;
      canvas.width = Math.round(ctx.width * pixelRatio);
      canvas.height = Math.round(ctx.height * pixelRatio);
      if (ctx.autoFit) ctx.view = ctx.fitView();
      ctx.requestRender();
    },
    fit() {
      ctx.autoFit = true;
      ctx.view = ctx.fitView();
      ctx.requestRender();
    },
    orbit(dA, dE) {
      ctx.autoFit = false;
      ctx.view = rotate(ctx.view, dA, dE);
      ctx.requestRender();
    },
    zoomBy(factor) {
      ctx.autoFit = false;
      ctx.view = zoom(ctx.view, factor);
      ctx.requestRender();
    },
    zoomAt(factor, x, y) {
      ctx.autoFit = false;
      ctx.view = zoomToward(ctx.view, factor, (2 * x) / ctx.width - 1, 1 - (2 * y) / ctx.height, ctx.width / ctx.height);
      ctx.requestRender();
    },
    panBy(dx, dy) {
      ctx.autoFit = false;
      ctx.view = pan(ctx.view, dx, dy);
      ctx.requestRender();
    },
    pick(x, y) {
      if (ctx.scene === null) return null;
      const ray = rayThrough(ctx.view, ctx.width / ctx.height, (2 * x) / ctx.width - 1, 1 - (2 * y) / ctx.height);
      return pickSolid(ray, ctx.scene.solids)?.tag ?? null;
    }
  };
}
