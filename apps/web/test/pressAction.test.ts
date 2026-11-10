/** Pause and Stop job act on the press, once (render-budget, 2026-11-10). */
import { beforeEach, describe, expect, it } from 'vitest';
import { PRESS_CLICK_MS, pressHandlers, resetPresses } from '../src/workspace/pressAction.ts';

const down = (over: Partial<PointerEvent> = {}): PointerEvent => ({ button: 0, isPrimary: true, ...over }) as PointerEvent;
const click = (detail: number): MouseEvent => ({ detail }) as MouseEvent;

describe('pressHandlers', () => {
  beforeEach(() => resetPresses());

  it('acts on the press; the click that follows does not act again, even after a re-render made new handlers', () => {
    let t = 0;
    let n = 0;
    pressHandlers('pause', () => n++, () => t).onPointerDown(down());
    expect(n).toBe(1);
    t += 120;
    pressHandlers('pause', () => n++, () => t).onClick(click(1));
    expect(n).toBe(1);
  });

  it('a keyboard click (no press) acts; a pointer click long after its press acts; other buttons and touches pass', () => {
    let t = 0;
    let n = 0;
    const h = pressHandlers('stop-job', () => n++, () => t);
    h.onClick(click(0));
    expect(n).toBe(1);
    // A click with no event at all (a programmatic one) acts too.
    h.onClick();
    expect(n).toBe(2);
    n = 1;
    h.onPointerDown(down({ button: 2 }));
    h.onPointerDown(down({ isPrimary: false }));
    expect(n).toBe(1);
    h.onPointerDown(down());
    t += PRESS_CLICK_MS + 1;
    h.onClick(click(1));
    expect(n).toBe(3);
    // A press on one control never swallows another control's click.
    pressHandlers('pause', () => n++, () => t).onPointerDown(down());
    pressHandlers('stop-job', () => n++, () => t).onClick(click(1));
    expect(n).toBe(5);
  });
});
