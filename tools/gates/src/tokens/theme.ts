/**
 * The run theme as data: the light and dark token sets of
 * apps/web/src/styles/tokens.css, and the pin of the synthetos.com ref the
 * theme tokens were copied from (ROADMAP P0-05). Dependency-free.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { propertiesOf } from './css.ts';

export const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
export const TOKENS_CSS = join(REPO_ROOT, 'apps/web/src/styles/tokens.css');
export const TOKENS_PIN = join(REPO_ROOT, 'apps/web/src/styles/tokens.pin.json');

/** Selector paths of the three token blocks in tokens.css. */
export const LIGHT_BLOCK = [':root'];
export const DARK_MEDIA_BLOCK = ['@media (prefers-color-scheme: dark)', ':root:not([data-theme="light"])'];
export const DARK_TOGGLE_BLOCK = [':root[data-theme="dark"]'];

export type ThemeName = 'light' | 'dark';
export type Tokens = ReadonlyMap<string, string>;

export interface Themes {
  readonly light: Tokens;
  /** Light tokens overridden by the dark block, as the browser resolves them. */
  readonly dark: Tokens;
}

/**
 * Reads both themes. Throws unless the OS-driven and toggle-driven dark
 * blocks declare exactly the same properties with the same values.
 */
export function readThemes(css: string): Themes {
  const light = propertiesOf(css, LIGHT_BLOCK);
  const media = propertiesOf(css, DARK_MEDIA_BLOCK);
  const toggle = propertiesOf(css, DARK_TOGGLE_BLOCK);
  const a = JSON.stringify([...media]);
  const b = JSON.stringify([...toggle]);
  if (a !== b) throw new Error('tokens.css: the prefers-color-scheme dark block and the [data-theme="dark"] block differ');
  return { light, dark: new Map([...light, ...toggle]) };
}

export function loadThemes(): Themes {
  return readThemes(readFileSync(TOKENS_CSS, 'utf8'));
}

export interface TokenPin {
  readonly repository: string;
  readonly ref: string;
  readonly light: { readonly file: string; readonly selector: readonly string[] };
  readonly dark: { readonly file: string; readonly selector: readonly string[] };
  readonly copied: readonly string[];
}

export function loadPin(): TokenPin {
  const pin = JSON.parse(readFileSync(TOKENS_PIN, 'utf8')) as TokenPin;
  if (!/^[0-9a-f]{40}$/.test(pin.ref)) throw new Error(`tokens.pin.json: ref must be a full 40-character commit SHA, got ${pin.ref}`);
  return pin;
}
