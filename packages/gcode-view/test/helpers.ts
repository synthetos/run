/** Test fixtures for gcode-view. */
import { SEGMENT, type SegmentList } from '../src/index.ts';

/** A list from per-line polylines: each line is [kind, x, y, z][] moves from the previous point. */
export function listOf(lines: ReadonlyArray<ReadonlyArray<readonly [number, number, number, number]>>, marks?: readonly number[]): SegmentList {
  const v: number[] = [0, 0, 0];
  const k: number[] = [SEGMENT.BREAK];
  const ltv: number[] = [];
  for (const line of lines) {
    ltv.push(k.length);
    for (const [kind, x, y, z] of line) {
      v.push(x, y, z);
      k.push(kind);
    }
  }
  ltv.push(k.length);
  return {
    vertices: new Float32Array(v),
    kinds: new Uint8Array(k),
    lineToVertex: new Uint32Array(ltv),
    ...(marks === undefined ? {} : { lineMarks: new Uint8Array(marks) }),
  };
}

/** A synthetic list of `n` lines, one segment each, cycling rapid/feed/arc with a break every 97 lines. */
export function bigList(n: number): SegmentList {
  const vertices = new Float32Array((n + 1) * 3);
  const kinds = new Uint8Array(n + 1);
  const lineToVertex = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) {
    lineToVertex[i] = i + 1;
    vertices[(i + 1) * 3] = (i % 100) / 2;
    vertices[(i + 1) * 3 + 1] = (i % 37) / 3;
    vertices[(i + 1) * 3 + 2] = -(i % 5);
    kinds[i + 1] = i % 97 === 0 ? SEGMENT.BREAK : (i % 3) + 1;
  }
  lineToVertex[n] = n + 1;
  return { vertices, kinds, lineToVertex };
}

export interface FakeGl {
  readonly gl: WebGL2RenderingContext;
  readonly calls: Map<string, number>;
  readonly uploads: ArrayBufferView[];
  /** Live buffer objects (created minus deleted). */
  live(): number;
}

/** A WebGL2 context that records calls and draws nothing. */
export function fakeGl(): FakeGl {
  const calls = new Map<string, number>();
  const uploads: ArrayBufferView[] = [];
  let created = 0;
  let deleted = 0;
  const canvas = { width: 0, height: 0 };
  const target: Record<string, unknown> = {
    canvas,
    drawingBufferWidth: 300,
    drawingBufferHeight: 150,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    createBuffer: () => { created++; return {}; },
    deleteBuffer: () => { deleted++; },
    bufferData: (_t: number, data: ArrayBufferView) => { uploads.push(data); },
  };
  const gl = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) {
        const value = t[prop];
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          calls.set(prop, (calls.get(prop) ?? 0) + 1);
          return (value as (...a: unknown[]) => unknown)(...args);
        };
      }
      if (/^[A-Z_0-9]+$/.test(prop)) return 1;
      return (..._args: unknown[]) => {
        calls.set(prop, (calls.get(prop) ?? 0) + 1);
        return {};
      };
    },
  }) as unknown as WebGL2RenderingContext;
  return { gl, calls, uploads, live: () => created - deleted };
}

/** A frame queue the test runs by hand. */
export function frameQueue(): { request: (draw: () => void) => void; flush: () => number; readonly pending: number } {
  let queue: Array<() => void> = [];
  return {
    request: (draw) => { queue.push(draw); },
    flush: () => {
      const q = queue;
      queue = [];
      for (const d of q) d();
      return q.length;
    },
    get pending() {
      return queue.length;
    },
  };
}

export const COLORS = {
  background: [1, 1, 1, 1], rapid: [0, 0, 1, 1], feed: [0, 0, 0, 1], arc: [0, 0.3, 0, 1], outOfBounds: [1, 0, 0, 1],
  uncertain: [0.5, 0.5, 0.5, 1], highlight: [1, 0.6, 0, 1], envelope: [0.2, 0.2, 0.2, 1], axisX: [1, 0, 0, 1], axisY: [0, 1, 0, 1], axisZ: [0, 0, 1, 1],
  grid: [0.9, 0.9, 0.9, 1], gridMajor: [0.8, 0.8, 0.8, 1],
} as const;
