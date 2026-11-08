/**
 * The carved stock in WebGL2 (docs/design/tool-sim.md, slice 2): the
 * heightmap as a float texture displacing a grid mesh, normals worked out in
 * the fragment shader, and side walls from the heightmap down to the stock's
 * bottom. The renderer calls it; it replaces the flat stock solid while a
 * surface is set.
 *
 * Texture: R32F, sampled only with texelFetch at NEAREST, so float
 * filtering (OES_texture_float_linear, often missing) is never needed and
 * nothing has to be packed. Changed rectangles are uploaded with
 * texSubImage2D just before the next frame.
 *
 * Mesh: a vertex per cell centre plus the stock's edges, drawn as one
 * triangle strip per row (instanced; positions from gl_VertexID and
 * gl_InstanceID, so no vertex or index buffer). On a real GPU that is one
 * vertex per cell up to `MESH_MAX` (2048) a side. A software renderer gets
 * `SOFTWARE_MESH_MAX` (512) a side, where a vertex per cell made each frame
 * take about 170 ms; a thinned mesh's vertex takes the lowest of the cells
 * it stands for, so a cut never disappears and a wall never zig-zags between
 * its top and its floor (the spikes a nearest-cell sample gave). Cells with
 * no stock (outside a round or imported outline) and cells cut through to
 * the bottom are not drawn, decided per texel, so the fixture or bed shows
 * through.
 *
 * Normals: each texel centre's slope from a Sobel kernel over its 3 × 3
 * neighbours (a wall stepped cell by cell around a curve gets one steady
 * direction instead of alternating X and Y faces), blended between the four
 * nearest texel centres per fragment, so a round trough or a curved wall
 * shades smoothly rather than in cell-sized facets.
 *
 * Cells cut below the stock's bottom (belowStock.ts) are drawn in the
 * warning colour at the bottom, pulled slightly toward the eye so they show
 * over the fixture's top face.
 *
 * Frames: the surface is in the path frame, drawn with the path's offset.
 * It does not carve.
 */
import type { Rgba } from '../scene.ts';
import type { Vec3 } from '../segments.ts';
import { link } from '../glProgram.ts';
import type { CarveSurface } from './client.ts';
import { unionRect, type CellRect, type GridSpec } from './heightmap.ts';
import { MESH_MAX, SOFTWARE_MESH_MAX, meshLayout, wallVertices } from './meshGeometry.ts';
import { TOP_FRAGMENT, TOP_VERTEX, WALL_FRAGMENT, WALL_VERTEX } from './shaders.ts';
import { BELOW_STOCK_EPS } from './belowStock.ts';

/** More pending rectangles than this are uploaded as one. */
const MAX_UPLOADS = 16;

export interface CarveLayer {
  /** The surface to draw (the renderer then hides the flat stock), or null for none. Uploads it whole. */
  set(surface: CarveSurface | null): void;
  /** A rectangle of the surface changed: uploaded before the next frame. */
  update(rect: CellRect): void;
  setColor(color: Rgba): void;
  /** The colour of cells cut below the stock's bottom (the renderer's out-of-bounds colour). */
  setBelowColor(color: Rgba): void;
  readonly active: boolean;
  /** The surface's footprint in the path frame as [x0, y0, x1, y1], or null with none. */
  readonly footprint: readonly [number, number, number, number] | null;
  draw(mvp: Float32Array, offset: Vec3): void;
  dispose(): void;
}

export interface CarveLayerOptions {
  /** Most mesh vertices per side (default `defaultMeshMax`: one per cell on real GPUs, fewer on a software renderer). */
  readonly meshMax?: number;
}

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/**
 * The mesh cap for this context: `SOFTWARE_MESH_MAX` when the context says it renders in software (the browser
 * tests' headless Chromium runs SwiftShader), else `MESH_MAX`. Without the renderer's name, `MESH_MAX`.
 */
export function defaultMeshMax(gl: WebGL2RenderingContext): number {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info') as { readonly UNMASKED_RENDERER_WEBGL: number } | null;
    const name: unknown = gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL);
    return typeof name === 'string' && SOFTWARE_RENDERER.test(name) ? SOFTWARE_MESH_MAX : MESH_MAX;
  } catch {
    return MESH_MAX;
  }
}

