import { gridLayout, gridLines } from '../grid.ts';
import { offsetBox, ringSegments, sceneBounds, solidTriangles, unionBox } from '../scene.ts';
import { lineCount, type Vec3 } from '../segments.ts';
import { OVERLAY } from './constants.ts';
import { type RendererContext } from './context.ts';
import { type PreviewRenderer } from './contract.ts';

export function rebuildOverlay(ctx: RendererContext): void {
  if (ctx.gridChunk !== null) ctx.release(ctx.gridChunk);
  if (ctx.frameOverlay !== null) ctx.release(ctx.frameOverlay);
  ctx.gridChunk = ctx.frameOverlay = null;
  const pos: number[] = [];
  const sty: number[] = [];
  const seg = (a: Vec3, b: Vec3, s: number): void => {
    pos.push(...a, ...b);
    sty.push(s, s);
  };
  const grid = ctx.showGrid ? gridLayout(unionBox(offsetBox(ctx.bounds, ctx.pathOffset), ctx.sceneBox), ctx.envelope) : null;
  if (grid !== null) {
    for (const l of gridLines(grid)) seg([l.a[0], l.a[1], grid.z], [l.b[0], l.b[1], grid.z], l.major ? OVERLAY.GRID_MAJOR : OVERLAY.GRID);
    ctx.gridChunk = ctx.linesChunk(pos, sty);
    pos.length = 0;
    sty.length = 0;
  }
  if (ctx.envelope !== null) {
    const [x0, y0, z0] = ctx.envelope.min;
    const [x1, y1, z1] = ctx.envelope.max;
    const c: Vec3[] = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
    for (const [a, b] of edges) seg(c[a] as Vec3, c[b] as Vec3, OVERLAY.ENVELOPE);
  }
  if (ctx.scene !== null) {
    for (const ring of ctx.scene.rings) {
      const pts = ringSegments(ring);
      for (let i = 0; i + 1 < pts.length; i += 2) seg(pts[i] as Vec3, pts[i + 1] as Vec3, OVERLAY.RING);
    }
  }
  if (ctx.wcs !== null) {
    const [x, y, z] = ctx.wcs.origin;
    const s = ctx.wcs.size;
    seg([x, y, z], [x + s, y, z], OVERLAY.AXIS_X);
    seg([x, y, z], [x, y + s, z], OVERLAY.AXIS_Y);
    seg([x, y, z], [x, y, z + s], OVERLAY.AXIS_Z);
  }
  ctx.frameOverlay = ctx.linesChunk(pos, sty);
  // The generic glyph is sized to the drawing, so it follows the drawn extent; a true-size tool does not.
  if (ctx.toolShape === null) ctx.rebuildMarker();
}

export function rebuildSolids(ctx: RendererContext): void {
  for (const s of ctx.solids) ctx.release(s);
  ctx.solids = [];
  ctx.stockSolid = -1;
  if (ctx.scene === null) return;
  for (const solid of ctx.scene.solids) {
    const t = solidTriangles(solid);
    if (t.positions.length === 0) continue;
    if (solid.tag === 'stock') {
      ctx.stockSolid = ctx.solids.length;
      ctx.carve.setColor(solid.color);
    }
    ctx.solids.push(ctx.uploadSolid(t.positions, t.colors));
  }
}

export function visibilityApi(ctx: RendererContext): Pick<PreviewRenderer, "setRapidsVisible" | "setHighlight" | "setGridVisible" | "setEnvelope" | "setWcsOrigin"> {
  return {
    setRapidsVisible(visible) {
      ctx.showRapids = visible;
      ctx.requestRender();
    },
    setHighlight(line) {
      ctx.highlightLine = ctx.list === null ? -1 : Math.min(Math.max(-1, Math.floor(line)), lineCount(ctx.list) - 1);
      ctx.requestRender();
    },
    setGridVisible(visible) {
      if (ctx.showGrid === visible) return;
      ctx.showGrid = visible;
      ctx.rebuildOverlay();
      ctx.requestRender();
    },
    setEnvelope(next) {
      ctx.envelope = next;
      if (ctx.autoFit) ctx.view = ctx.fitView();
      ctx.rebuildOverlay();
      ctx.requestRender();
    },
    setWcsOrigin(origin, size) {
      const box = ctx.fitBox();
      const auto = box === null ? 10 : Math.max(1, Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]) / 8);
      ctx.wcs = origin === null ? null : { origin, size: size ?? auto };
      ctx.rebuildOverlay();
      ctx.requestRender();
    }
  };
}

export function sceneApi(ctx: RendererContext): Pick<PreviewRenderer, "setScene" | "setPathOffset" | "setCarve" | "updateCarve"> {
  return {
    setScene(next) {
      ctx.scene = next;
      ctx.sceneBox = sceneBounds(next);
      ctx.rebuildSolids();
      if (ctx.autoFit) ctx.view = ctx.fitView();
      ctx.rebuildOverlay();
      ctx.requestRender();
    },
    setPathOffset(offset) {
      if (offset[0] === ctx.pathOffset[0] && offset[1] === ctx.pathOffset[1] && offset[2] === ctx.pathOffset[2]) return;
      ctx.pathOffset = offset;
      if (ctx.autoFit) ctx.view = ctx.fitView();
      ctx.rebuildOverlay();
      ctx.requestRender();
    },
    setCarve(surface) {
      ctx.carve.set(surface);
      ctx.requestRender();
    },
    updateCarve(rect) {
      ctx.carve.update(rect);
      ctx.requestRender();
    }
  };
}
