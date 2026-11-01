/**
 * Design tokens (ROADMAP P0-05): the CSS reader, the two dark blocks agree,
 * the copied theme tokens match synthetos.com at the pinned ref (drift), and
 * the contrast table holds and is current.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blocks, propertiesOf } from '../src/tokens/css.ts';
import { compareThemes, siteThemes } from '../src/tokens/drift.ts';
import { evaluate, MINIMUM, PAIRS, renderTable } from '../src/tokens/contrast.ts';
import { contrast, luminance, parseHex } from '../src/tokens/wcag.ts';
import { DARK_MEDIA_BLOCK, loadPin, loadThemes, readThemes, REPO_ROOT, TOKENS_CSS } from '../src/tokens/theme.ts';

const CSS = readFileSync(TOKENS_CSS, 'utf8');
const SAFETY_TOKENS = ['--danger', '--warn', '--live', '--state-run', '--state-hold', '--state-alarm'];

describe('css reader', () => {
  it('reads custom properties per block, through comments and nested at-rules', () => {
    const css = '/* a { --x: 1; } */ :root { --a: #fff; --b: "x; y"; color: red; } @media (x) { :root:not(.y) { --a: #000; } }';
    const found = blocks(css);
    expect(found.map((b) => b.path)).toEqual([[':root'], ['@media (x)'], ['@media (x)', ':root:not(.y)']]);
    expect([...propertiesOf(css, [':root'])]).toEqual([['--a', '#fff'], ['--b', '"x; y"']]);
    expect(propertiesOf(css, ['@media (x)', ':root:not(.y)']).get('--a')).toBe('#000');
  });

  it('refuses unbalanced braces, unterminated comments and a property declared twice', () => {
    expect(() => blocks(':root { --a: 1;')).toThrow(/unbalanced/);
    expect(() => blocks(':root { --a: 1; } }')).toThrow(/unbalanced/);
    expect(() => blocks('/* x')).toThrow(/unterminated comment/);
    expect(() => blocks(':root { --a: 1; --a: 2; }')).toThrow(/declared twice/);
    expect(() => propertiesOf(':root{} :root{}', [':root'])).toThrow(/exactly one block/);
  });
});