export function createCarveLayer(gl: WebGL2RenderingContext, options: CarveLayerOptions = {}): CarveLayer {
  const meshMax = options.meshMax ?? defaultMeshMax(gl);
  const top = link(gl, TOP_VERTEX, TOP_FRAGMENT, []);
  const wall = link(gl, WALL_VERTEX, WALL_FRAGMENT, ['a_wall', 'a_shade']);
  const loc = (p: WebGLProgram, names: readonly string[]): Record<string, WebGLUniformLocation | null> => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, `u_${n}`)]));
  const shared = ['height', 'mvp', 'offset', 'grid', 'size', 'z', 'color'];
  const tu = loc(top, [...shared, 'mesh', 'stride', 'below', 'belowEps']);
  const wu = loc(wall, shared);
  const gridVao = gl.createVertexArray();
  let texture: WebGLTexture | null = null;
  let wallVao: WebGLVertexArrayObject | null = null;
  let wallBuffer: WebGLBuffer | null = null;
  let wallCount = 0;
  let surface: CarveSurface | null = null;
  let pending: CellRect[] = [];
  let color: Rgba = [0.75, 0.75, 0.75, 1];
  let belowColor: Rgba = [0.8, 0.1, 0.1, 1];

  function releaseSurface(): void {
    if (texture !== null) gl.deleteTexture(texture);
    if (wallVao !== null) gl.deleteVertexArray(wallVao);
    if (wallBuffer !== null) gl.deleteBuffer(wallBuffer);
    texture = wallVao = wallBuffer = null;
    wallCount = 0;
    pending = [];
  }

  function upload(r: CellRect): void {
    if (surface === null || r.w <= 0 || r.h <= 0) return;
    const nx = surface.spec.nx;
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, nx);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, r.w, r.h, gl.RED, gl.FLOAT, surface.z, r.y * nx + r.x);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  }

  function flush(): void {
    if (pending.length === 0 || texture === null) return;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    if (pending.length > MAX_UPLOADS) upload(pending.reduce<CellRect | null>((a, b) => unionRect(a, b), null) as CellRect);
    else for (const r of pending) upload(r);
    pending = [];
  }

  function uniforms(u: Record<string, WebGLUniformLocation | null>, spec: GridSpec, mvp: Float32Array, offset: Vec3): void {
    gl.uniform1i(u['height'] ?? null, 0);
    gl.uniformMatrix4fv(u['mvp'] ?? null, false, mvp);
    gl.uniform3f(u['offset'] ?? null, offset[0], offset[1], offset[2]);
    gl.uniform3f(u['grid'] ?? null, spec.x0, spec.y0, spec.cell);
    gl.uniform2i(u['size'] ?? null, spec.nx, spec.ny);
    gl.uniform2f(u['z'] ?? null, spec.top, spec.bottom);
    gl.uniform4f(u['color'] ?? null, color[0], color[1], color[2], color[3]);
  }

  return {
    set(next) {
      releaseSurface();
      surface = next;
      if (next === null) return;
      const { nx, ny } = next.spec;
      texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, nx, ny);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
      pending = [{ x: 0, y: 0, w: nx, h: ny }];
      const walls = wallVertices(next.spec);
      wallVao = gl.createVertexArray();
      gl.bindVertexArray(wallVao);
      wallBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, wallBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, walls, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
      gl.bindVertexArray(null);
      wallCount = walls.length / 4;
    },
    update(rect) {
      if (surface !== null) pending.push(rect);
    },
    setColor(next) {
      color = next;
    },
    setBelowColor(next) {
      belowColor = next;
    },
    get active() {
      return surface !== null;
    },
    get footprint() {
      if (surface === null) return null;
      const g = surface.spec;
      return [g.x0, g.y0, g.x0 + g.nx * g.cell, g.y0 + g.ny * g.cell] as const;
    },
    draw(mvp, offset) {
      if (surface === null || texture === null) return;
      const spec = surface.spec;
      gl.activeTexture(gl.TEXTURE0);
      flush();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.enable(gl.DEPTH_TEST);
      const m = meshLayout(spec, meshMax);
      gl.useProgram(top);
      uniforms(tu, spec, mvp, offset);
      gl.uniform2i(tu['mesh'] ?? null, m.mx, m.my);
      gl.uniform1i(tu['stride'] ?? null, m.stride);
      gl.uniform4f(tu['below'] ?? null, belowColor[0], belowColor[1], belowColor[2], belowColor[3]);
      gl.uniform1f(tu['belowEps'] ?? null, BELOW_STOCK_EPS);
      gl.bindVertexArray(gridVao);
      // Pulled toward the eye a little: a cut to (or below) the stock's bottom lies on the fixture's top face.
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -4);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 2 * m.mx, m.my - 1);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      if (wallVao !== null && wallCount > 0) {
        gl.useProgram(wall);
        uniforms(wu, spec, mvp, offset);
        gl.bindVertexArray(wallVao);
        gl.drawArrays(gl.TRIANGLES, 0, wallCount);
      }
      gl.bindVertexArray(null);
    },
    dispose() {
      releaseSurface();
      surface = null;
      gl.deleteVertexArray(gridVao);
      gl.deleteProgram(top);
      gl.deleteProgram(wall);
    },
  };
}
