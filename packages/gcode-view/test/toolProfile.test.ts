import { describe, expect, it } from 'vitest';
import { profileHeight, tipHeight, toolOutline, toolWireframe, type ToolShape } from '../src/index.ts';

const base = { diameter: 6, fluteLength: 18, shank: 6, length: 26 } as const;
const shape = (s: Partial<ToolShape> & Pick<ToolShape, 'tip'>): ToolShape => ({ ...base, ...s });

describe('tool profiles (tool-sim slice 1)', () => {
  it('flat: 0 everywhere', () => {
    const s = shape({ tip: 'flat' });
    expect(profileHeight(s, 0)).toBe(0);
    expect(profileHeight(s, 3)).toBe(0);
    expect(tipHeight(s)).toBe(0);
  });

  it('ball: R − √(R² − r²), a full radius at the edge', () => {
    const s = shape({ tip: 'ball' });
    expect(profileHeight(s, 0)).toBe(0);
    expect(profileHeight(s, 3)).toBeCloseTo(3, 12);
    expect(profileHeight(s, 1.5)).toBeCloseTo(3 - Math.sqrt(9 - 2.25), 12);
  });

  it('bull-nose: flat to R − c, then the corner radius', () => {
    const s = shape({ tip: 'bull-nose', cornerRadius: 1 });
    expect(profileHeight(s, 2)).toBe(0);
    expect(profileHeight(s, 2.5)).toBeCloseTo(1 - Math.sqrt(1 - 0.25), 12);
    expect(tipHeight(s)).toBeCloseTo(1, 12);
    // A corner larger than the radius is a ball.
    expect(profileHeight(shape({ tip: 'bull-nose', cornerRadius: 9 }), 1.5)).toBeCloseTo(profileHeight(shape({ tip: 'ball' }), 1.5), 12);
  });

  it('V: a 60° bit is 1/tan(30°) ≈ 1.732 mm deep at r = 1 mm; a tip width lifts the cone', () => {
    expect(profileHeight(shape({ tip: 'v', vAngle: 60 }), 1)).toBeCloseTo(1.7320508, 6);
    expect(profileHeight(shape({ tip: 'v', vAngle: 90 }), 2)).toBeCloseTo(2, 12);
    const w = shape({ tip: 'v', vAngle: 90, tipWidth: 1 });
    expect(profileHeight(w, 0.5)).toBe(0);
    expect(profileHeight(w, 1.5)).toBeCloseTo(1, 12);
    // The seed 90° V-bit, 12.7 mm wide, reaches its full width 6.35 mm above the tip.
    expect(tipHeight({ tip: 'v', diameter: 12.7, fluteLength: 6.4, shank: 6.35, length: 22, vAngle: 90 })).toBeCloseTo(6.35, 12);
  });

  it('drill: r / tan(β/2); a 118° point on a 5 mm drill is about 1.502 mm tall', () => {
    expect(tipHeight({ tip: 'drill', diameter: 5, fluteLength: 28, shank: 5, length: 34, pointAngle: 118 })).toBeCloseTo(2.5 / Math.tan(59 * Math.PI / 180), 12);
    expect(tipHeight({ tip: 'drill', diameter: 5, fluteLength: 28, shank: 5, length: 34, pointAngle: 118 })).toBeCloseTo(1.502, 3);
  });

  it('r is clamped to [0, D/2]; a bad angle falls back (90° V, 118° drill)', () => {
    const s = shape({ tip: 'ball' });
    expect(profileHeight(s, -1)).toBe(0);
    expect(profileHeight(s, 10)).toBeCloseTo(3, 12);
    expect(profileHeight(shape({ tip: 'v', vAngle: 0 }), 1)).toBeCloseTo(1, 12);
    expect(profileHeight(shape({ tip: 'v', vAngle: 200 }), 1)).toBeCloseTo(1, 12);
  });

  it('outline: tip shape, flutes at the cutting diameter, then the shank to the drawn length', () => {
    expect(toolOutline(shape({ tip: 'flat' }))).toEqual([[0, 0], [3, 0], [3, 18], [3, 26]]);
    const v = toolOutline({ tip: 'v', diameter: 12.7, fluteLength: 6.4, shank: 6.35, length: 22, vAngle: 90 });
    expect(v[0]).toEqual([0, 0]);
    expect(v[1]?.[0]).toBeCloseTo(6.35, 12);
    expect(v[1]?.[1]).toBeCloseTo(6.35, 12);
    expect(v.at(-1)).toEqual([3.175, 22]);
    const ball = toolOutline(shape({ tip: 'ball' }), 4);
    expect(ball.length).toBe(4 + 1 + 2);
    for (const [r, z] of ball.slice(0, 5)) expect(z).toBeCloseTo(3 - Math.sqrt(9 - r * r), 9);
  });

  it('wireframe: true size, tip at the origin, within the tool radius and length', () => {
    const lines = toolWireframe(shape({ tip: 'ball' }), 6);
    expect(lines.length).toBeGreaterThan(20);
    let zMin = Infinity, zMax = -Infinity, rMax = 0;
    for (const seg of lines) for (const [x, y, z] of seg) { zMin = Math.min(zMin, z); zMax = Math.max(zMax, z); rMax = Math.max(rMax, Math.hypot(x, y)); }
    expect(zMin).toBeCloseTo(0, 12);
    expect(zMax).toBeCloseTo(26, 12);
    expect(rMax).toBeCloseTo(3, 9);
  });
});
