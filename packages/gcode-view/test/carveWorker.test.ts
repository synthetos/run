/**
 * The carve worker protocol (carve/worker.ts, carve/client.ts): file, setup and seek in, progress with the
 * changed cells out; a newer session drops older messages; the page's copy of the heightmap ends equal to
 * the worker's.
 */
import { describe, expect, it } from 'vitest';
import { SEGMENT, createCarveClient, createCarveHandler, createCarver, type CarveProgressMessage, type CarveWorkerLike, type FromCarveWorker, type GridSpec, type ToCarveWorker, type ToolShape } from '../src/index.ts';
import { listOf } from './helpers.ts';

const SPEC: GridSpec = { x0: 0, y0: 0, cell: 0.5, nx: 40, ny: 40, top: 0, bottom: -6, outline: null };
const FLAT: ToolShape = { tip: 'flat', diameter: 2, fluteLength: 10, shank: 2, length: 30 };
const TOOLS = { starts: Uint32Array.from([0]), shapes: [FLAT] };
const LIST = listOf(Array.from({ length: 50 }, (_, k) => [[SEGMENT.RAPID, 2, k % 20, -1], [SEGMENT.FEED, 18, k % 20, -1 - k / 50]] as const));
const SEGMENTS = { vertices: LIST.vertices, kinds: LIST.kinds, lineToVertex: LIST.lineToVertex };

/** A handler whose slices run when the test says, with a clock that gives each slice one step. */
function harness(): { send: (m: ToCarveWorker) => void; out: FromCarveWorker[]; run: () => void } {
  const out: FromCarveWorker[] = [];
  const queue: (() => void)[] = [];
  let t = 0;
  const send = createCarveHandler((m) => { out.push(m); }, { yieldNext: (fn) => { queue.push(fn); }, now: () => (t += 100), stepBudget: 10 });
  return { send, out, run: () => { while (queue.length > 0) queue.shift()?.(); } };
}

const progress = (out: FromCarveWorker[]): CarveProgressMessage[] => out.filter((m): m is CarveProgressMessage => m.type === 'progress');

describe('createCarveHandler', () => {
  it('carves to the target in slices, posting the changed cells', () => {
    const h = harness();
    h.send({ type: 'file', segments: SEGMENTS });
    h.send({ type: 'setup', session: 1, spec: SPEC, tools: TOOLS });
    h.send({ type: 'seek', session: 1, target: 50 });
    h.run();
    const p = progress(h.out);
    expect(p.length).toBeGreaterThan(1);
    expect(p.every((m) => m.session === 1)).toBe(true);
    const last = p[p.length - 1] as CarveProgressMessage;
    expect(last).toMatchObject({ through: 50, target: 50, done: true });
    expect(last.lowest).toBeCloseTo(-1 - 49 / 50, 5);
    for (const m of p) if (m.rect !== null) expect(m.data?.length).toBe(m.rect.w * m.rect.h);
  });

  it('answers a seek back with the whole grid restored, and ignores another session', () => {
    const h = harness();
    h.send({ type: 'file', segments: SEGMENTS });
    h.send({ type: 'setup', session: 1, spec: SPEC, tools: TOOLS });
    h.send({ type: 'seek', session: 1, target: 50 });
    h.run();
    h.out.length = 0;
    h.send({ type: 'seek', session: 0, target: 10 });
    h.run();
    expect(h.out).toEqual([]);
    h.send({ type: 'seek', session: 1, target: 10 });
    h.run();
    const first = progress(h.out)[0];
    expect(first?.rect).toEqual({ x: 0, y: 0, w: 40, h: 40 });
    expect(progress(h.out).at(-1)).toMatchObject({ through: 10, done: true });
  });

  it('reports a target already reached', () => {
    const h = harness();
    h.send({ type: 'file', segments: SEGMENTS });
    h.send({ type: 'setup', session: 2, spec: SPEC, tools: TOOLS });
    h.send({ type: 'seek', session: 2, target: 0 });
    h.run();
    expect(progress(h.out)).toEqual([{ type: 'progress', session: 2, rect: null, data: null, through: 0, target: 0, done: true, lowest: 0 }]);
  });

  it('carves nothing without a grid or a file', () => {
    const h = harness();
    h.send({ type: 'setup', session: 1, spec: SPEC, tools: TOOLS });
    h.send({ type: 'seek', session: 1, target: 5 });
    h.send({ type: 'file', segments: SEGMENTS });
    h.send({ type: 'setup', session: 2, spec: null, tools: TOOLS });
    h.send({ type: 'seek', session: 2, target: 5 });
    h.run();
    expect(h.out).toEqual([]);
  });
});

