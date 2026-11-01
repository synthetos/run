/**
 * Cooperative time slicing for main-thread work (geometry upload): run steps
 * until the slice budget is spent, then yield to the browser and continue.
 * A step that starts is always finished, so the budget must leave room for
 * one step (a chunk of `DEFAULT_SEGMENTS_PER_CHUNK` segments takes a few
 * milliseconds).
 */

/** Below the 50 ms long-task threshold with margin for one step. */
export const DEFAULT_SLICE_BUDGET_MS = 12;

export interface SliceOptions {
  readonly budgetMs?: number;
  readonly signal?: AbortSignal;
  /** Clock in milliseconds (default `performance.now`). */
  readonly now?: () => number;
  /** Lets the browser run (default: a macrotask through `setTimeout(0)`). */
  readonly yieldToHost?: () => Promise<void>;
  /** Called after each slice with the number of steps done so far. */
  readonly onSlice?: (stepsDone: number) => void;
}

function abortError(): DOMException {
  return new DOMException('the preview load was cancelled', 'AbortError');
}

/**
 * Pulls `steps` to the end. Resolves with the number of steps run; rejects
 * with an `AbortError` as soon as `signal` aborts (checked before every step).
 */
export async function runSliced(steps: Iterator<unknown>, options: SliceOptions = {}): Promise<number> {
  const budget = options.budgetMs ?? DEFAULT_SLICE_BUDGET_MS;
  const now = options.now ?? (() => performance.now());
  const yieldToHost = options.yieldToHost ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  let done = 0;
  for (;;) {
    const start = now();
    do {
      if (options.signal?.aborted === true) throw abortError();
      if (steps.next().done === true) {
        options.onSlice?.(done);
        return done;
      }
      done++;
    } while (now() - start < budget);
    options.onSlice?.(done);
    await yieldToHost();
  }
}