describe('tokens.css', () => {
  it('defines every safety token in both themes, and the safety bar tokens once for both', () => {
    const { light, dark } = loadThemes();
    for (const t of SAFETY_TOKENS) {
      expect(light.get(t), t).toMatch(/^#[0-9a-f]{6}$/);
      expect(dark.get(t), t).toMatch(/^#[0-9a-f]{6}$/);
      expect(dark.get(t), `${t} must differ between themes`).not.toBe(light.get(t));
    }
    const media = propertiesOf(CSS, DARK_MEDIA_BLOCK);
    for (const t of ['--bar-bg', '--bar-fg', '--stop-bg', '--on-stop', '--stop-mark', '--band-bg', '--band-fg', '--hazard-dark', '--hazard-light']) {
      expect(light.get(t), t).toBeDefined();
      expect(media.has(t), `${t} is the same in both themes`).toBe(false);
    }
  });

  it('never uses the theme pencil-blue for a safety colour', () => {
    const { light, dark } = loadThemes();
    const blues = new Set([light.get('--blue'), light.get('--blue-dk'), dark.get('--blue'), dark.get('--blue-dk')]);
    for (const theme of [light, dark]) {
      for (const [name, value] of theme) {
        if (SAFETY_TOKENS.includes(name) || /^--(bar|band|stop|on-stop|hazard)/.test(name)) expect(blues.has(value), name).toBe(false);
      }
    }
  });

  it('the OS-driven and toggle-driven dark blocks must stay identical', () => {
    expect(() => readThemes(CSS)).not.toThrow();
    const broken = CSS.replace(':root[data-theme="dark"] {\n  /* 1. Theme tokens, dark (site src/themes/dark.css). */\n  --paper: #0d161d;', ':root[data-theme="dark"] {\n  /* 1. Theme tokens, dark (site src/themes/dark.css). */\n  --paper: #0d161e;');
    expect(broken).not.toBe(CSS);
    expect(() => readThemes(broken)).toThrow(/differ/);
  });
});

describe('token drift against synthetos.com', () => {
  const pin = loadPin();

  it('pins a full commit SHA and the tokens RUN_PLAN §7.1 names', () => {
    expect(pin.ref).toMatch(/^[0-9a-f]{40}$/);
    expect(pin.repository).toBe('synthetos/synthetos.com');
    expect([...pin.copied].sort()).toEqual(
      ['--paper', '--sheet', '--ink', '--muted', '--rule', '--grid', '--field', '--blue', '--blue-dk', '--blue-wash', '--on-blue', '--ok', '--sans', '--cond', '--mono'].sort(),
    );
  });

  /** A site whose stylesheets carry exactly run's copied values. */
  function siteFrom(themes: ReturnType<typeof loadThemes>): { light: string; dark: string } {
    const light = pin.copied.map((t) => `${t}: ${themes.light.get(t) ?? ''};`).join('\n');
    const dark = pin.copied.filter((t) => themes.dark.get(t) !== themes.light.get(t)).map((t) => `${t}: ${themes.dark.get(t) ?? ''};`).join('\n');
    return { light: `:root {\n${light}\n--foot-bg: #000;\n}\n.x { color: red; }`, dark: `[data-theme="dark"] {\n${dark}\n}` };
  }

  it('reports no drift when the site carries the same values', () => {
    const run = loadThemes();
    expect(compareThemes(pin, siteThemes(pin, siteFrom(run)), run)).toEqual([]);
  });

  it('reports a changed value, per theme', () => {
    const run = loadThemes();
    const site = siteFrom(run);
    const moved = { light: site.light.replace(`--blue: ${run.light.get('--blue')};`, '--blue: #123456;'), dark: site.dark.replace(`--ok: ${run.dark.get('--ok')};`, '--ok: #00ff00;') };
    expect(compareThemes(pin, siteThemes(pin, moved), run)).toEqual([
      { theme: 'light', token: '--blue', site: '#123456', run: run.light.get('--blue') },
      { theme: 'dark', token: '--ok', site: '#00ff00', run: run.dark.get('--ok') },
    ]);
  });

  it('reports a token the site no longer defines', () => {
    const run = loadThemes();
    const site = siteFrom(run);
    const drift = compareThemes(pin, siteThemes(pin, { light: site.light.replace(/--field: [^;]+;/, ''), dark: site.dark.replace(/--field: [^;]+;/, '') }), run);
    expect(drift.map((d) => `${d.theme} ${d.token} ${String(d.site)}`)).toEqual(['light --field undefined', 'dark --field undefined']);
  });

  // The real comparison needs a clone of synthetos.com; run it with
  // RUN_SITE_REPO=<path> or `pnpm tokens:drift --site <path>` (docs/design/tokens.md).
  it.skipIf(process.env['RUN_SITE_REPO'] === undefined)('matches the site repository at the pinned ref', async () => {
    const { execFileSync } = await import('node:child_process');
    const site = process.env['RUN_SITE_REPO'] as string;
    const show = (file: string): string => execFileSync('git', ['-C', site, 'show', `${pin.ref}:${file}`], { encoding: 'utf8' });
    expect(compareThemes(pin, siteThemes(pin, { light: show(pin.light.file), dark: show(pin.dark.file) }), loadThemes())).toEqual([]);
  });
});

describe('contrast table', () => {
  it('uses the WCAG formula', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(luminance('#000000')).toBe(0);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(() => parseHex('red')).toThrow();
  });

  it('every pair meets its minimum in both themes (4.5:1 text, 3:1 non-text)', () => {
    const rows = evaluate(loadThemes());
    expect(rows).toHaveLength(PAIRS.length * 2);
    expect(rows.filter((r) => !r.pass).map((r) => `${r.theme} ${r.fg} on ${r.pair.bg}: ${r.ratio}`)).toEqual([]);
    for (const t of SAFETY_TOKENS) {
      for (const theme of ['light', 'dark'] as const) {
        const row = rows.find((r) => r.theme === theme && r.fg === t && r.pair.bg === '--sheet');
        expect(row?.ratio, `${theme} ${t}`).toBeGreaterThanOrEqual(MINIMUM.text);
      }
    }
  });

  it('fails a safety colour that is too light', () => {
    const weak = CSS.replace('--danger: #b3261e;', '--danger: #f08080;');
    const rows = evaluate(readThemes(weak));
    expect(rows.filter((r) => !r.pass).map((r) => `${r.theme} ${r.fg}`)).toContain('light --danger');
  });

  it('the committed docs/design/contrast.md is current (pnpm gen:contrast)', () => {
    expect(readFileSync(join(REPO_ROOT, 'docs/design/contrast.md'), 'utf8')).toBe(renderTable(evaluate(loadThemes())));
  });
});
