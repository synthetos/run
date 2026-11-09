/**
 * Keeps icon-button tips inside the viewport (owner, 2026-11-09: the side column's tips ran off the right edge). The
 * tip itself is CSS (`button.icon-btn[data-tip]::after`); this measures the button when the pointer or focus reaches it
 * and sets where the tip goes: a left offset that keeps its whole width on screen, its width limit, and above or below.
 * CSSOM only (no style attribute in markup), so the page's CSP is unchanged.
 */
const TIP_MAX = 240;
const EDGE = 8;
const TIP_ROOM_BELOW = 96;

export interface TipPlace {
  readonly left: number;
  readonly width: number;
  readonly above: boolean;
}

/** The box a tip must stay in: the viewport, narrowed to the nearest ancestor that clips (a scrolling side column). */
export interface TipBounds {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
}

/** Where a tip for a button at `rect` goes inside `bounds`: offsets relative to the button. Pure. */
export function tipPlace(rect: { readonly left: number; readonly bottom: number }, bounds: TipBounds): TipPlace {
  const room = bounds.right - bounds.left - 2 * EDGE;
  const width = Math.max(120, Math.min(TIP_MAX, room));
  const start = Math.max(bounds.left + EDGE, Math.min(rect.left, bounds.right - EDGE - width));
  return { left: Math.round(start - rect.left), width, above: bounds.bottom - rect.bottom < TIP_ROOM_BELOW };
}

function bounds(el: Element): TipBounds {
  let box: TipBounds = { left: 0, right: window.innerWidth, bottom: window.innerHeight };
  for (let p = el.parentElement; p !== null; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      const r = p.getBoundingClientRect();
      box = { left: Math.max(box.left, r.left), right: Math.min(box.right, r.right), bottom: Math.min(box.bottom, r.bottom) };
      break;
    }
  }
  return box;
}

function place(target: EventTarget | null): void {
  const button = target instanceof Element ? target.closest('button.icon-btn[data-tip]') : null;
  if (!(button instanceof HTMLElement)) return;
  const p = tipPlace(button.getBoundingClientRect(), bounds(button));
  button.style.setProperty('--tip-left', `${p.left}px`);
  button.style.setProperty('--tip-width', `${p.width}px`);
  button.dataset['tipPlaced'] = p.above ? 'above' : 'below';
}

/** Once per page: places a tip as the pointer or focus reaches its button. */
export function installTipPlacement(doc: Document): void {
  const on = (e: Event): void => place(e.target);
  doc.addEventListener('pointerover', on, { capture: true, passive: true });
  doc.addEventListener('focusin', on, { capture: true });
}
