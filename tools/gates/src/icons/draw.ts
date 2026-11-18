/**
 * The run app icons (ROADMAP P0-05, D38: "blueprint icons 192/512 plus
 * maskable and a monochrome icon"), drawn from geometry so they are
 * reproducible and reviewable: drafting paper with the fine grid, the
 * synthetos.com crosshair mark in pencil-blue, an ink frame and a title block
 * holding the run n mark (first-run design §4), drawn from the wordmark's own
 * numbers by mark.ts. The 32 px tab icon is the n alone on paper. Safety
 * colours are never used (RUN_PLAN §7.1: nothing decorative may resemble the
 * safety bar).
 *
 * Shapes are defined on a 512-unit canvas and sampled 4×4 per pixel (see
 * shapes.ts for the arithmetic rule that keeps every platform's pixels equal).
 */
import { WORDMARK_GEOMETRY } from '../../../../apps/web/src/brand/wordmarkGeometry.ts';
import { MARK_BOX, markPrimitives, markShapes } from './mark.ts';
import type { Image } from './png.ts';
import { any, rect, ring, type Shape } from './shapes.ts';

export type Variant = 'any' | 'maskable' | 'monochrome' | 'mark';

type RGBA = readonly [number, number, number, number];

/** Theme tokens (light) the icons use; a test checks them against tokens.css. */
export const ICON_COLOURS = Object.freeze({
  paper: '#f6f8f9',
  grid: '#e3e9ed',
  ink: '#15222c',
  blue: '#1d5aa6',
});

function rgba(hex: string, alpha = 255): RGBA {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

/** The crosshair mark of the synthetos.com wordmark, centred on (cx, cy). */
function crosshair(cx: number, cy: number, r: number, stroke: number): Shape {
  const reach = r + stroke * 2.2;
  return any(
    ring({ x: cx, y: cy }, r - stroke / 2, r + stroke / 2),
    rect(cx - reach, cy - stroke / 2, cx + reach, cy + stroke / 2),
    rect(cx - stroke / 2, cy - reach, cx + stroke / 2, cy + reach),
  );
}

const N_MARK = markPrimitives(WORDMARK_GEOMETRY);

interface Layer {
  readonly shape: Shape;
  readonly colour: RGBA;
}

/** The tab icon: the n alone on paper, MARK_BOX fitted inside a 48-unit margin. */
function markLayers(): Layer[] {
  const scale = (512 - 2 * 48) / MARK_BOX.h;
  const n = markShapes(N_MARK, { x: 256 - (MARK_BOX.w * scale) / 2, y: 48, scale });
  return [
    { shape: () => true, colour: rgba(ICON_COLOURS.paper) },
    { shape: n.ink, colour: rgba(ICON_COLOURS.ink) },
    { shape: n.blue, colour: rgba(ICON_COLOURS.blue) },
  ];
}

/** The drafting-paper composition of the app icons. */
function paperLayers(variant: 'any' | 'maskable' | 'monochrome'): Layer[] {
  const ink = rgba(ICON_COLOURS.ink);
  const blue = rgba(ICON_COLOURS.blue);
  const white = rgba('#ffffff');
  // Maskable icons keep everything, frame corners included, inside the
  // safe zone (a centred circle of 40% radius): 228 × 0.6 × √2 < 204.8.
  const k = variant === 'maskable' ? 0.6 : 1;
  const at = (v: number): number => 256 + (v - 256) * k;
  const grid: Shape = (x, y) => (x % 32 < 3 || y % 32 < 3) && x > 0 && y > 0;
  const frame = any(rect(at(28), at(28), at(484), at(40)), rect(at(28), at(472), at(484), at(484)), rect(at(28), at(28), at(40), at(484)), rect(at(472), at(28), at(484), at(484)));
  const titleRule = rect(at(28), at(368), at(484), at(380));
  // The title block (380..472) holds the n with a 56-unit stem: 24 geometry units → 56 canvas units.
  const scale = (56 / 24) * k;
  const n = markShapes(N_MARK, { x: 256 - (MARK_BOX.w * scale) / 2, y: at(389), scale });
  const mark = crosshair(256, at(200), 92 * k, 22 * k);
  if (variant === 'monochrome') {
    return [frame, titleRule, mark, n.ink, n.blue].map((shape) => ({ shape, colour: white }));
  }
  return [
    { shape: () => true, colour: rgba(ICON_COLOURS.paper) },
    { shape: grid, colour: rgba(ICON_COLOURS.grid) },
    { shape: frame, colour: ink },
    { shape: titleRule, colour: ink },
    { shape: mark, colour: blue },
    { shape: n.ink, colour: ink },
    { shape: n.blue, colour: blue },
  ];
}

const layers = (variant: Variant): Layer[] => (variant === 'mark' ? markLayers() : paperLayers(variant));

/** Renders one icon at `size` × `size` pixels. */
export function drawIcon(size: number, variant: Variant): Image {
  const scale = 512 / size;
  const stack = layers(variant);
  const out = new Uint8Array(size * size * 4);
  const N = 4;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < N; sy += 1) {
        for (let sx = 0; sx < N; sx += 1) {
          const x = (px + (sx + 0.5) / N) * scale;
          const y = (py + (sy + 0.5) / N) * scale;
          let colour: RGBA = [0, 0, 0, 0];
          for (const layer of stack) if (layer.shape(x, y)) colour = layer.colour;
          // Premultiplied accumulation keeps transparent edges clean.
          r += colour[0] * colour[3];
          g += colour[1] * colour[3];
          b += colour[2] * colour[3];
          a += colour[3];
        }
      }
      const i = (py * size + px) * 4;
      out[i] = a === 0 ? 0 : Math.round(r / a);
      out[i + 1] = a === 0 ? 0 : Math.round(g / a);
      out[i + 2] = a === 0 ? 0 : Math.round(b / a);
      out[i + 3] = Math.round(a / (N * N));
    }
  }
  return { width: size, height: size, rgba: out };
}

/** Every icon file the build ships, under apps/web/public/icons/. */
export const ICONS: readonly { readonly file: string; readonly size: number; readonly variant: Variant }[] = Object.freeze([
  { file: 'icon-32.png', size: 32, variant: 'mark' },
  { file: 'icon-192.png', size: 192, variant: 'any' },
  { file: 'icon-512.png', size: 512, variant: 'any' },
  { file: 'icon-maskable-512.png', size: 512, variant: 'maskable' },
  { file: 'icon-monochrome-512.png', size: 512, variant: 'monochrome' },
]);
