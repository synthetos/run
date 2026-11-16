import type { Mat4 } from '../camera.ts';
import { type Rgba } from '../scene.ts';
import { type RendererContext } from './context.ts';
import { type PreviewRenderer } from './contract.ts';

/** `a` mixed a fraction `t` of the way to `b`, opaque. */
export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1];
}

export function colorTable(ctx: RendererContext): Float32Array {
  const ring = ctx.colors.envelope;
  const exec = ctx.plannerColors().exec;
  const table = [ctx.colors.rapid, ctx.colors.feed, ctx.colors.arc, ctx.colors.outOfBounds, ctx.colors.uncertain, ctx.colors.envelope, ctx.colors.axisX, ctx.colors.axisY, ctx.colors.axisZ, ctx.colors.grid, ctx.colors.gridMajor, exec, ring, mix(exec, ctx.colors.background, 0.55), ctx.colors.highlight];
  return new Float32Array(table.flat());
}

/** The planner view's colours: the executing line, and the band in the planner while it starves. */
export function plannerColors(ctx: RendererContext): { readonly exec: Rgba; readonly queued: Rgba } {
  const exec = ctx.colors.plannerExec ?? ctx.colors.highlight;
  const queued = ctx.colors.plannerStarving ?? ctx.colors.highlight;
  return { exec, queued };
}

export function bindPathMaterials(ctx: RendererContext, { mvp }: BindPathMaterialsInput): void {

  ctx.gl.useProgram(ctx.program);
  ctx.gl.uniformMatrix4fv(ctx.u.mvp, false, mvp);
  ctx.gl.uniform1f(ctx.u.showRapids, ctx.showRapids ? 1 : 0);
  ctx.gl.uniform1f(ctx.u.highlightEnd, ctx.highlightLine + 1);
  ctx.gl.uniform4fv(ctx.u.colors, ctx.colorTable());
  ctx.gl.uniform4fv(ctx.u.highlight, new Float32Array(ctx.colors.highlight));
  ctx.gl.uniform1f(ctx.u.dash, ctx.dashPeriod());
  const pc = ctx.plannerColors();
  ctx.gl.uniform4fv(ctx.u.plan, new Float32Array(ctx.planner === null ? [0, 0, 0, 0] : [ctx.planner.cutEnd, ctx.planner.execEnd, ctx.planner.queuedEnd, 1]));
  ctx.gl.uniform4fv(ctx.u.plan2, new Float32Array(ctx.planner === null ? [0, 0, 0, 0] : [Math.max(ctx.planner.queuedEnd, ctx.planner.sentEnd ?? ctx.planner.queuedEnd), ctx.planner.starving ? 1 : 0, 0, 0]));
  ctx.gl.uniform2f(ctx.u.rot, 1, 0);
  ctx.gl.uniform4fv(ctx.u.exec, new Float32Array(pc.exec));
  ctx.gl.uniform4fv(ctx.u.queued, new Float32Array(pc.queued));
  ctx.gl.uniform1f(ctx.u.dimAlpha, 1);
  // Colour by tool reads its texture on unit 1 (the carved stock uses unit 0).
  ctx.lineTools.bind(1, ctx.u.lineTools, ctx.u.toolOn, ctx.u.toolColors);
  ctx.gl.uniform1f(ctx.u.focus, ctx.toolFocus);
  ctx.gl.uniform4fv(ctx.u.bg, new Float32Array(ctx.colors.background));
}

export function themeApi(ctx: RendererContext): Pick<PreviewRenderer, "setToolColors" | "setToolFocus" | "setColors" | "setPlanner" | "setToolSpin"> {
  return {
    setToolColors(next) {
      ctx.lineTools.set(next);
      ctx.requestRender();
    },
    setToolFocus(slot) {
      ctx.toolFocus = slot === null ? -1 : slot;
      ctx.requestRender();
    },
    setColors(next) {
      ctx.colors = next;
      ctx.carve.setBelowColor(next.outOfBounds);
      if (next.carveCut !== undefined) ctx.carve.setCutColor(next.carveCut);
      ctx.requestRender();
    },
    setPlanner(next) {
      ctx.planner = next;
      ctx.requestRender();
    },
    setToolSpin(direction) {
      if (direction === ctx.spin) return;
      ctx.spin = direction;
      ctx.spinSince = (0, ctx.now)();
      if (ctx.spinTimer !== null) clearTimeout(ctx.spinTimer);
      ctx.spinTimer = null;
      ctx.requestRender();
    }
  };
}

interface BindPathMaterialsInput { mvp: Mat4 }
