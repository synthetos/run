import { type RendererContext } from './context.ts';
import { type GpuChunk } from './contract.ts';

export function upload(ctx: RendererContext, positions: Float32Array, styles: Uint8Array, lines: Float32Array): GpuChunk {
  const vao = ctx.gl.createVertexArray();
  ctx.gl.bindVertexArray(vao);
  const make = (data: ArrayBufferView, index: number, size: number, type: number): WebGLBuffer => {
    const b = ctx.gl.createBuffer();
    ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, b);
    ctx.gl.bufferData(ctx.gl.ARRAY_BUFFER, data, ctx.gl.STATIC_DRAW);
    ctx.gl.enableVertexAttribArray(index);
    ctx.gl.vertexAttribPointer(index, size, type, false, 0, 0);
    return b;
  };
  const buffers = [make(positions, 0, 3, ctx.gl.FLOAT), make(styles, 1, 1, ctx.gl.UNSIGNED_BYTE), make(lines, 2, 1, ctx.gl.FLOAT), make(ctx.dashDistances(positions, styles), 3, 1, ctx.gl.FLOAT)];
  ctx.gl.bindVertexArray(null);
  return { vao, buffers, vertexCount: positions.length / 3 };
}

export function uploadSolid(ctx: RendererContext, positions: Float32Array, vertexColors: Float32Array): GpuChunk {
  const vao = ctx.gl.createVertexArray();
  ctx.gl.bindVertexArray(vao);
  const make = (data: ArrayBufferView, index: number, size: number): WebGLBuffer => {
    const b = ctx.gl.createBuffer();
    ctx.gl.bindBuffer(ctx.gl.ARRAY_BUFFER, b);
    ctx.gl.bufferData(ctx.gl.ARRAY_BUFFER, data, ctx.gl.STATIC_DRAW);
    ctx.gl.enableVertexAttribArray(index);
    ctx.gl.vertexAttribPointer(index, size, ctx.gl.FLOAT, false, 0, 0);
    return b;
  };
  const buffers = [make(positions, 0, 3), make(vertexColors, 1, 4)];
  ctx.gl.bindVertexArray(null);
  return { vao, buffers, vertexCount: positions.length / 3 };
}

/**
   * Per vertex: distance along its segment (0 at the start, the length at the end), for the dashes: traverses
   * always, and any move while it waits for its acknowledgement in a running job's planner view.
   */
export function dashDistances(ctx: RendererContext, positions: Float32Array, styles: Uint8Array): Float32Array {
  const out = new Float32Array(styles.length);
  for (let v = 0; v + 1 < styles.length; v += 2) {
    const i = v * 3;
    out[v + 1] = Math.hypot((positions[i + 3] as number) - (positions[i] as number), (positions[i + 4] as number) - (positions[i + 1] as number), (positions[i + 5] as number) - (positions[i + 2] as number));
  }
  return out;
}

export function release(ctx: RendererContext, c: GpuChunk): void {
  ctx.gl.deleteVertexArray(c.vao);
  for (const b of c.buffers) ctx.gl.deleteBuffer(b);
}

export function linesChunk(ctx: RendererContext, pos: number[], sty: number[]): GpuChunk | null {
  return pos.length === 0 ? null : ctx.upload(new Float32Array(pos), new Uint8Array(sty), new Float32Array(sty.length).fill(-1));
}

export function clearPath(ctx: RendererContext): void {
  for (const c of ctx.path) ctx.release(c);
  ctx.path = [];
  ctx.list = null;
  ctx.bounds = null;
}
