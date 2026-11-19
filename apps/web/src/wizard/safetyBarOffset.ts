/**
 * W1 stays on screen while the wizard is up (OD-9: the one warning always visible; review 2026-11-18). The wizard's
 * scrim, its full-screen frame below 1024 px, the catalog page and the dialogs it hosts all start below the safety
 * bar: this measures where the bar ends and sets `--wizard-top` on the wizard's root (wizard.css reads it), and
 * follows the bar when it wraps or resizes. Like entries/update.ts does for the update page.
 */
let observer: ResizeObserver | null = null;

/** The wizard root's ref: measure on mount, follow the bar's size, stop on unmount. */
export function trackSafetyBar(root: HTMLElement | null): void {
  observer?.disconnect();
  observer = null;
  if (root === null || typeof document === 'undefined') return;
  const bar = document.querySelector<HTMLElement>('[data-region="safety-bar"]');
  if (bar === null) return;
  const measure = (): void => root.style.setProperty('--wizard-top', `${Math.max(0, Math.round(bar.getBoundingClientRect().bottom))}px`);
  measure();
  if (typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(measure);
  observer.observe(bar);
}
