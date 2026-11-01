/**
 * The light/dark theme toggle (RUN_PLAN §7.1: "following the site's toggle
 * and prefers-color-scheme").
 *
 * With no stored choice the page follows the operating system through CSS
 * alone (tokens.css). The toggle stores an explicit choice in this browser
 * and sets `data-theme` on <html>. Storage can be missing or throw (private
 * windows, blocked site data); the page then still works and simply follows
 * the OS. The theme never touches the safety bar tokens.
 */

export type Theme = 'light' | 'dark';

/** The key of the stored choice in localStorage (this origin only). */
export const THEME_KEY = 'run.theme';

/** The subset of the DOM this module uses, so it can be tested without a browser. */
export interface ThemeHost {
  readonly documentElement: { getAttribute(name: string): string | null; setAttribute(name: string, value: string): void };
  querySelectorAll(selector: string): Iterable<{ addEventListener(type: 'click', fn: () => void): void }>;
}
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark';

/** The stored choice, or `null` when there is none, it is invalid, or storage is unavailable. */
export function storedTheme(storage: () => StorageLike): Theme | null {
  try {
    const value = storage().getItem(THEME_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

/** The theme the page shows now: an explicit `data-theme`, else the OS preference. */
export function currentTheme(host: ThemeHost, prefersDark: () => boolean): Theme {
  const attr = host.documentElement.getAttribute('data-theme');
  if (isTheme(attr)) return attr;
  return prefersDark() ? 'dark' : 'light';
}

/** Applies a stored choice, if any. Call once at start-up. */
export function applyStoredTheme(host: ThemeHost, storage: () => StorageLike): void {
  const theme = storedTheme(storage);
  if (theme !== null) host.documentElement.setAttribute('data-theme', theme);
}

/** Switches to the other theme and stores the choice (best effort). Returns the new theme. */
export function toggleTheme(host: ThemeHost, storage: () => StorageLike, prefersDark: () => boolean): Theme {
  const next: Theme = currentTheme(host, prefersDark) === 'dark' ? 'light' : 'dark';
  host.documentElement.setAttribute('data-theme', next);
  try {
    storage().setItem(THEME_KEY, next);
  } catch {
    // Storage is unavailable: the choice lasts for this page only.
  }
  return next;
}

/** Wires every `[data-theme-toggle]` button on the page. */
export function wireThemeToggle(host: ThemeHost, storage: () => StorageLike, prefersDark: () => boolean): void {
  for (const button of host.querySelectorAll('[data-theme-toggle]')) {
    button.addEventListener('click', () => {
      toggleTheme(host, storage, prefersDark);
    });
  }
}

/** The browser bindings of the functions above. */
export function startTheme(): void {
  const storage = (): StorageLike => globalThis.localStorage;
  const prefersDark = (): boolean => globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
  applyStoredTheme(document, storage);
  wireThemeToggle(document, storage, prefersDark);
}
