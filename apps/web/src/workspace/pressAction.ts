/**
 * Pause and Stop job act on pointerdown (render-budget, 2026-11-10). A click fires only on release, and a pointer
 * press that lands while the page draws a frame waits for it; acting on the press itself takes the release out of
 * the stop path. The stop path is synchronous from here (stopControls.ts posts to the worker), so nothing in it
 * waits for a frame either.
 *
 * The click that follows the press does not act a second time. A click with no press before it (the keyboard's
 * Enter or Space, assistive technology) still acts. The memory is per control key and outlives a re-render, which
 * the press itself usually causes.
 */
export interface PressHandlers {
  readonly onPointerDown: (event: PointerEvent) => void;
  /** A click with no event (a programmatic one) acts, like the keyboard's. */
  readonly onClick: (event?: MouseEvent) => void;
}

/** A click this soon after this control's press is the same press. */
export const PRESS_CLICK_MS = 1500;

const pressedAt = new Map<string, number>();

export function pressHandlers(key: string, action: () => void, now: () => number = () => performance.now()): PressHandlers {
  return {
    onPointerDown: (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      pressedAt.set(key, now());
      action();
    },
    onClick: (event) => {
      const at = pressedAt.get(key);
      pressedAt.delete(key);
      if ((event?.detail ?? 0) > 0 && at !== undefined && now() - at < PRESS_CLICK_MS) return;
      action();
    },
  };
}

/** Tests only: forget every press. */
export function resetPresses(): void {
  pressedAt.clear();
}
