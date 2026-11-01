/**
 * Pointer, wheel and keyboard view controls for a renderer canvas: drag to
 * orbit, shift-drag or right-drag to pan, wheel to zoom; arrow keys orbit,
 * shift+arrows pan, + and - zoom, 0 fits. They change the view only.
 */
import type { PreviewRenderer } from './renderer.ts';

export function attachViewControls(canvas: HTMLCanvasElement, renderer: PreviewRenderer): () => void {
  let drag: { x: number; y: number; pan: boolean; id: number } | null = null;
  const down = (e: PointerEvent): void => {
    drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent): void => {
    if (drag === null || e.pointerId !== drag.id) return;
    const h = Math.max(1, canvas.clientHeight);
    const dx = (e.clientX - drag.x) / h;
    const dy = (e.clientY - drag.y) / h;
    drag = { ...drag, x: e.clientX, y: e.clientY };
    if (drag.pan) renderer.panBy(dx, dy);
    else renderer.orbit(-dx * Math.PI, dy * Math.PI);
  };
  const up = (e: PointerEvent): void => {
    if (drag !== null && e.pointerId === drag.id) drag = null;
  };
  const wheel = (e: WheelEvent): void => {
    e.preventDefault();
    renderer.zoomBy(Math.exp(e.deltaY * 0.001));
  };
  const key = (e: KeyboardEvent): void => {
    const step = Math.PI / 24;
    const handled = ((): boolean => {
      switch (e.key) {
        case 'ArrowLeft': if (e.shiftKey) renderer.panBy(-0.05, 0); else renderer.orbit(step, 0); return true;
        case 'ArrowRight': if (e.shiftKey) renderer.panBy(0.05, 0); else renderer.orbit(-step, 0); return true;
        case 'ArrowUp': if (e.shiftKey) renderer.panBy(0, -0.05); else renderer.orbit(0, step); return true;
        case 'ArrowDown': if (e.shiftKey) renderer.panBy(0, 0.05); else renderer.orbit(0, -step); return true;
        case '+': case '=': renderer.zoomBy(0.8); return true;
        case '-': renderer.zoomBy(1.25); return true;
        case '0': renderer.fit(); return true;
        default: return false;
      }
    })();
    if (handled) e.preventDefault();
  };
  const menu = (e: Event): void => { e.preventDefault(); };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('keydown', key);
  canvas.addEventListener('contextmenu', menu);
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('keydown', key);
    canvas.removeEventListener('contextmenu', menu);
  };
}
