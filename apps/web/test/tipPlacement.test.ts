/** Icon-button tips stay inside what shows (owner, 2026-11-09): placed from the button's position, never off an edge. */
import { describe, expect, it } from 'vitest';
import { tipPlace } from '../src/workspace/tipPlacement.ts';

describe('tipPlace', () => {
  it('a button near the right edge of a side column moves its tip left so all of it shows', () => {
    const column = { left: 1000, right: 1259, bottom: 720 };
    const p = tipPlace({ left: 1100, bottom: 400 }, column);
    expect(p.width).toBe(240);
    expect(1100 + p.left).toBeGreaterThanOrEqual(1000 + 8);
    expect(1100 + p.left + p.width).toBeLessThanOrEqual(1259 - 8);
    expect(p.above).toBe(false);
  });
  it('a button near the left edge keeps its tip at the button; a phone narrows it to the screen', () => {
    expect(tipPlace({ left: 20, bottom: 400 }, { left: 0, right: 1280, bottom: 720 }).left).toBe(0);
    const phone = tipPlace({ left: 300, bottom: 400 }, { left: 0, right: 390, bottom: 844 });
    expect(300 + phone.left).toBeGreaterThanOrEqual(8);
    expect(300 + phone.left + phone.width).toBeLessThanOrEqual(390 - 8);
  });
  it('near the bottom of what shows, the tip opens above', () => {
    expect(tipPlace({ left: 500, bottom: 700 }, { left: 0, right: 1280, bottom: 720 }).above).toBe(true);
  });
});
