import { rebuildOverlay, rebuildSolids } from './bed.ts';
import { dashPeriod, fitBox, fitView } from './camera.ts';
import { type RendererContext } from './context.ts';
import { draw, requestRender } from './draw.ts';
import { clearPath, dashDistances, linesChunk, release, upload, uploadSolid } from './geometry.ts';
import { markerChunk, rebuildMarker } from './marker.ts';
import { colorTable, plannerColors } from './materials.ts';

export function bindRenderer(ctx: RendererContext): void {
  ctx.upload = (positions, styles, lines) => upload(ctx, positions, styles, lines);
  ctx.uploadSolid = (positions, vertexColors) => uploadSolid(ctx, positions, vertexColors);
  ctx.dashDistances = (positions, styles) => dashDistances(ctx, positions, styles);
  ctx.release = (c) => release(ctx, c);
  ctx.linesChunk = (pos, sty) => linesChunk(ctx, pos, sty);
  ctx.rebuildOverlay = () => rebuildOverlay(ctx);
  ctx.markerChunk = (style) => markerChunk(ctx, style);
  ctx.rebuildMarker = () => rebuildMarker(ctx);
  ctx.rebuildSolids = () => rebuildSolids(ctx);
  ctx.colorTable = () => colorTable(ctx);
  ctx.plannerColors = () => plannerColors(ctx);
  ctx.draw = () => draw(ctx);
  ctx.dashPeriod = () => dashPeriod(ctx);
  ctx.requestRender = () => requestRender(ctx);
  ctx.clearPath = () => clearPath(ctx);
  ctx.fitView = () => fitView(ctx);
  ctx.fitBox = () => fitBox(ctx);
}
