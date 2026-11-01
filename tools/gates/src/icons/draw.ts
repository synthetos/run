/**
 * The run app icons (ROADMAP P0-05, D38: "blueprint icons 192/512 plus
 * maskable and a monochrome icon"), drawn from geometry so they are
 * reproducible and reviewable: drafting paper with the fine grid, the
 * synthetos.com crosshair mark in pencil-blue, an ink frame and a title block
 * reading RUN. Safety colours are never used (RUN_PLAN §7.1: nothing
 * decorative may resemble the safety bar).
 *
 * Shapes are defined on a 512-unit canvas and sampled 4×4 per pixel. Only
 * +, −, ×, ÷ and Math.sqrt are used (all correctly rounded in IEEE 754), so
 * every platform draws identical pixels and the committed PNGs can be
 * checked against a fresh render.
 */
import type { Image } from './png.ts';

export type Variant = 'any' | 'maskable' | 'monochrome';

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

/** A shape: does the canvas point (x, y) lie inside it? */
type Shape = (x: number, y: number) => boolean;

const rect = (x0: number, y0: number, x1: number, y1: number): Shape => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;

/** A ring between radii r0 and r1 around (cx, cy), optionally limited to one side of y = cy. */
const ring = (cx: number, cy: number, r0: number, r1: number, half: 'all' | 'top' | 'bottom' = 'all'): Shape => (x, y) => {
  if (half === 'top' && y > cy) return false;
  if (half === 'bottom' && y < cy) return false;
  const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
  return d >= r0 && d <= r1;
};

/** A stroke of width w from (x0, y0) to (x1, y1), with square ends. */
const segment = (x0: number, y0: number, x1: number, y1: number, w: number): Shape => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / len;
  const uy = dy / len;
  return (x, y) => {
    const px = x - x0;
    const py = y - y0;
    const along = px * ux + py * uy;
    const across = -px * uy + py * ux;
    return along >= -w / 2 && along <= len + w / 2 && across >= -w / 2 && across <= w / 2;
  };
};

const any = (...shapes: Shape[]): Shape => (x, y) => shapes.some((s) => s(x, y));
const both = (a: Shape, b: Shape): Shape => (x, y) => a(x, y) && b(x, y);

/** The crosshair mark of the synthetos.com wordmark, centred on (cx, cy). */
function mark(cx: number, cy: number, r: number, stroke: number): Shape {
  const reach = r + stroke * 2.2;
  return any(
    ring(cx, cy, r - stroke / 2, r + stroke / 2),
    rect(cx - reach, cy - stroke / 2, cx + reach, cy + stroke / 2),
    rect(cx - stroke / 2, cy - reach, cx + stroke / 2, cy + reach),
  );
}

/** "RUN" in drafting block letters, cap height h, top-left at (x, y). */
function run(x: number, y: number, h: number): Shape {
  const s = h * 0.2; // stroke
  const w = h * 0.62; // letter width
  const gap = h * 0.26;
  // The R's bowl spans from the top to the bottom of its middle bar.
  const bowl = (h * 0.5 + s / 2) / 2;
  const box = (lx: number): Shape => rect(lx, y, lx + w, y + h);
  const r = (lx: number): Shape =>
    any(
      rect(lx, y, lx + s, y + h),
      rect(lx, y, lx + w - bowl, y + s),
      rect(lx, y + h * 0.5 - s / 2, lx + w - bowl, y + h * 0.5 + s / 2),
      (px, py) => px >= lx + w - bowl && ring(lx + w - bowl, y + bowl, bowl - s, bowl)(px, py),
      both(box(lx), segment(lx + w * 0.4, y + h * 0.5, lx + w, y + h, s * 1.1)),
    );
  const u = (lx: number): Shape =>
    any(
      rect(lx, y, lx + s, y + h - w / 2),
      rect(lx + w - s, y, lx + w, y + h - w / 2),
      ring(lx + w / 2, y + h - w / 2, w / 2 - s, w / 2, 'bottom'),
    );
  const n = (lx: number): Shape =>
    any(rect(lx, y, lx + s, y + h), rect(lx + w - s, y, lx + w, y + h), both(box(lx), segment(lx, y, lx + w, y + h, s * 1.1)));
  return any(r(x), u(x + w + gap), n(x + 2 * (w + gap)));
}

/** Width of the RUN lettering for cap height h. */
const runWidth = (h: number): number => 3 * h * 0.62 + 2 * h * 0.26;

interface Layer {
  readonly shape: Shape;
  readonly colour: RGBA;
}

function layers(variant: Variant): Layer[] {
  const ink = rgba(ICON_COLOURS.ink);
  const blue = rgba(ICON_COLOURS.blue);
  const paper = rgba(ICON_COLOURS.paper);
  const gridColour = rgba(ICON_COLOURS.grid);
  const white = rgba('#ffffff');
  // Maskable icons keep everything, frame corners included, inside the
  // safe zone (a centred circle of 40% radius): 228 × 0.6 × √2 < 204.8.
  const k = variant === 'maskable' ? 0.6 : 1;
  const at = (v: number): number => 256 + (v - 256) * k;
  const grid: Shape = (x, y) => (x % 32 < 3 || y % 32 < 3) && x > 0 && y > 0;
  const frame = any(rect(at(28), at(28), at(484), at(40)), rect(at(28), at(472), at(484), at(484)), rect(at(28), at(28), at(40), at(484)), rect(at(472), at(28), at(484), at(484)));
  const titleRule = rect(at(28), at(368), at(484), at(380));
  const capH = 64 * k;
  const lettering = run(256 - runWidth(capH) / 2, at(392), capH);
  const crosshair = mark(256, at(200), 92 * k, 22 * k);
  if (variant === 'monochrome') {
    return [
      { shape: frame, colour: white },
      { shape: titleRule, colour: white },
      { shape: crosshair, colour: white },
      { shape: lettering, colour: white },
    ];
  }
  return [
    { shape: () => true, colour: paper },
    { shape: grid, colour: gridColour },
    { shape: frame, colour: ink },
    { shape: titleRule, colour: ink },
    { shape: crosshair, colour: blue },
    { shape: lettering, colour: ink },
  ];
}

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
  { file: 'icon-32.png', size: 32, variant: 'any' },
  { file: 'icon-192.png', size: 192, variant: 'any' },
  { file: 'icon-512.png', size: 512, variant: 'any' },
  { file: 'icon-maskable-512.png', size: 512, variant: 'maskable' },
  { file: 'icon-monochrome-512.png', size: 512, variant: 'monochrome' },
]);
