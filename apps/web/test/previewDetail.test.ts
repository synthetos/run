import { describe, expect, it } from 'vitest';
import type { LoadOptions, SegmentList } from '@synthetos/gcode-view';
import { loadDetail, toolVertices } from '../src/preview/detail.ts';

const list: SegmentList = { vertices: new Float32Array(1_000_001 * 3), kinds: new Uint8Array(1_000_001), lineToVertex: Uint32Array.from([0, 1_000_001]) };

describe('display detail reuses the complete result', () => {
  it.each([false, true])('coarse first, staying coarse = %s', async (stayCoarse) => {
    const calls: LoadOptions[] = [];
    const stages: string[] = [];
    const renderer = { load: async (segments: SegmentList, options: LoadOptions = {}) => {
      expect(segments).toBe(list);
      calls.push(options);
      options.onProgress?.(0.4);
    } };
    await loadDetail(renderer, list, { signal: new AbortController().signal, coarseFirst: true, stayCoarse, keepVertices: [], bounds: null, retain: false, onProgress: stage => stages.push(stage), painted: async () => { expect(stages).toEqual(['coarse']); } });
    expect(calls[0]?.sampling?.stride).toBe(7);
    expect(calls.length).toBe(stayCoarse ? 1 : 2);
    if (!stayCoarse) {
      expect(calls[1]?.retainUntilReady).toBe(true);
      expect(stages).toEqual(['coarse', 'refining', 'refining', 'full']);
    }
  });
  it('cancel between the coarse paint and refinement never starts another load', async () => {
    const controller = new AbortController();
    let calls = 0;
    await loadDetail({ load: async () => { calls++; } }, list, { signal: controller.signal, coarseFirst: true, stayCoarse: false, keepVertices: [], bounds: null, retain: false, onProgress: () => {}, painted: async () => { controller.abort(); } });
    expect(calls).toBe(1);
  });
  it('maps a tool change on a non-drawing source line to the following geometry', () => {
    expect(toolVertices({ ...list, lineToVertex: Uint32Array.from([0, 3, 3, 6, 1_000_001]) }, Uint32Array.from([7]), Uint32Array.from([1, 7, 8, 20]))).toEqual([3]);
  });
});
