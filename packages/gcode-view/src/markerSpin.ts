/**
 * The spindle spins the bit (owner, 2026-11-10): while the board reports the spindle on, the live tool marker
 * turns about its axis, the right way (M3 clockwise seen from above, M4 the other way), at a visible but not a
 * literal speed. A helix along the flutes shows the turning; without it a round tool looks still.
 *
 * Cheap: a turn is a few redraws a second, on a timer, only while the spindle is on and the marker is drawn.
 * On a software renderer (SwiftShader, llvmpipe), where a frame can take most of a second and Pause must never
 * wait behind the drawing, and under reduced motion, it does not turn: the page shows a badge instead.
 * Pure apart from `isSoftwareRenderer`, which asks the context its name.
 */
import type { Vec3 } from './segments.ts';

/** -1: M4 (counter-clockwise from above), 0: off, 1: M3 (clockwise from above). */
export type SpinDirection = -1 | 0 | 1;

/** Each redraw turns the bit this much: well under the flutes' 45° symmetry, so the direction always reads. */
export const SPIN_STEP_RAD = (15 * Math.PI) / 180;
/** Time between spin redraws, ms: about 15 a second (a GPU only). */
export const SPIN_FRAME_MS = 66;

/** The bit's turn at `now` (radians, counter-clockwise positive about +Z) for a spin started at `since`. */
export function spinAngle(direction: SpinDirection, since: number, now: number, frameMs: number): number {
  if (direction === 0 || !(frameMs > 0)) return 0;
  const steps = Math.floor(Math.max(0, now - since) / frameMs);
  // Clockwise from above is a negative turn about +Z.
  return -direction * ((steps * SPIN_STEP_RAD) % (2 * Math.PI));
}

/** A helix around the tool's axis from its tip (0, 0, 0) up `length`, at `radius`: `turns` turns in short lines. */
export function fluteHelix(radius: number, length: number, turns = 1.5, pieces = 36): Array<readonly [Vec3, Vec3]> {
  const out: Array<readonly [Vec3, Vec3]> = [];
  if (!(radius > 0) || !(length > 0)) return out;
  const at = (k: number): Vec3 => {
    const a = (k / pieces) * turns * 2 * Math.PI;
    return [radius * Math.cos(a), radius * Math.sin(a), (k / pieces) * length];
  };
  for (let k = 0; k < pieces; k++) out.push([at(k), at(k + 1)]);
  return out;
}

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** True when the context says it renders in software (SwiftShader, llvmpipe); false when it does not say. */
export function isSoftwareRenderer(gl: WebGL2RenderingContext): boolean {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info') as { readonly UNMASKED_RENDERER_WEBGL: number } | null;
    const name: unknown = gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL);
    return typeof name === 'string' && SOFTWARE_RENDERER.test(name);
  } catch {
    return false;
  }
}
