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
float axis(int k, int m, int n, out int texel) {
  if (k <= 0) { texel = 0; return 0.0; }
  if (k >= m - 1) { texel = n - 1; return float(n); }
  texel = min(n - 1, (k - 1) * u_stride);
  return float(texel) + 0.5;
}
void main() {
  // Indexed: gl_VertexID is the grid vertex, row-major, so each is shaded once and shared by its triangles.
  int kx = gl_VertexID % u_mesh.x;
  int ky = gl_VertexID / u_mesh.x;
  ivec2 t;
  float x = axis(kx, u_mesh.x, u_size.x, t.x);
  float y = axis(ky, u_mesh.y, u_size.y, t.y);
  v_cell = vec2(x, y);
  v_z = topAt(t);
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
uniform int u_stride;
in vec2 v_cell;
in float v_z;
out vec4 o_color;
const float NO_STOCK = -1e29;
float near(ivec2 t, float fallback) {
  float h = texelFetch(u_height, clamp(t, ivec2(0), u_size - 1), 0).r;
  return h < NO_STOCK ? fallback : max(h, u_z.y);
}
void main() {
  ivec2 t = clamp(ivec2(floor(v_cell)), ivec2(0), u_size - 1);
  float h = texelFetch(u_height, t, 0).r;
  // No stock here, or cut through to the bottom: what is under it shows.
  if (h < NO_STOCK || h <= u_z.y + 1e-4) discard;
  // The drawn triangle's own slope (screen-space derivatives), so a steep wall shades as one face.
  vec3 p = vec3(v_cell * u_grid.z, v_z);
  vec3 n = normalize(cross(dFdx(p), dFdy(p)));
  if (n.z < 0.0) n = -n;
  if (u_stride > 1 && n.z > 0.7) {
    // A thinned mesh, on its gentler slopes: the texels' slope across one mesh step, so detail finer than
    // the mesh (a narrow V-groove on a large stock) still shades.
    int s = u_stride;
    float l = near(t - ivec2(s, 0), h);
    float r = near(t + ivec2(s, 0), h);
    float d = near(t - ivec2(0, s), h);
    float u = near(t + ivec2(0, s), h);
    float span = 2.0 * float(s) * u_grid.z;
    n = normalize(vec3((l - r) / span, (d - u) / span, 1.0));
  }
  vec3 light = normalize(vec3(-0.35, -0.5, 1.0));
  // A flat top keeps the stock's own colour, as the scene solids' top faces do; walls turn darker (more so
  // facing away from the light), and the deeper a cut the darker its floor, so depth reads from any angle.
  float shade = clamp(0.25 + 0.75 * max(dot(n, light), 0.0) / light.z, 0.25, 1.1);
  float depth = clamp((u_z.x - v_z) / max(1e-6, u_z.x - u_z.y), 0.0, 1.0);
  // Opaque whatever the stock colour's alpha: a see-through cut would wash out against the page.
  o_color = vec4(u_color.rgb * shade * (1.0 - 0.45 * depth), 1.0);
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
