/**
 * The 3D view's frame budget (render-budget, 2026-11-10). On a computer without GPU acceleration (a VM, a blocked
 * GPU, headless Chrome) the software WebGL renderer held the main thread about 0.7 s per frame during a job, so a
 * click on Pause or Stop job waited behind a frame. This scheduler is the renderer's `requestFrame`:
 *
 * - **On demand only.** Nothing is drawn unless something asked (the camera, the tool position, the carve, the path
 *   colours); several asks before a frame draw once. There is no loop while idle.
 * - **A cap during a job.** At most `JOB_FPS` frames a second while a job runs.
 * - **Light mode.** A software renderer (detected by name), or two frames in a row that took longer than
 *   `SLOW_FRAME_MS`, switch to light mode for the rest of the page: `LIGHT_JOB_FPS` frames a second during a job,
 *   `LIGHT_IDLE_FPS` otherwise, and a lower drawing resolution (`scale`) that steps down while frames stay slow.
 *
 * A frame's cost is measured from its start to a task queued right after it (a MessageChannel message), so the
 * browser's own commit and read-back of the canvas, which run after the frame callback, count too.
 *
 * Pure: the clock and the frame hooks are passed in. The stop path never waits on it (workspace/pressAction.ts).
 */

/** Frames a second while a job runs, on a renderer that keeps up. */
export const JOB_FPS = 12;
/** Light mode: frames a second while a job runs. */
export const LIGHT_JOB_FPS = 2;
/** Light mode: at most this many frames a second otherwise (turning the view stays usable). */
export const LIGHT_IDLE_FPS = 10;
/** A frame slower than this counts as slow; two in a row turn light mode on, or step the resolution down. */
export const SLOW_FRAME_MS = 50;
/** The drawing resolution steps (a fraction of the device pixel ratio). Light mode starts at the second. */
export const SCALES: readonly number[] = [1, 0.5, 0.35, 0.25];

export interface FrameClock {
  now(): number;
  /** Runs `cb` at the next frame (requestAnimationFrame). */
  frame(cb: () => void): void;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Runs `cb` as a task after the current frame has been drawn and committed. */
  afterFrame(cb: () => void): void;
  /** Releases what the clock holds (its message channel). */
  dispose?(): void;
}

export type LightReason = 'software' | 'slow';

export interface BudgetState {
  readonly light: LightReason | null;
  /** The drawing resolution, a fraction of the device pixel ratio. */
  readonly scale: number;
  /** The last measured frame cost in ms, or null before the first frame. */
  readonly costMs: number | null;
}

export interface FrameBudgetOptions {
  /** The renderer is a software one (rendererKind.ts). */
  readonly software: boolean;
  /** Called when `light` or `scale` changes. */
  readonly onChange?: (state: BudgetState) => void;
  /** Called with each frame's measured cost, ms (diagnostics). */
  readonly onFrame?: (costMs: number) => void;
}

export class FrameBudget {
  readonly #clock: FrameClock;
  readonly #onChange: ((state: BudgetState) => void) | undefined;
  readonly #onFrame: ((costMs: number) => void) | undefined;
  #light: LightReason | null;
  #scaleIndex: number;
  #costMs: number | null = null;
  #slowRun = 0;
  #job = false;
  #pending = false;
  #timer: unknown = null;
  #lastStart = Number.NEGATIVE_INFINITY;
  #draw: (() => void) | null = null;
  #disposed = false;
  /** Frames drawn (tests and diagnostics). */
  drawn = 0;

  constructor(clock: FrameClock, options: FrameBudgetOptions) {
    this.#clock = clock;
    this.#onChange = options.onChange;
    this.#onFrame = options.onFrame;
    this.#light = options.software ? 'software' : null;
    this.#scaleIndex = options.software ? 1 : 0;
  }

  get state(): BudgetState {
    return { light: this.#light, scale: SCALES[this.#scaleIndex] ?? 1, costMs: this.#costMs };
  }

  /** The shortest time between two frame starts now, in ms (0: the next frame). */
  get intervalMs(): number {
    if (this.#light !== null) return 1000 / (this.#job ? LIGHT_JOB_FPS : LIGHT_IDLE_FPS);
    return this.#job ? 1000 / JOB_FPS : 0;
  }

  /** The renderer's `requestFrame`: one frame for any number of asks, never sooner than the budget allows. */
  readonly requestFrame = (draw: () => void): void => {
    this.#draw = draw;
    if (this.#pending || this.#disposed) return;
    this.#pending = true;
    const wait = this.#lastStart + this.intervalMs - this.#clock.now();
    if (wait > 0) {
      this.#timer = this.#clock.setTimeout(() => {
        this.#timer = null;
        this.#clock.frame(this.#run);
      }, wait);
    } else {
      this.#clock.frame(this.#run);
    }
  };

  setJobRunning(running: boolean): void {
    this.#job = running;
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#timer !== null) this.#clock.clearTimeout(this.#timer);
    this.#timer = null;
    this.#draw = null;
    this.#clock.dispose?.();
  }

  readonly #run = (): void => {
    this.#pending = false;
    const draw = this.#draw;
    if (this.#disposed || draw === null) return;
    const start = this.#clock.now();
    this.#lastStart = start;
    this.drawn++;
    draw();
    this.#clock.afterFrame(() => { this.#measured(this.#clock.now() - start); });
  };

  #measured(cost: number): void {
    if (this.#disposed) return;
    this.#costMs = cost;
    this.#onFrame?.(cost);
    this.#slowRun = cost > SLOW_FRAME_MS ? this.#slowRun + 1 : 0;
    if (this.#slowRun < 2) return;
    this.#slowRun = 0;
    if (this.#light === null) {
      this.#light = 'slow';
      this.#scaleIndex = Math.max(this.#scaleIndex, 1);
    } else if (this.#scaleIndex < SCALES.length - 1) {
      this.#scaleIndex++;
    } else {
      return;
    }
    this.#onChange?.(this.state);
  }
}

/** The browser's clock and frame hooks. */
export function browserFrameClock(): FrameClock {
  const channel = new MessageChannel();
  const queue: (() => void)[] = [];
  channel.port1.onmessage = () => { queue.shift()?.(); };
  return {
    now: () => performance.now(),
    frame: (cb) => { requestAnimationFrame(() => cb()); },
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (handle) => { clearTimeout(handle as ReturnType<typeof setTimeout>); },
    afterFrame: (cb) => {
      queue.push(cb);
      channel.port2.postMessage(null);
    },
    dispose: () => {
      channel.port1.close();
      channel.port2.close();
      queue.length = 0;
    },
  };
}
