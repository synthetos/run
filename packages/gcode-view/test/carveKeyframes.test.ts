/** Heightmap snapshots under a memory cap (carve/keyframes.ts). */
import { describe, expect, it } from 'vitest';
import { KEYFRAME_CAP_BYTES, createKeyframes, keyframeInterval } from '../src/index.ts';

describe('keyframeInterval', () => {
  it('snapshots every 50 lines at most often', () => {
    expect(keyframeInterval(1000, 10_000)).toBe(50);
  });
  it('spaces snapshots of a whole file to fit the 128 MB cap', () => {
    // 2 M cells = 8 MB a snapshot: 16 fit, so a 50,000-line file snapshots every 3125 lines.
    expect(KEYFRAME_CAP_BYTES).toBe(128 * 1024 * 1024);
    expect(keyframeInterval(50_000, 2_097_152)).toBe(3125);
  });
});

describe('createKeyframes', () => {
  it('finds the snapshot at or before a line, as a copy', () => {
    const k = createKeyframes(10);
    const z = new Float32Array([1, 2]);
    k.put(10, z);
    z[0] = 9;
    k.put(30, z);
    k.put(20, new Float32Array([5, 5]));
    expect(k.atOrBefore(5)).toBeNull();
    expect(k.atOrBefore(10)?.z[0]).toBe(1);
    expect(k.atOrBefore(29)?.line).toBe(20);
    expect(k.atOrBefore(1000)?.line).toBe(30);
    expect(k.count).toBe(3);
    expect(k.bytes).toBe(24);
  });
  it('keeps the first snapshot of a line', () => {
    const k = createKeyframes(10);
    k.put(10, new Float32Array([1]));
    k.put(10, new Float32Array([2]));
    expect(k.atOrBefore(10)?.z[0]).toBe(1);
    expect(k.count).toBe(1);
  });
  it('thins out to every other snapshot over the cap', () => {
    const k = createKeyframes(1, 16);
    for (let line = 1; line <= 5; line++) k.put(line, new Float32Array([line]));
    expect(k.bytes).toBeLessThanOrEqual(16);
    expect(k.atOrBefore(5)?.line).toBe(5);
    expect(k.count).toBeLessThanOrEqual(4);
    k.clear();
    expect(k.count).toBe(0);
    expect(k.atOrBefore(5)).toBeNull();
  });
  it('skips a snapshot bigger than the cap', () => {
    const k = createKeyframes(1, 4);
    k.put(1, new Float32Array(2));
    expect(k.count).toBe(0);
  });
});
