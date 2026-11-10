/**
 * Is this WebGL context drawn in software (render-budget, 2026-11-10)? SwiftShader (headless Chrome, blocked GPUs),
 * llvmpipe and softpipe (Linux without a driver) and Microsoft Basic Render (Windows VMs) all draw each frame on the
 * CPU, on the page's own thread. The same names gcode-view's carve mesh caps its size for (carve/mesh.ts).
 */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

interface RendererInfo {
  readonly UNMASKED_RENDERER_WEBGL: number;
}

/** The renderer's name: the unmasked one where the browser gives it, else the plain RENDERER string. */
export function rendererName(gl: Pick<WebGL2RenderingContext, 'getExtension' | 'getParameter' | 'RENDERER'>): string {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info') as RendererInfo | null;
    return String(gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL) ?? '');
  } catch {
    return '';
  }
}

export function isSoftwareRenderer(name: string): boolean {
  return SOFTWARE_RENDERER.test(name);
}

/**
 * The renderer's name before the real context exists, from a throwaway context that is released at once. The real
 * context's attributes (antialias) are fixed when it is created, so a software renderer is known first.
 */
export function probeRendererName(make: () => HTMLCanvasElement = () => document.createElement('canvas')): string {
  try {
    const gl = make().getContext('webgl2');
    if (gl === null) return '';
    const name = rendererName(gl);
    (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    return name;
  } catch {
    return '';
  }
}

/** Light mode's carve mesh cap, the smallest gcode-view allows (carve/meshGeometry.ts). */
export const LIGHT_CARVE_MESH_MAX = 256;
