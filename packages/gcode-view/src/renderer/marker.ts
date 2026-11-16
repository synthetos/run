import { nextMotion, positionAt, settled } from '../markerMotion.ts';
import { fluteHelix, spinAngle } from '../markerSpin.ts';
import { toolWireframe } from '../toolProfile.ts';
import { NO_OFFSET, OVERLAY } from './constants.ts';
import { type RendererContext } from './context.ts';
import { type GpuChunk, type PreviewRenderer } from './contract.ts';
import { glyphBit, sameShape, toolGlyph } from './glyph.ts';

/** A marker's geometry in one style, tip at the origin: the tool's wireframe at true size, or the generic glyph. */
export function markerChunk(ctx: RendererContext, style: number): GpuChunk | null {
  const lines = ctx.toolShape === null ? toolGlyph(NO_OFFSET, ctx.fitBox()) : toolWireframe(ctx.toolShape);
  // The live marker gets a flute helix, so the bit is seen to turn while the spindle runs.
  if (style === OVERLAY.MARKER) {
    const bit = ctx.toolShape === null ? glyphBit(ctx.fitBox()) : { radius: ctx.toolShape.diameter / 2, length: ctx.toolShape.fluteLength };
    lines.push(...fluteHelix(bit.radius, bit.length));
  }
  const pos: number[] = [];
  const sty: number[] = [];
  for (const [a, b] of lines) {
    pos.push(...a, ...b);
    sty.push(style, style);
  }
  return ctx.linesChunk(pos, sty);
}

export function rebuildMarker(ctx: RendererContext): void {
  if (ctx.markerOverlay !== null) ctx.release(ctx.markerOverlay);
  ctx.markerOverlay = ctx.marker === null ? null : ctx.markerChunk(ctx.markerPreview ? OVERLAY.MARKER_PREVIEW : OVERLAY.MARKER);
  if (ctx.playOverlay !== null) ctx.release(ctx.playOverlay);
  ctx.playOverlay = ctx.playAt === null ? null : ctx.markerChunk(OVERLAY.PLAY);
}

export function drawMarker(ctx: RendererContext): void {

  if (ctx.markerOverlay !== null && ctx.motion !== null) {
    const t = (0, ctx.now)();
    const at = positionAt(ctx.motion, t);
    ctx.gl.uniform3f(ctx.u.offset, ctx.pathOffset[0] + at[0], ctx.pathOffset[1] + at[1], ctx.pathOffset[2] + at[2]);
    const turning = ctx.canSpin && ctx.spin !== 0 && !ctx.markerPreview && !(0, ctx.reducedMotion)();
    const a = turning ? spinAngle(ctx.spin, ctx.spinSince, t, ctx.spinFrameMs) : 0;
    ctx.gl.uniform2f(ctx.u.rot, Math.cos(a), Math.sin(a));
    ctx.gl.bindVertexArray(ctx.markerOverlay.vao);
    ctx.gl.drawArrays(ctx.gl.LINES, 0, ctx.markerOverlay.vertexCount);
    ctx.gl.uniform2f(ctx.u.rot, 1, 0);
    // Frames only while the marker is still on its way to the latest report; then it rests.
    if (!settled(ctx.motion, t)) ctx.requestRender();
    // A turning bit: the next step on a timer, a few times a second, not every frame.
    else if (turning && ctx.spinTimer === null) ctx.spinTimer = setTimeout(() => { ctx.spinTimer = null; ctx.requestRender(); }, ctx.spinFrameMs);
  }
}

export function markerApi(ctx: RendererContext): Pick<PreviewRenderer, "setToolMarker" | "setPlayMarker" | "setToolShape"> {
  return {
    setToolMarker(position, preview = false) {
      // The glyph is rebuilt only when the marker appears, goes or changes kind; a new position is a new motion target.
      const rebuild = (ctx.marker === null) !== (position === null) || preview !== ctx.markerPreview;
      ctx.marker = position;
      ctx.markerPreview = preview;
      ctx.motion = nextMotion(ctx.motion, position, (0, ctx.now)(), preview || (0, ctx.reducedMotion)());
      if (rebuild) ctx.rebuildMarker();
      ctx.requestRender();
    },
    setPlayMarker(position) {
      const rebuild = (ctx.playAt === null) !== (position === null);
      ctx.playAt = position;
      if (rebuild) ctx.rebuildMarker();
      ctx.requestRender();
    },
    setToolShape(shape) {
      if (sameShape(shape, ctx.toolShape)) return;
      ctx.toolShape = shape;
      ctx.rebuildMarker();
      ctx.requestRender();
    }
  };
}
