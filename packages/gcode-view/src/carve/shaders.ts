/**
 * The carved stock's GLSL (carve/mesh.ts): the top surface, displaced by the
 * heightmap texture and shaded per fragment, and the side walls. Strings
 * only; mesh.ts compiles and drives them. See mesh.ts for what each choice
 * is for.
 */

const COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D u_height;
uniform mat4 u_mvp;
uniform vec3 u_offset;
uniform vec3 u_grid;
uniform ivec2 u_size;
uniform vec2 u_z;
const float NO_STOCK = -1e29;
float topAt(ivec2 t) {
  float h = texelFetch(u_height, clamp(t, ivec2(0), u_size - 1), 0).r;
  return h < NO_STOCK ? u_z.x : max(h, u_z.y);
}
`;

export const TOP_VERTEX = `${COMMON}
uniform ivec2 u_mesh;
uniform int u_stride;
out vec2 v_cell;
out float v_z;
// The cells [lo, hi) mesh vertex k stands for along an axis of n cells, and its position in cells: the stock's
// edge for the first and last vertex, the middle of its block of u_stride cells otherwise.
float axis(int k, int m, int n, out int lo, out int hi) {
  if (k <= 0) { lo = 0; hi = min(n, u_stride); return 0.0; }
  if (k >= m - 1) { lo = ((n - 1) / u_stride) * u_stride; hi = n; return float(n); }
  lo = (k - 1) * u_stride;
  hi = min(n, lo + u_stride);
  return 0.5 * float(lo + hi);
}
void main() {
  // One triangle strip per row of quads, drawn instanced: gl_InstanceID is the row, gl_VertexID walks along it.
  int kx = gl_VertexID >> 1;
  int ky = gl_InstanceID + (gl_VertexID & 1);
  ivec2 lo;
  ivec2 hi;
  float x = axis(kx, u_mesh.x, u_size.x, lo.x, hi.x);
  float y = axis(ky, u_mesh.y, u_size.y, lo.y, hi.y);
  // The lowest stock top among the cells this vertex stands for (one cell unless the mesh is thinned), so a
  // thinned mesh never loses a cut or zig-zags a wall between its top and its floor.
  float z = 1e30;
  for (int j = lo.y; j < hi.y; j++) {
    for (int i = lo.x; i < hi.x; i++) {
      float h = texelFetch(u_height, ivec2(i, j), 0).r;
      if (h >= NO_STOCK) z = min(z, h);
    }
  }
  v_z = z > 1e29 ? u_z.x : max(z, u_z.y);
  v_cell = vec2(x, y);
  vec3 p = vec3(u_grid.x + x * u_grid.z, u_grid.y + y * u_grid.z, v_z);
  gl_Position = u_mvp * vec4(p + u_offset, 1.0);
}`;

export const TOP_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D u_height;
uniform ivec2 u_size;
uniform vec3 u_grid;
uniform vec2 u_z;
uniform vec4 u_color;
uniform vec4 u_below;
uniform float u_belowEps;
in vec2 v_cell;
in float v_z;
out vec4 o_color;
const float NO_STOCK = -1e29;
float near(ivec2 t, float fallback) {
  float h = texelFetch(u_height, clamp(t, ivec2(0), u_size - 1), 0).r;
  return h < NO_STOCK ? fallback : max(h, u_z.y);
}
// The 4 x 4 texels around the fragment, k[y][x], from texel i0 - 1.
float k[16];
// The surface's slope at texel centre (x, y) of the block (1 or 2 each), a Sobel kernel over its 3 x 3
// neighbours (unnormalised; z is 1): a wall stepped cell by cell around a curve gets one steady direction.
vec3 slopeAt(int x, int y) {
  float gx = (k[(y - 1) * 4 + x - 1] + 2.0 * k[y * 4 + x - 1] + k[(y + 1) * 4 + x - 1]) - (k[(y - 1) * 4 + x + 1] + 2.0 * k[y * 4 + x + 1] + k[(y + 1) * 4 + x + 1]);
  float gy = (k[(y - 1) * 4 + x - 1] + 2.0 * k[(y - 1) * 4 + x] + k[(y - 1) * 4 + x + 1]) - (k[(y + 1) * 4 + x - 1] + 2.0 * k[(y + 1) * 4 + x] + k[(y + 1) * 4 + x + 1]);
  return vec3(gx / (8.0 * u_grid.z), gy / (8.0 * u_grid.z), 1.0);
}
void main() {
  ivec2 t = clamp(ivec2(floor(v_cell)), ivec2(0), u_size - 1);
  float h = texelFetch(u_height, t, 0).r;
  // No stock here, or cut through to the bottom (and no further): what is under it shows. A cut below the
  // bottom is drawn in the warning colour, at the bottom.
  bool below = h >= NO_STOCK && h < u_z.y - u_belowEps;
  if (h < NO_STOCK || (!below && h <= u_z.y + 1e-4)) discard;
  // The slope blended between the four nearest texel centres, so a round trough or a curved wall shades smoothly
  // instead of in cell-sized facets.
  vec2 c = v_cell - 0.5;
  ivec2 i0 = ivec2(floor(c));
  vec2 f = c - floor(c);
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) k[y * 4 + x] = near(i0 + ivec2(x - 1, y - 1), h);
  }
  vec3 n = normalize(mix(mix(slopeAt(1, 1), slopeAt(2, 1), f.x), mix(slopeAt(1, 2), slopeAt(2, 2), f.x), f.y));
  vec3 light = normalize(vec3(-0.35, -0.5, 1.0));
  // A flat surface, top or floor, is fully lit in the stock's own colour, as the scene solids' top faces are;
  // walls turn darker facing away from the light. Wrapped lighting (half of the cosine term) keeps a wall's shade
  // steady where its direction wavers cell by cell. Deeper is a little darker, so depth reads from any angle.
  float shade = clamp(0.3 + 0.7 * (0.5 + 0.5 * dot(n, light)) / (0.5 + 0.5 * light.z), 0.3, 1.1);
  float depth = clamp((u_z.x - v_z) / max(1e-6, u_z.x - u_z.y), 0.0, 1.0);
  // Opaque whatever the stock colour's alpha: a see-through cut would wash out against the page.
  o_color = below ? vec4(u_below.rgb * (0.75 + 0.25 * shade), 1.0) : vec4(u_color.rgb * shade * (1.0 - 0.15 * depth), 1.0);
}`;

export const WALL_VERTEX = `${COMMON}
in vec3 a_wall;
in float a_shade;
out float v_shade;
void main() {
  ivec2 t = ivec2(floor((a_wall.xy - u_grid.xy) / u_grid.z));
  float z = a_wall.z > 0.5 ? topAt(t) : u_z.y;
  v_shade = a_shade;
  gl_Position = u_mvp * vec4(vec3(a_wall.xy, z) + u_offset, 1.0);
}`;

export const WALL_FRAGMENT = `#version 300 es
precision mediump float;
uniform vec4 u_color;
in float v_shade;
out vec4 o_color;
void main() {
  o_color = vec4(u_color.rgb * v_shade, 1.0);
}`;
