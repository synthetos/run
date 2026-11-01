/**
 * The installable app (ROADMAP P0-05, D38): the Web App Manifest, its icons
 * and theme colours, and the head tags every page carries. Chrome's own
 * installability verdict is asserted by tools/e2e (install.e2e.ts).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICON_COLOURS, ICONS, drawIcon } from '../src/icons/draw.ts';
import { decodePng, encodePng, pngSize } from '../src/icons/png.ts';
import { loadThemes, REPO_ROOT } from '../src/tokens/theme.ts';
import { HEAD_TAGS, THEME_COLOR } from '../../../apps/web/build/head.ts';

const PUBLIC = join(REPO_ROOT, 'apps/web/public');
interface Icon { src: string; sizes: string; type: string; purpose: string }
const manifest = JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8')) as Record<string, unknown> & { icons: Icon[] };
const themes = loadThemes();

describe('manifest.webmanifest', () => {
  it('names the app and opens it standalone at the root, scoped to the root', () => {
    expect(manifest['name']).toBe('Synthetos Run');
    expect(manifest['display']).toBe('standalone');
    expect(manifest['start_url']).toBe('/');
    expect(manifest['scope']).toBe('/');
    expect(manifest['id']).toBe('/');
  });

  it('takes its colours from the tokens', () => {
    expect(manifest['theme_color']).toBe(themes.light.get('--sheet'));
    expect(manifest['background_color']).toBe(themes.light.get('--paper'));
  });

  it('lists 192 and 512 px icons for any purpose, a maskable and a monochrome icon, all present with the declared size', () => {
    const purposes = manifest.icons.map((i) => `${i.purpose} ${i.sizes}`);
    expect(purposes).toEqual(expect.arrayContaining(['any 192x192', 'any 512x512', 'maskable 512x512', 'monochrome 512x512']));
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      expect(icon.src).toMatch(/^\/icons\/[a-z0-9-]+\.png$/);
      const file = join(PUBLIC, icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      const { width, height } = pngSize(readFileSync(file));
      expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
    }
  });

  it('contains no URL of another origin', () => {
    expect(JSON.stringify(manifest)).not.toMatch(/:\/\//);
  });
});

describe('icons', () => {
  it('the icon colours are the theme tokens', () => {
    for (const [name, value] of Object.entries(ICON_COLOURS)) expect(value, name).toBe(themes.light.get(`--${name}`));
  });

  it.each(ICONS.map((i) => [i.file, i] as const))('%s matches a fresh render pixel for pixel (pnpm gen:icons)', (_file, icon) => {
    const committed = decodePng(readFileSync(join(PUBLIC, 'icons', icon.file)));
    const fresh = drawIcon(icon.size, icon.variant);
    expect([committed.width, committed.height]).toEqual([icon.size, icon.size]);
    expect(Buffer.from(committed.rgba).equals(Buffer.from(fresh.rgba))).toBe(true);
  });

  it('the maskable icon keeps all content inside the safe zone (centred circle, 40% radius)', () => {
    const img = drawIcon(128, 'maskable');
    const paper = [0xf6, 0xf8, 0xf9];
    const grid = [0xe3, 0xe9, 0xed];
    const r = 0.4 * 128;
    for (let y = 0; y < 128; y += 1) {
      for (let x = 0; x < 128; x += 1) {
        const i = (y * 128 + x) * 4;
        const px = [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]];
        const background = [paper, grid].some((c) => c.every((v, k) => Math.abs(v - (px[k] as number)) <= 8));
        const outside = Math.hypot(x + 0.5 - 64, y + 0.5 - 64) > r;
        if (outside) expect(background, `pixel ${x},${y}`).toBe(true);
      }
    }
    expect(img.rgba[3]).toBe(255); // full bleed
  });

  it('the monochrome icon is a shape on a transparent background', () => {
    const img = drawIcon(64, 'monochrome');
    expect(img.rgba[3]).toBe(0);
    let opaque = 0;
    for (let i = 3; i < img.rgba.length; i += 4) if ((img.rgba[i] as number) === 255) opaque += 1;
    expect(opaque).toBeGreaterThan(200);
  });

  it('the PNG codec round-trips and rejects corruption', () => {
    const img = drawIcon(16, 'any');
    const png = encodePng(img);
    expect(Buffer.from(decodePng(png).rgba).equals(Buffer.from(img.rgba))).toBe(true);
    const bad = Buffer.from(png);
    bad.writeUInt8((bad.readUInt8(bad.length - 20) ^ 0xff), bad.length - 20);
    expect(() => decodePng(bad)).toThrow();
  });
});

describe('head tags on every page', () => {
  it('link the manifest and the icons', () => {
    const links = HEAD_TAGS.filter((t) => t.tag === 'link').map((t) => `${t.attrs['rel']} ${t.attrs['href']}`);
    expect(links).toContain('manifest /manifest.webmanifest');
    for (const href of HEAD_TAGS.flatMap((t) => (t.attrs['href'] === undefined ? [] : [t.attrs['href']]))) {
      expect(existsSync(join(PUBLIC, href)), href).toBe(true);
    }
  });

  it('give the browser the --sheet colour of each theme', () => {
    expect(THEME_COLOR.light).toBe(themes.light.get('--sheet'));
    expect(THEME_COLOR.dark).toBe(themes.dark.get('--sheet'));
    const metas = HEAD_TAGS.filter((t) => t.attrs['name'] === 'theme-color').map((t) => `${t.attrs['media']} ${t.attrs['content']}`);
    expect(metas).toEqual([`(prefers-color-scheme: light) ${THEME_COLOR.light}`, `(prefers-color-scheme: dark) ${THEME_COLOR.dark}`]);
  });
});
