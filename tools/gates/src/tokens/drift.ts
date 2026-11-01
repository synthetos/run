/**
 * Token drift (ROADMAP P0-05, RUN_PLAN §5.3: "Design tokens are copied, with
 * a drift test against the site repo at a pinned ref").
 *
 * Compares the theme tokens copied into apps/web/src/styles/tokens.css with
 * the synthetos.com stylesheets at the pinned ref, in both themes, as the
 * browser resolves them (dark = light overridden by the dark block).
 * Dependency-free; the CLI (drift-cli.ts) reads the site with `git show`.
 */
import { propertiesOf } from './css.ts';
import type { Themes, ThemeName, TokenPin } from './theme.ts';

export interface SiteSources {
  /** Contents of `pin.light.file` at the ref. */
  readonly light: string;
  /** Contents of `pin.dark.file` at the ref. */
  readonly dark: string;
}

export interface Drift {
  readonly theme: ThemeName;
  readonly token: string;
  readonly site: string | undefined;
  readonly run: string | undefined;
}

/** The site's two themes, resolved like the browser does. */
export function siteThemes(pin: TokenPin, site: SiteSources): Themes {
  const light = propertiesOf(site.light, pin.light.selector);
  const dark = propertiesOf(site.dark, pin.dark.selector);
  return { light, dark: new Map([...light, ...dark]) };
}

/** Every copied token whose value differs between the site and run, per theme. Empty means no drift. */
export function compareThemes(pin: TokenPin, site: Themes, run: Themes): Drift[] {
  const out: Drift[] = [];
  for (const theme of ['light', 'dark'] as const) {
    for (const token of pin.copied) {
      const s = site[theme].get(token);
      const r = run[theme].get(token);
      if (s === undefined || r === undefined || s !== r) out.push({ theme, token, site: s, run: r });
    }
  }
  return out;
}

export function formatDrift(drift: readonly Drift[]): string {
  return drift.map((d) => `  ${d.theme.padEnd(5)} ${d.token}: site ${d.site ?? '(missing)'} | run ${d.run ?? '(missing)'}`).join('\n');
}
