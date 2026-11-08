import { describe, expect, it } from 'vitest';
import { readTool } from '@synthetos/library';
import { geometryForType, shapeFields } from '../src/workspace/toolShape.ts';

const flat = { diameter: 6, shank: 6, flutes: 2, fluteLength: 20, overallLength: 50, stickout: 30 };

describe('changing a tool type', () => {
  it('fills what the new type needs and keeps the sizes', () => {
    expect(geometryForType(flat, 'v-bit')).toEqual({ ...flat, vAngle: 90 });
    expect(geometryForType(flat, 'drill')).toEqual({ ...flat, pointAngle: 118 });
    expect(geometryForType(flat, 'bull-nose')).toEqual({ ...flat, cornerRadius: 0.5 });
    expect(geometryForType({ ...flat, diameter: 1 }, 'bull-nose').cornerRadius).toBe(0.25);
  });

  it('drops what the new type does not take', () => {
    expect(geometryForType({ ...flat, vAngle: 60, tipWidth: 0.2 }, 'ball')).toEqual(flat);
    expect(geometryForType({ ...flat, vAngle: 60, tipWidth: 0.2 }, 'engraver')).toEqual({ ...flat, vAngle: 60, tipWidth: 0.2 });
    expect(geometryForType({ ...flat, cornerRadius: 1 }, 'drill')).toEqual({ ...flat, pointAngle: 118 });
  });

  it('every type change gives a tool the library accepts', () => {
    const base = {
      id: 'mine.t1', version: 1, name: 'T', type: 'flat', geometry: flat, toolMaterial: 'carbide', coating: 'uncoated',
      description: '', notes: '', purchase: [], cuttingData: [], life: { minutes: 0, byMaterial: [] }, tags: [], images: [],
    };
    for (const type of ['flat', 'ball', 'bull-nose', 'v-bit', 'chamfer', 'drill', 'engraver', 'o-flute', 'surfacing', 'thread-mill'] as const) {
      const result = readTool({ ...base, type, geometry: geometryForType({ ...flat, vAngle: 60, cornerRadius: 1 }, type) });
      expect(result.ok, `${type}: ${JSON.stringify(result.ok ? null : result.issues)}`).toBe(true);
    }
  });

  it('shows the shape numbers each type takes', () => {
    expect(shapeFields('flat')).toEqual([]);
    expect(shapeFields('v-bit')).toEqual(['vAngle', 'tipWidth']);
    expect(shapeFields('bull-nose')).toEqual(['cornerRadius']);
    expect(shapeFields('drill')).toEqual(['pointAngle']);
  });
});