describe('createCarveClient', () => {
  /** A worker that runs the handler in the same thread. */
  function inline(): { spawn: () => CarveWorkerLike; run: () => void; terminated: () => number } {
    const queue: (() => void)[] = [];
    let terminated = 0;
    const spawn = (): CarveWorkerLike => {
      const w: CarveWorkerLike = {
        onmessage: null,
        onerror: null,
        postMessage: (m) => { handle(m); },
        terminate: () => { terminated++; },
      };
      const handle = createCarveHandler((m) => { w.onmessage?.({ data: m } as MessageEvent<FromCarveWorker>); }, { yieldNext: (fn) => { queue.push(fn); } });
      return w;
    };
    return { spawn, run: () => { while (queue.length > 0) queue.shift()?.(); }, terminated: () => terminated };
  }

  it('keeps a copy of the heightmap equal to the worker carve, and tells its listeners', () => {
    const w = inline();
    const client = createCarveClient(w.spawn);
    const seen = { surfaces: 0, patches: 0, last: null as null | { through: number; done: boolean } };
    client.subscribe({ surface: () => { seen.surfaces++; }, patch: () => { seen.patches++; }, progress: (p) => { seen.last = p; } });
    expect(seen.surfaces).toBe(1);
    client.setFile(LIST);
    client.setup(SPEC, TOOLS);
    client.seek(30);
    w.run();
    expect(seen.surfaces).toBe(2);
    expect(seen.patches).toBeGreaterThan(0);
    expect(seen.last).toMatchObject({ through: 30, done: true });
    const ref = createCarver(LIST, SPEC, TOOLS);
    ref.seek(30);
    while (!ref.step(1e9).done);
    expect(client.surface?.z).toEqual(ref.heightmap.z);
    // Back, then forward again.
    client.seek(5);
    w.run();
    ref.seek(5);
    while (!ref.step(1e9).done);
    expect(client.surface?.z).toEqual(ref.heightmap.z);
    client.dispose();
    expect(w.terminated()).toBe(1);
    expect(client.surface).toBeNull();
  });

  it('starts a new surface for each setup and drops the older session', () => {
    const w = inline();
    const client = createCarveClient(w.spawn);
    client.setFile(LIST);
    client.setup(SPEC, TOOLS);
    const first = client.surface;
    client.seek(50);
    client.setup(SPEC, { starts: Uint32Array.from([0]), shapes: [null] });
    client.seek(50);
    w.run();
    expect(client.surface).not.toBe(first);
    expect(client.surface?.session).toBe(2);
    // The second session's tool is unknown: nothing carved, whatever the first had posted.
    expect(client.surface?.z.every((v) => v === 0)).toBe(true);
    expect(client.progress).toMatchObject({ session: 2, through: 50, done: true });
  });

  it('starts no worker until there is something to carve', () => {
    let spawned = 0;
    const client = createCarveClient(() => {
      spawned++;
      return { onmessage: null, onerror: null, postMessage: () => undefined, terminate: () => undefined };
    });
    client.setFile(null);
    client.setup(null, TOOLS);
    client.seek(5);
    expect(spawned).toBe(0);
    client.setFile(LIST);
    expect(spawned).toBe(1);
  });

  it('reports a worker failure as stopped progress', () => {
    let worker: CarveWorkerLike | null = null;
    const client = createCarveClient(() => {
      worker = { onmessage: null, onerror: null, postMessage: () => undefined, terminate: () => undefined };
      return worker;
    });
    client.setup(SPEC, TOOLS);
    (worker as unknown as CarveWorkerLike).onerror?.({ message: 'boom', preventDefault: () => undefined } as ErrorEvent);
    expect(client.progress?.error).toBe('the carve worker failed: boom');
  });
});
