/**
 * The dock's height (owner, 2026-11-09: "the terminal needs room"): what the user dragged it to, remembered in this
 * browser, kept between a minimum that still shows a few rows and a maximum that leaves the 3D view usable. With no
 * remembered height the stylesheet's own height applies, except that the Terminal opens at about 40% of the Job view.
 *
 * Storage can be missing or throw (a private window, blocked site data): the height then lasts for this page only.
 * Presentation only; nothing here touches the machine.
 */
import type { StorageLike } from '../storage.ts';

export const DOCK_HEIGHT_KEY = 'run.dock.height';
/** Lowest panel height, px: the tab content keeps a few rows. */
export const DOCK_MIN_PX = 96;
/** Highest share of the Job view the panel may take, so the drawing and the controls stay usable. */
export const DOCK_MAX_SHARE = 0.65;
/** The Terminal's share of the Job view when it opens at the default size. */
export const TERMINAL_SHARE = 0.4;
/** The 3D view keeps at least this much height beside a taller panel on a laptop (the stylesheet lowers its 280 to it). */
export const VIEWER_MIN_PX = 160;
/** One arrow-key step, px. */
export const DOCK_STEP_PX = 24;

function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The highest panel height for a Job view of `viewPx` (never below the minimum). */
export function dockMax(viewPx: number): number {
  return Math.max(DOCK_MIN_PX, Math.round(viewPx * DOCK_MAX_SHARE));
}

/** `px` kept within the minimum and the maximum for a Job view of `viewPx`, in whole pixels. */
export function clampDock(px: number, viewPx: number): number {
  return Math.round(Math.min(dockMax(viewPx), Math.max(DOCK_MIN_PX, px)));
}

/** The Terminal's opening height for a Job view of `viewPx`. */
export function terminalHeight(viewPx: number): number {
  return clampDock(viewPx * TERMINAL_SHARE, viewPx);
}

/** The remembered height, or null when none (or storage is unreadable or holds something else). */
export function loadDockHeight(storage: StorageLike | null = browserStorage()): number | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(DOCK_HEIGHT_KEY);
    const n = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(n) && n >= DOCK_MIN_PX && n <= 4000 ? Math.round(n) : null;
  } catch {
    return null;
  }
}

/** Remembers `px`; false when storage refused (then it lasts for this page only). */
export function saveDockHeight(px: number, storage: StorageLike | null = browserStorage()): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(DOCK_HEIGHT_KEY, String(Math.round(px)));
    return true;
  } catch {
    return false;
  }
}
