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
 * Mesh: a vertex per cell centre plus the stock's edges, thinned to at most
 * `MESH_MAX` per side (every second cell on the 180 × 120 mm sample stock at
 * 0.25 mm), drawn indexed with positions from gl_VertexID (no vertex
 * buffer). The cap keeps a frame cheap on a software renderer (a full-size
 * mesh of 350,000 vertices took about 170 ms a frame under SwiftShader; this
 * one about 30 ms). Cells with no stock (outside a round or imported
 * outline) and cells cut through to the bottom are not drawn, decided per
 * texel, so the fixture or bed shows through.
 *
 * Normals: the drawn triangle's own slope (screen-space derivatives, so a
 * steep wall shades as one face); on a thinned mesh's gentler slopes, the
 * neighbouring texels' slope across one mesh step, so detail finer than the
 * mesh (a narrow V-groove on a large stock) still shades.
 *
 * Frames: the surface is in the path frame, drawn with the path's offset.
 * It does not carve, and it draws no below-stock warning (slice 3).
 */
import type { Rgba } from '../scene.ts';
import type { Vec3 } from '../segments.ts';
import { link } from '../glProgram.ts';
import type { CarveSurface } from './client.ts';
import { unionRect, type CellRect, type GridSpec } from './heightmap.ts';
import { gridIndexes, meshLayout, wallVertices } from './meshGeometry.ts';
import { TOP_FRAGMENT, TOP_VERTEX, WALL_FRAGMENT, WALL_VERTEX } from './shaders.ts';


/** More pending rectangles than this are uploaded as one. */
const MAX_UPLOADS = 16;

export interface CarveLayer {
  /** The surface to draw (the renderer then hides the flat stock), or null for none. Uploads it whole. */
  set(surface: CarveSurface | null): void;
  /** A rectangle of the surface changed: uploaded before the next frame. */
  update(rect: CellRect): void;
  setColor(color: Rgba): void;
  readonly active: boolean;
  draw(mvp: Float32Array, offset: Vec3): void;
  dispose(): void;
}

export function createCarveLayer(gl: WebGL2RenderingContext): CarveLayer {
  const top = link(gl, TOP_VERTEX, TOP_FRAGMENT, []);
  const wall = link(gl, WALL_VERTEX, WALL_FRAGMENT, ['a_wall', 'a_shade']);
  const loc = (p: WebGLProgram, names: readonly string[]): Record<string, WebGLUniformLocation | null> => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, `u_${n}`)]));
  const shared = ['height', 'mvp', 'offset', 'grid', 'size', 'z', 'color'];
  const tu = loc(top, [...shared, 'mesh', 'stride']);
  const wu = loc(wall, shared);
  const gridVao = gl.createVertexArray();
  let gridIndices: WebGLBuffer | null = null;
  let gridLayout = '';
  let gridCount = 0;
  let texture: WebGLTexture | null = null;
  let wallVao: WebGLVertexArrayObject | null = null;
  let wallBuffer: WebGLBuffer | null = null;
  let wallCount = 0;
  let surface: CarveSurface | null = null;
  let pending: CellRect[] = [];
  let color: Rgba = [0.75, 0.75, 0.75, 1];

  function releaseSurface(): void {
    if (texture !== null) gl.deleteTexture(texture);
    if (wallVao !== null) gl.deleteVertexArray(wallVao);
    if (wallBuffer !== null) gl.deleteBuffer(wallBuffer);
    texture = wallVao = wallBuffer = null;
    wallCount = 0;
    pending = [];
  }

  /** The grid's index buffer, rebuilt only when the mesh size changes. */
  function ensureIndices(mx: number, my: number): void {
    const key = `${String(mx)}x${String(my)}`;
    if (key === gridLayout) return;
    if (gridIndices !== null) gl.deleteBuffer(gridIndices);
    const idx = gridIndexes(mx, my);
    gl.bindVertexArray(gridVao);
    gridIndices = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gridIndices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    gridLayout = key;
    gridCount = idx.length;
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
    get active() {
      return surface !== null;
    },
    draw(mvp, offset) {
      if (surface === null || texture === null) return;
      const spec = surface.spec;
      gl.activeTexture(gl.TEXTURE0);
      flush();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.enable(gl.DEPTH_TEST);
      const m = meshLayout(spec);
      gl.useProgram(top);
      uniforms(tu, spec, mvp, offset);
      gl.uniform2i(tu['mesh'] ?? null, m.mx, m.my);
      gl.uniform1i(tu['stride'] ?? null, m.stride);
      ensureIndices(m.mx, m.my);
      gl.bindVertexArray(gridVao);
      gl.drawElements(gl.TRIANGLES, gridCount, gl.UNSIGNED_INT, 0);
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
      if (gridIndices !== null) gl.deleteBuffer(gridIndices);
      gl.deleteVertexArray(gridVao);
      gl.deleteProgram(top);
      gl.deleteProgram(wall);
    },
  };
}
