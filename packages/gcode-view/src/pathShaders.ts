/**
 * The renderer's GLSL for the path, its overlays and the scene solids (renderer.ts compiles them). Strings
 * only.
 *
 * The path's colour, in order:
 * - by move type: rapids muted and dashed, feeds, arcs, out-of-bounds and uncertain moves each their own;
 * - by tool, when the page gives a colour per line (lineTools.ts): the tool's colour on feeds, a lighter
 *   tint of it on arcs and a fainter one on (still dashed) rapids, so the move type stays visible without a
 *   second set of hues. Out-of-bounds and uncertain moves keep their warning colours. Lines past the
 *   scrubbed line are faded, and with one tool picked in the legend the others are faded more;
 * - without tool colours, the scrubbed lines are tinted with the highlight colour, as before;
 * - the planner view of a running job (cut, executing, queued) over either;
 * - over a carved stock, the path is drawn faint (u_dimAlpha).
 */
import { STYLE } from './geometry.ts';

/** Lines whose tool colour is looked up per line: the texture's width (lineTools.ts). */
export const LINE_TOOLS_WIDTH = 4096;

export function pathVertex(styleCount: number): string {
  return `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
in vec3 a_pos;
in float a_style;
in float a_line;
in float a_dist;
uniform mat4 u_mvp;
uniform vec3 u_offset;
uniform float u_showRapids;
uniform float u_highlightEnd;
uniform vec4 u_colors[${String(styleCount)}];
uniform vec4 u_highlight;
uniform vec4 u_plan;
uniform vec4 u_cut;
uniform vec4 u_exec;
uniform vec4 u_queued;
uniform vec4 u_dimRect;
uniform float u_dimAlpha;
uniform float u_toolOn;
uniform vec4 u_toolColors[9];
uniform float u_focus;
uniform vec4 u_bg;
uniform usampler2D u_lineTools;
out vec4 v_color;
out float v_hidden;
out float v_dist;
out float v_dash;
void main() {
  int s = int(a_style + 0.5);
  bool rapid = s == ${String(STYLE.RAPID)};
  v_hidden = (rapid && u_showRapids < 0.5) ? 1.0 : 0.0;
  v_dash = rapid ? 1.0 : 0.0;
  v_dist = a_dist;
  // The scrubber tints cutting moves; traverses stay muted and dashed so the cut stays dominant.
  v_color = (!rapid && a_line >= 0.0 && a_line < u_highlightEnd) ? u_highlight : u_colors[s];
  // Colour by tool: the tool's colour, lighter on arcs, fainter on rapids; faded past the scrubbed line.
  if (u_toolOn > 0.5 && a_line >= 0.0 && s <= ${String(STYLE.ARC)}) {
    int li = int(a_line + 0.5);
    int slot = clamp(int(texelFetch(u_lineTools, ivec2(li % ${String(LINE_TOOLS_WIDTH)}, li / ${String(LINE_TOOLS_WIDTH)}), 0).r), 0, 8);
    vec4 c = u_toolColors[slot];
    if (s == ${String(STYLE.ARC)}) c = mix(c, u_bg, 0.35);
    else if (rapid) c = mix(c, u_bg, 0.55);
    if (u_highlightEnd > 0.0 && a_line >= u_highlightEnd) c = mix(c, u_bg, 0.65);
    if (u_focus >= 0.0 && float(slot) != u_focus) c = mix(c, u_bg, 0.8);
    v_color = vec4(c.rgb, 1.0);
  }
  // The planner view of a running job: cut lines dimmed, the executing line highlighted, the queued band.
  if (u_plan.w > 0.5 && a_line >= 0.0) {
    if (a_line < u_plan.x) v_color = u_cut;
    else if (a_line < u_plan.y) v_color = u_exec;
    else if (a_line < u_plan.z) v_color = u_queued;
  }
  // Over a carved stock the path is drawn faint, so the carve reads through it.
  if (u_dimAlpha < 1.0 && a_pos.x >= u_dimRect.x && a_pos.x <= u_dimRect.z && a_pos.y >= u_dimRect.y && a_pos.y <= u_dimRect.w) v_color.a *= u_dimAlpha;
  gl_Position = u_mvp * vec4(a_pos + u_offset, 1.0);
}`;
}

export const PATH_FRAGMENT = `#version 300 es
precision mediump float;
in vec4 v_color;
in float v_hidden;
in float v_dist;
in float v_dash;
uniform float u_dash;
out vec4 o_color;
void main() {
  if (v_hidden > 0.5) discard;
  if (v_dash > 0.5 && u_dash > 0.0 && fract(v_dist / u_dash) > 0.55) discard;
  o_color = v_color;
}`;

/** The scene solids: flat triangles with a baked colour per vertex. */
export const SOLID_VERTEX = `#version 300 es
precision highp float;
in vec3 a_pos;
in vec4 a_color;
uniform mat4 u_mvp;
out vec4 v_color;
void main() {
  v_color = a_color;
  gl_Position = u_mvp * vec4(a_pos, 1.0);
}`;

export const SOLID_FRAGMENT = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 o_color;
void main() {
  o_color = v_color;
}`;

/** The path's vertex shader with the renderer's style count, for tests and diagnostics. */
export function pathShaderSource(): string {
  return pathVertex(14);
}
