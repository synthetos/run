/**
 * The drag handle on the dock's top edge (owner, 2026-11-09: "the terminal needs room"). Drag it, or focus it and
 * press ↑ or ↓, to make the panel taller or shorter; Home and End go to the minimum and the maximum. A separator in
 * the accessibility tree, with its value in pixels. Presentation only.
 */
import { h, type ComponentChild } from 'preact';
import { useRef } from 'preact/hooks';
import { DOCK_MIN_PX, DOCK_STEP_PX } from './dockSize.ts';

export interface DockResizerProps {
  /** The panel's height now, px. */
  readonly height: number;
  readonly max: number;
  /** A new height the user asked for (the dock clamps and remembers it). */
  readonly onResize: (px: number) => void;
}

export function DockResizer({ height, max, onResize }: DockResizerProps): ComponentChild {
  const drag = useRef<{ readonly y: number; readonly h: number } | null>(null);
  return h('div', {
    class: 'dock-resizer',
    role: 'separator',
    tabindex: 0,
    'aria-orientation': 'horizontal',
    'aria-label': 'Panel height: drag, or press the up and down arrows',
    'aria-valuemin': DOCK_MIN_PX,
    'aria-valuemax': max,
    'aria-valuenow': Math.round(height),
    'data-dock': 'resizer',
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { y: e.clientY, h: height };
      e.preventDefault();
    },
    onPointerMove: (e: PointerEvent) => {
      const d = drag.current;
      // Dragging up makes the panel taller.
      if (d !== null) onResize(d.h + (d.y - e.clientY));
    },
    onPointerUp: () => {
      drag.current = null;
    },
    onPointerCancel: () => {
      drag.current = null;
    },
    onKeyDown: (e: KeyboardEvent) => {
      const step = e.shiftKey ? DOCK_STEP_PX * 3 : DOCK_STEP_PX;
      const next = e.key === 'ArrowUp' ? height + step : e.key === 'ArrowDown' ? height - step : e.key === 'Home' ? DOCK_MIN_PX : e.key === 'End' ? max : null;
      if (next === null) return;
      e.preventDefault();
      onResize(next);
    },
  });
}
