/**
 * WCAG 2.2 relative luminance and contrast ratio (SC 1.4.3, 1.4.11), for the
 * P0-05 contrast table. Dependency-free.
 */

/** Parses `#rgb` or `#rrggbb` into 0–255 channels. Anything else throws. */
export function parseHex(hex: string): readonly [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (m === null) throw new Error(`not a #rgb or #rrggbb colour: ${hex}`);
  const digits = m[1] as string;
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as unknown as readonly [number, number, number];
}

/** WCAG relative luminance of an sRGB colour. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
