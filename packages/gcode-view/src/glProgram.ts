/**
 * Compiling and linking WebGL2 programs for the renderer and its layers
 * (renderer.ts, carve/mesh.ts). Throws with the driver's log on failure.
 */

export function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error('gcode-view: could not create a shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) throw new Error(`gcode-view: shader did not compile: ${gl.getShaderInfoLog(shader) ?? ''}`);
  return shader;
}

/** A program from two shader sources, with `attributes` bound to locations 0, 1, … in order. */
export function link(gl: WebGL2RenderingContext, vertex: string, fragment: string, attributes: readonly string[]): WebGLProgram {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  attributes.forEach((name, i) => { gl.bindAttribLocation(program, i, name); });
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) throw new Error(`gcode-view: program did not link: ${gl.getProgramInfoLog(program) ?? ''}`);
  return program;
}
