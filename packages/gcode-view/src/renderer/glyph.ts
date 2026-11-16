import { ringSegments } from '../scene.ts';
import { type Box3, type Vec3 } from '../segments.ts';
import { type ToolShape } from '../toolProfile.ts';

/** True when two tool shapes draw the same wireframe. */
export function sameShape(a: ToolShape | null, b: ToolShape | null): boolean {
  if (a === null || b === null) return a === b;
  return a.tip === b.tip && a.diameter === b.diameter && a.fluteLength === b.fluteLength && a.shank === b.shank && a.length === b.length && a.cornerRadius === b.cornerRadius && a.vAngle === b.vAngle && a.tipWidth === b.tipWidth && a.pointAngle === b.pointAngle;
}

/**
 * The tool, drawn as lines with its tip at `tip`: a 1/8 in bit 25 mm long under a 52 mm spindle 80 mm tall,
 * at true size on a bed and scaled down (to a fifth at most) when the drawing is small, so it never hides a part.
 */
/** The generic glyph's scale for a framed extent: full size from 500 mm, down to a fifth for a small job. */
export function glyphScale(box: Box3 | null): number {
  const span = box === null ? 0 : Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]);
  return Math.min(1, Math.max(0.2, span / 500));
}

/** The generic glyph's bit: its radius and flute length (the helix of a turning bit follows them). */
export function glyphBit(box: Box3 | null): { readonly radius: number; readonly length: number } {
  const k = glyphScale(box);
  return { radius: 1.6 * k, length: 25 * k };
}

export function toolGlyph(tip: Vec3, box: Box3 | null): Array<readonly [Vec3, Vec3]> {
  const k = glyphScale(box);
  const [x, y, z] = tip;
  const bitR = 1.6 * k, bitL = 25 * k, nutR = 10 * k, nutH = 12 * k, bodyR = 26 * k, bodyH = 80 * k;
  const out: Array<readonly [Vec3, Vec3]> = [];
  const ring = (r: number, at: number, n: number): void => {
    const pts = ringSegments({ center: [x, y, at], radius: r, color: [0, 0, 0, 0] }, n);
    for (let i = 0; i + 1 < pts.length; i += 2) out.push([pts[i] as Vec3, pts[i + 1] as Vec3]);
  };
  const posts = (r: number, z0: number, z1: number): void => {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) out.push([[x + dx, y + dy, z0], [x + dx, y + dy, z1]]);
  };
  // The bit: its tip, its flutes' outline, a short cross at the tip so the exact point reads at any zoom.
  ring(bitR, z, 12);
  posts(bitR, z, z + bitL);
  out.push([[x - bitR * 2, y, z], [x + bitR * 2, y, z]], [[x, y - bitR * 2, z], [x, y + bitR * 2, z]]);
  // The collet nut, then the spindle body.
  const n0 = z + bitL;
  ring(nutR, n0, 16);
  ring(nutR, n0 + nutH, 16);
  posts(nutR, n0, n0 + nutH);
  const b0 = n0 + nutH;
  ring(bodyR, b0, 24);
  ring(bodyR, b0 + bodyH, 24);
  posts(bodyR, b0, b0 + bodyH);
  return out;
}
