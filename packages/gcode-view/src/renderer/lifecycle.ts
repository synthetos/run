import { type RendererContext } from './context.ts';
import { type PreviewRenderer } from './contract.ts';

export function lifecycleApi(ctx: RendererContext): Pick<PreviewRenderer, "dispose"> {
  return {
    dispose() {
      ctx.disposed = true;
      ctx.generation++;
      if (ctx.spinTimer !== null) clearTimeout(ctx.spinTimer);
      ctx.spinTimer = null;
      ctx.clearPath();
      for (const s of ctx.solids) ctx.release(s);
      ctx.solids = [];
      if (ctx.gridChunk !== null) ctx.release(ctx.gridChunk);
      if (ctx.frameOverlay !== null) ctx.release(ctx.frameOverlay);
      if (ctx.markerOverlay !== null) ctx.release(ctx.markerOverlay);
      if (ctx.playOverlay !== null) ctx.release(ctx.playOverlay);
      ctx.gridChunk = ctx.frameOverlay = ctx.markerOverlay = ctx.playOverlay = null;
      ctx.gl.deleteProgram(ctx.program);
      ctx.gl.deleteProgram(ctx.solidProgram);
      ctx.carve.dispose();
      ctx.lineTools.dispose();
    }
  };
}
