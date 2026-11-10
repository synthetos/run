/**
 * The 3D view's frame budget (render-budget, 2026-11-10): on demand, capped during a job, light on a software or
 * slow renderer, with the frame cost measured to a task after the frame.
 */
import { describe, expect, it } from 'vitest';
import { FrameBudget, JOB_FPS, LIGHT_IDLE_FPS, LIGHT_JOB_FPS, SCALES, SLOW_FRAME_MS, type BudgetState, type FrameClock } from '../src/preview/frameBudget.ts';
import { isSoftwareRenderer, rendererName } from '../src/preview/rendererKind.ts';
import { lightText } from '../src/preview/Preview3D.ts';

/** A hand-driven clock: frames, timers and after-frame tasks run only when the test says. */
function fakeClock(): FrameClock & { t: number; frames: (() => void)[]; after: (() => void)[]; timers: { at: number; cb: () => void }[]; advance(ms: number): void; runFrame(costMs?: number): void; disposed: boolean } {
  const c = {
    t: 0,
    frames: [] as (() => void)[],
    after: [] as (() => void)[],
    timers: [] as { at: number; cb: () => void }[],
    disposed: false,
    now: () => c.t,
    frame: (cb: () => void) => { c.frames.push(cb); },
    setTimeout: (cb: () => void, ms: number) => { const t = { at: c.t + ms, cb }; c.timers.push(t); return t; },
    clearTimeout: (h: unknown) => { c.timers = c.timers.filter((t) => t !== h); },
    afterFrame: (cb: () => void) => { c.after.push(cb); },
    dispose: () => { c.disposed = true; },
    advance(ms: number) {
      c.t += ms;
      for (const t of c.timers.filter((x) => x.at <= c.t)) { c.timers = c.timers.filter((x) => x !== t); t.cb(); }
    },
    /** Runs the queued frame, the frame costing `costMs` (the clock moves on), then its after-frame task. */
    runFrame(costMs = 5) {
      const f = c.frames.shift();
      if (f === undefined) throw new Error('no frame queued');
      f();
      c.t += costMs;
      c.after.shift()?.();
    },
  };
  return c;
}

describe('FrameBudget', () => {
  it('draws only when asked: nothing queued while idle, many asks draw once, with the latest draw', () => {
    const clock = fakeClock();
    const budget = new FrameBudget(clock, { software: false });
    expect(clock.frames).toHaveLength(0);
    clock.advance(10_000);
    expect(clock.frames).toHaveLength(0);
    const drawn: string[] = [];
    budget.requestFrame(() => drawn.push('a'));
    budget.requestFrame(() => drawn.push('b'));
    budget.requestFrame(() => drawn.push('c'));
    expect(clock.frames).toHaveLength(1);
    clock.runFrame();
    expect(drawn).toEqual(['c']);
    expect(budget.drawn).toBe(1);
    expect(clock.frames).toHaveLength(0);
    // Idle and not light: the next ask draws at the next frame.
    budget.requestFrame(() => drawn.push('d'));
    expect(clock.frames).toHaveLength(1);
    expect(budget.intervalMs).toBe(0);
  });

  it(`caps a running job at ${JOB_FPS} fps: an ask right after a frame waits for the interval`, () => {
    const clock = fakeClock();
    const budget = new FrameBudget(clock, { software: false });
    budget.setJobRunning(true);
    expect(budget.intervalMs).toBeCloseTo(1000 / JOB_FPS);
    budget.requestFrame(() => {});
    clock.runFrame(5);
    budget.requestFrame(() => {});
    expect(clock.frames).toHaveLength(0);
    clock.advance(1000 / JOB_FPS - 5 - 1);
    expect(clock.frames).toHaveLength(0);
    clock.advance(1);
    expect(clock.frames).toHaveLength(1);
    budget.setJobRunning(false);
    expect(budget.intervalMs).toBe(0);
  });

  it(`a software renderer starts light: ${LIGHT_JOB_FPS} fps in a job, ${LIGHT_IDLE_FPS} fps otherwise, half resolution`, () => {
    const clock = fakeClock();
    const budget = new FrameBudget(clock, { software: true });
    expect(budget.state).toEqual({ light: 'software', scale: SCALES[1], costMs: null });
    expect(budget.intervalMs).toBe(1000 / LIGHT_IDLE_FPS);
    budget.setJobRunning(true);
    expect(budget.intervalMs).toBe(1000 / LIGHT_JOB_FPS);
  });

  it('two slow frames in a row turn light mode on; more slow frames step the resolution down to the floor', () => {
    const clock = fakeClock();
    const seen: BudgetState[] = [];
    const budget = new FrameBudget(clock, { software: false, onChange: (s) => seen.push(s) });
    const frame = (cost: number): void => {
      budget.requestFrame(() => {});
      clock.advance(10_000);
      clock.runFrame(cost);
    };
    frame(SLOW_FRAME_MS + 10);
    frame(10); // a fast frame in between resets the run
    frame(SLOW_FRAME_MS + 10);
    expect(budget.state.light).toBeNull();
    frame(SLOW_FRAME_MS + 10);
    expect(budget.state).toMatchObject({ light: 'slow', scale: SCALES[1], costMs: SLOW_FRAME_MS + 10 });
    for (let i = 0; i < 20; i++) frame(700);
    expect(budget.state.scale).toBe(SCALES[SCALES.length - 1]);
    expect(seen.map((s) => s.scale)).toEqual(SCALES.slice(1));
    expect(seen[0]?.light).toBe('slow');
  });

  it('dispose drops a waiting frame and releases the clock', () => {
    const clock = fakeClock();
    const budget = new FrameBudget(clock, { software: true });
    budget.setJobRunning(true);
    let drawn = 0;
    budget.requestFrame(() => drawn++);
    clock.runFrame();
    budget.requestFrame(() => drawn++);
    expect(clock.timers).toHaveLength(1);
    budget.dispose();
    expect(clock.timers).toHaveLength(0);
    expect(clock.disposed).toBe(true);
    clock.advance(10_000);
    expect(clock.frames).toHaveLength(0);
    expect(drawn).toBe(1);
  });
});

describe('the renderer kind and the light chip', () => {
  it('names the software renderers, and reads the unmasked name where the browser gives it', () => {
    for (const n of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Microsoft Basic Render Driver']) expect(isSoftwareRenderer(n), n).toBe(true);
    for (const n of ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 'NVIDIA GeForce RTX 3060/PCIe/SSE2', '']) expect(isSoftwareRenderer(n), n).toBe(false);
    const gl = { RENDERER: 1, getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 2 }), getParameter: (p: number) => (p === 2 ? 'SwiftShader' : 'WebKit WebGL') };
    expect(rendererName(gl as never)).toBe('SwiftShader');
    expect(rendererName({ ...gl, getExtension: () => null } as never)).toBe('WebKit WebGL');
    expect(rendererName({ ...gl, getExtension: () => { throw new Error('lost'); } } as never)).toBe('');
  });

  it('the chip says why, and nothing when the view is not light', () => {
    expect(lightText(null)).toBeNull();
    expect(lightText({ light: null, scale: 1, costMs: 4 })).toBeNull();
    expect(lightText({ light: 'software', scale: 0.5, costMs: null })).toBe('Light preview: this computer has no 3D acceleration');
    expect(lightText({ light: 'slow', scale: 0.5, costMs: 80 })).toBe('Light preview: 3D drawing is slow on this computer');
  });
});
