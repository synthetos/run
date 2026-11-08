/**
 * Pointer picking on a renderer canvas: hovering names the solid under the pointer, a click (a press and
 * release with under `CLICK_SLOP_PX` of travel, so an orbit or pan drag never counts) reports it. It reads
 * the view only and changes nothing; the view controls (controls.ts) still get every event.
 */
import { CLICK_SLOP_PX } from './pick.ts';
import type { PreviewRenderer } from './renderer.ts';

export interface PickHandlers {
  /** A click on a tagged solid. */
  readonly onPick: (tag: string) => void;
  /** The solid under a resting pointer (CSS pixels within the canvas), or null when there is none. */
  readonly onHover: (hit: { readonly tag: string; readonly x: number; readonly y: number } | null) => void;
}

export function attachPicking(canvas: HTMLCanvasElement, renderer: Pick<PreviewRenderer, 'pick'>, handlers: PickHandlers): () => void {
  let press: { x: number; y: number; travel: number; id: number } | null = null;
  const at = (e: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: PointerEvent): void => {
    press = e.button === 0 && !e.shiftKey ? { x: e.clientX, y: e.clientY, travel: 0, id: e.pointerId } : null;
    handlers.onHover(null);
  };
  const move = (e: PointerEvent): void => {
    if (press !== null && e.pointerId === press.id) {
      press.travel = Math.max(press.travel, Math.hypot(e.clientX - press.x, e.clientY - press.y));
      return;
    }
    if (e.buttons !== 0) return;
    const p = at(e);
    const tag = renderer.pick(p.x, p.y);
    handlers.onHover(tag === null ? null : { tag, x: p.x, y: p.y });
  };
  const up = (e: PointerEvent): void => {
    if (press === null || e.pointerId !== press.id) return;
    const travel = Math.max(press.travel, Math.hypot(e.clientX - press.x, e.clientY - press.y));
    press = null;
    if (travel >= CLICK_SLOP_PX) return;
    const p = at(e);
    const tag = renderer.pick(p.x, p.y);
    if (tag !== null) handlers.onPick(tag);
  };
  const cancel = (): void => { press = null; };
  const leave = (): void => { handlers.onHover(null); };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('pointerleave', leave);
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', cancel);
    canvas.removeEventListener('pointerleave', leave);
  };
}
