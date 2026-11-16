import type { Mat4 } from '../camera.ts';
import { viewProjection } from '../camera.ts';
import { PATH_OVER_CARVE_ALPHA } from './constants.ts';
import { type RendererContext } from './context.ts';
import { drawMarker } from './marker.ts';
import { bindPathMaterials } from './materials.ts';

export function draw(ctx: RendererContext): void {
  ctx.scheduled = false;
  if (ctx.disposed) return;
  ctx.frameCount++;
  ctx.gl.viewport(0, 0, ctx.gl.drawingBufferWidth, ctx.gl.drawingBufferHeight);
  const bg = ctx.colors.background;
  ctx.gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
  ctx.gl.clear(ctx.gl.COLOR_BUFFER_BIT | ctx.gl.DEPTH_BUFFER_BIT);
  const mvp = viewProjection(ctx.view, ctx.width / ctx.height);
  drawScene(ctx, { mvp });
  // 1b. The carved stock, in the path's frame, in place of the flat stock.
  ctx.carve.draw(mvp, ctx.pathOffset);
  bindPathMaterials(ctx, { mvp });
  // 2. The grid, in the drawing's frame, hidden where a solid stands on it.
  ctx.gl.uniform3f(ctx.u.offset, 0, 0, 0);
  if (ctx.gridChunk !== null) {
    ctx.gl.enable(ctx.gl.DEPTH_TEST);
    ctx.gl.bindVertexArray(ctx.gridChunk.vao);
    ctx.gl.drawArrays(ctx.gl.LINES, 0, ctx.gridChunk.vertexCount);
  }
  // 3. The path and the marker (the path's frame) and the frame overlay, always on top: a cut inside
  //    the stock must stay visible, so lines are never hidden by a solid.
  ctx.gl.disable(ctx.gl.DEPTH_TEST);
  if (ctx.frameOverlay !== null) {
    ctx.gl.bindVertexArray(ctx.frameOverlay.vao);
    ctx.gl.drawArrays(ctx.gl.LINES, 0, ctx.frameOverlay.vertexCount);
  }
  drawPath(ctx);
  drawMarker(ctx);
  if (ctx.playOverlay !== null && ctx.playAt !== null) {
    ctx.gl.uniform3f(ctx.u.offset, ctx.pathOffset[0] + ctx.playAt[0], ctx.pathOffset[1] + ctx.playAt[1], ctx.pathOffset[2] + ctx.playAt[2]);
    ctx.gl.bindVertexArray(ctx.playOverlay.vao);
    ctx.gl.drawArrays(ctx.gl.LINES, 0, ctx.playOverlay.vertexCount);
  }
  ctx.gl.bindVertexArray(null);
}

export function drawScene(ctx: RendererContext, { mvp }: DrawSceneInput): void {

  // 1. The scene solids, depth-tested among themselves.
  if (ctx.solids.length > 0) {
    ctx.gl.enable(ctx.gl.DEPTH_TEST);
    ctx.gl.useProgram(ctx.solidProgram);
    ctx.gl.uniformMatrix4fv(ctx.su.mvp, false, mvp);
    ctx.solids.forEach((s, i) => {
      if (i === ctx.stockSolid && ctx.carve.active) return;
      ctx.gl.bindVertexArray(s.vao);
      ctx.gl.drawArrays(ctx.gl.TRIANGLES, 0, s.vertexCount);
    });
  }
}

export function drawPath(ctx: RendererContext): void {

  ctx.gl.uniform3f(ctx.u.offset, ctx.pathOffset[0], ctx.pathOffset[1], ctx.pathOffset[2]);
  const dim = ctx.carve.footprint;
  if (dim !== null) {
    ctx.gl.uniform4f(ctx.u.dimRect, dim[0], dim[1], dim[2], dim[3]);
    ctx.gl.uniform1f(ctx.u.dimAlpha, PATH_OVER_CARVE_ALPHA);
    ctx.gl.enable(ctx.gl.BLEND);
    // Blend the colour only; the canvas stays opaque.
    ctx.gl.blendFuncSeparate(ctx.gl.SRC_ALPHA, ctx.gl.ONE_MINUS_SRC_ALPHA, ctx.gl.ZERO, ctx.gl.ONE);
  }
  for (const c of ctx.path) {
    ctx.gl.bindVertexArray(c.vao);
    ctx.gl.drawArrays(ctx.gl.LINES, 0, c.vertexCount);
  }
  ctx.gl.disable(ctx.gl.BLEND);
  ctx.gl.uniform1f(ctx.u.dimAlpha, 1);
}

export function requestRender(ctx: RendererContext): void {
  if (ctx.scheduled || ctx.disposed) return;
  ctx.scheduled = true;
  (0, ctx.requestFrame)(ctx.draw);
}

interface DrawSceneInput { mvp: Mat4 }
